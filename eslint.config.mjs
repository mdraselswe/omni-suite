import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Read environment variables only through src/config/env.ts (validated, listed in .env.example).
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Use src/config/env.ts (or @/config)." },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Features expose a public API through their index file. This applies inside
              // src/features too: a feature uses relative imports ("./service") for its own
              // files and "@/features/<other>" for another feature.
              group: ["@/features/*/*"],
              message: "Import from the feature's index (e.g. '@/features/pwa').",
            },
          ],
        },
      ],
    },
  },
  {
    // Command-line entry points print progress.
    files: ["src/server/seed-cli.ts", "src/server/db/migrate-cli.ts"],
    rules: { "no-console": "off" },
  },
  {
    // The only places allowed to read process.env.
    files: [
      "src/config/env.ts",
      "scripts/**",
      "playwright.config.ts",
      "drizzle.config.ts",
      "src/instrumentation.ts",
    ],
    rules: { "no-restricted-properties": "off" },
  },
  {
    files: ["scripts/**"],
    rules: { "no-console": "off" },
  },
  globalIgnores([
    ".next/**",
    ".claude/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "public/**",
    "next-env.d.ts",
  ]),
]);
