import "server-only";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { serverEnv } from "@/config/env";

/** Applies pending migrations from ./drizzle with a short-lived single connection. */
export async function runMigrations(): Promise<void> {
  const client = postgres(serverEnv().DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  } finally {
    await client.end();
  }
}
