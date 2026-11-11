import { defineConfig } from "drizzle-kit";

// drizzle-kit reads this file itself. The URL is only needed for `drizzle-kit migrate/studio`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://omnisuite:omnisuite@localhost:5432/omnisuite",
  },
});
