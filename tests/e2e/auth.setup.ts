import { expect, test as setup } from "@playwright/test";
import { PASSWORD, ROLES, stateFile } from "./helpers";

/**
 * Signs in once per demo role and saves the session, so tests don't hit the
 * sign-in rate limit. Needs `pnpm db:seed` and AUTH_EMAIL_PASSWORD=true.
 */
for (const role of ROLES) {
  setup(`sign in as ${role}`, async ({ page }) => {
    await page.goto("/login/");
    await page.getByLabel("Email").fill(`${role}@demo.test`);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.context().storageState({ path: stateFile(role) });
  });
}
