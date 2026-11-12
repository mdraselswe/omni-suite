import { expect, type Page, test } from "@playwright/test";
import { expectAccessible, stateFile } from "./helpers";

/** Forbidden pages render the not-found page. Streaming (loading.tsx) has already sent 200, so check the content. */
async function expectNotFound(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Page not found" }), path).toBeVisible();
}

/**
 * Needs Postgres with the demo data (`pnpm db:seed`) and AUTH_EMAIL_PASSWORD=true,
 * as in CI. Sessions come from auth.setup.ts.
 */

test.describe("public", () => {
  test("sign-in page renders and is accessible", async ({ page }) => {
    await page.goto("/login/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test("a share link that doesn't exist shows the not-found page", async ({ page }) => {
    // The root loading screen starts the stream first, so the status stays 200 (noindex).
    for (const path of [`/p/invoice/${"A".repeat(32)}/`, "/p/proposal/not-a-token/"]) {
      await page.goto(path);
      await expect(page.getByText("404", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).not.toContainText("Invoice");
    }
  });

  test("app pages need a session", async ({ page }) => {
    await page.goto("/demo/finance/");
    await expect(page).toHaveURL(/\/login\//);
  });

  test("PWA files exist", async ({ request }) => {
    for (const file of ["/manifest.webmanifest", "/icons/icon-192.png", "/sw.js"]) {
      expect((await request.get(file)).status(), file).toBe(200);
    }
  });
});

test.describe("owner", () => {
  test.use({ storageState: stateFile("owner") });

  const PAGES = [
    "/demo/",
    "/demo/finance/",
    "/demo/finance/report/",
    "/demo/finance/setup/",
    "/demo/partners/",
    "/demo/partners/rules/",
    "/demo/partners/distributions/",
    "/demo/leads/",
    "/demo/clients/",
    "/demo/clients/onboarding/",
    "/demo/proposals/",
    "/demo/proposals/new/",
    "/demo/invoices/",
    "/demo/invoices/new/",
    "/demo/invoices/recurring/",
    "/demo/bills/",
    "/demo/bills/new/",
    "/demo/projects/",
    "/demo/projects/templates/",
    "/demo/time/",
    "/demo/files/",
    "/demo/team/",
    "/demo/team/roles/",
    "/demo/audit/",
    "/demo/settings/",
    "/demo/settings/branding/",
    "/demo/settings/modules/",
    "/demo/settings/fields/",
    "/demo/settings/pipeline/",
    "/demo/settings/backup/",
    "/demo/settings/domains/",
    "/demo/settings/payments/",
    "/demo/settings/xero/",
    "/demo/settings/billing/",
    "/account/",
  ];

  for (const path of PAGES) {
    test(`${path} renders with no accessibility violations`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectAccessible(page);
    });
  }

  test("detail pages render: first client, invoice, proposal, project and member", async ({ page }) => {
    for (const [list, pattern] of [
      ["/demo/clients/", /\/demo\/clients\/[0-9a-f-]{36}\/?$/],
      ["/demo/invoices/", /\/demo\/invoices\/[0-9a-f-]{36}\/?$/],
      ["/demo/proposals/", /\/demo\/proposals\/[0-9a-f-]{36}\/?$/],
      ["/demo/projects/", /\/demo\/projects\/[0-9a-f-]{36}\/?$/],
      ["/demo/team/", /\/demo\/team\/[0-9a-f-]{36}\/?$/],
      ["/demo/partners/", /\/demo\/partners\/[0-9a-f-]{36}\/?$/],
      ["/demo/bills/", /\/demo\/bills\/[0-9a-f-]{36}\/?$/],
    ] as const) {
      await page.goto(list);
      const href = await page
        .locator("a[href]")
        .evaluateAll(
          (links, source) =>
            links.map((a) => a.getAttribute("href") ?? "").find((h) => new RegExp(source).test(h)),
          pattern.source,
        );
      expect(href, list).toBeTruthy();
      const res = await page.goto(href ?? list);
      expect(res?.status(), href).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectAccessible(page);
    }
  });

  test("an invoice's share link opens without signing in", async ({ page, browser }) => {
    await page.goto("/demo/invoices/?status=all");
    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((links) =>
        links
          .map((a) => a.getAttribute("href") ?? "")
          .filter((h) => /\/demo\/invoices\/[0-9a-f-]{36}\/?$/.test(h)),
      );
    let shared = "";
    for (const href of [...new Set(hrefs)].slice(0, 15)) {
      await page.goto(href);
      shared =
        (await page
          .getByText(/\/p\/invoice\/[A-Za-z0-9_-]{32}\//)
          .first()
          .textContent({ timeout: 500 })
          .catch(() => null)) ?? "";
      if (shared) break;
    }
    expect(shared, "a sent invoice with a share link").toBeTruthy();
    const guest = await browser.newContext();
    const visitor = await guest.newPage();
    const res = await visitor.goto(new URL(shared.trim()).pathname);
    expect(res?.status()).toBe(200);
    await expect(visitor.getByRole("heading", { level: 1 })).toBeVisible();
    await expectAccessible(visitor);
    await guest.close();
  });

  test("the ledger pages with numbered links and searches as you type", async ({ page }) => {
    await page.goto("/demo/finance/?size=25");
    const pager = page.getByRole("navigation", { name: "Pagination" });
    await expect(pager).toBeVisible();
    await expect(pager.getByText(/^Showing 1–\d+ of \d+/)).toBeVisible();
    await expect(pager.getByLabel("Rows per page")).toHaveValue("25");
    const next = pager.getByRole("link", { name: "Next page" });
    if ((await next.count()) > 0) {
      await next.click();
      await expect(page).toHaveURL(/[?&]page=2/);
      await expect(pager.getByText(/^Showing 26–/)).toBeVisible();
      await expect(pager.locator("[aria-current=page]")).toHaveText("2");
    }
    await expectAccessible(page);

    await page.getByRole("searchbox", { name: "Search" }).fill("zzz no such entry");
    await expect(page).toHaveURL(/[?&]q=zzz\+no\+such\+entry/);
    await expect(page).not.toHaveURL(/[?&]page=/);
    await expect(page.getByText("No results for “zzz no such entry”")).toBeVisible();
    await page.getByRole("link", { name: "Clear search" }).click();
    await expect(page).not.toHaveURL(/[?&]q=/);
    await expect(pager).toBeVisible();
  });

  test("records an expense and sees it in the ledger", async ({ page }) => {
    await page.goto("/demo/finance/");
    const description = `E2E expense ${Date.now()}`;
    await page.getByRole("button", { name: "Record a transaction" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Type", { exact: true }).selectOption("expense");
    await dialog.getByLabel("Amount", { exact: true }).fill("12.34");
    await dialog.getByLabel("Description", { exact: true }).fill(description);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(description)).toBeVisible();
  });
});

test.describe("client", () => {
  test.use({ storageState: stateFile("client") });

  test("lands in the portal and can't open team pages", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/demo\/portal\//);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectAccessible(page);
    await expectNotFound(page, "/demo/finance/");
  });

  for (const path of [
    "/demo/portal/projects/",
    "/demo/portal/invoices/",
    "/demo/portal/proposals/",
    "/demo/portal/files/",
    "/demo/portal/onboarding/",
  ]) {
    test(`${path} renders with no accessibility violations`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectAccessible(page);
    });
  }
});

test.describe("staff", () => {
  test.use({ storageState: stateFile("staff") });

  test("can't see money or partners, but sees projects", async ({ page }) => {
    await expectNotFound(page, "/demo/finance/");
    await expectNotFound(page, "/demo/partners/");
    expect((await page.goto("/demo/projects/"))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectAccessible(page);
  });
});
