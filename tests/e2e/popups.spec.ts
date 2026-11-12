import { expect, test } from "@playwright/test";
import { expectAccessible, stateFile } from "./helpers";

/**
 * Menus and dialogs only exist while open, so the page smoke tests never check them.
 * Open each one and run axe on it (the "dark" project repeats this in dark mode,
 * where unreadable popups were reported).
 */
test.describe("open popups are readable", () => {
  test.use({ storageState: stateFile("owner") });

  test("account menu", async ({ page }) => {
    await page.goto("/demo/");
    await page.getByRole("button", { name: /^Account menu/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectAccessible(page);
  });

  test("notifications", async ({ page }) => {
    await page.goto("/demo/");
    await page.getByRole("button", { name: /notification/i }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectAccessible(page);
  });

  test("page search", async ({ page }) => {
    await page.goto("/demo/");
    await page.getByRole("button", { name: "Search pages" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page);
  });

  test("record a transaction dialog", async ({ page }) => {
    await page.goto("/demo/finance/");
    await page.getByRole("button", { name: "Record a transaction" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page);
  });
});
