import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the production build (`pnpm build` first) and a seeded database
 * (`docker compose up -d`, `pnpm db:seed`). APP_URL must match the test port.
 */
const PORT = 4173;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Reduced motion: pages render in their final state, so axe checks contrast on settled colours.
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    // Signs in once per demo role (see tests/e2e/auth.setup.ts).
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
    { name: "mobile", use: { ...devices["Pixel 7"] }, dependencies: ["setup"] },
    // Dark mode: every page and open popup gets the same axe contrast checks.
    {
      name: "dark",
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
      dependencies: ["setup"],
      grep: /accessib|readable|detail pages/i,
    },
  ],
  webServer: {
    command: "pnpm start",
    env: {
      PORT: String(PORT),
      APP_URL: `http://localhost:${PORT}`,
      WORKER_ENABLED: "false",
      AUTH_EMAIL_PASSWORD: "true",
    },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
