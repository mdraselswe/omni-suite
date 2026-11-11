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
