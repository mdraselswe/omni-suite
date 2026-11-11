import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/server/testing/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    css: false,
    restoreMocks: true,
    env: { TZ: "UTC" },
    // Database tests start an in-memory Postgres (WASM) per file: heavy on CPU, so run
    // at most half the cores at once and allow slow machines and busy CI runners time.
    maxWorkers: "50%",
    testTimeout: 90_000,
    hookTimeout: 120_000,
  },
});
