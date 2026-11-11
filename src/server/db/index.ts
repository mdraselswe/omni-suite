import "server-only";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/config/env";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

const globalForDb = globalThis as unknown as { __omnisuiteDb?: Database };

/**
 * The shared database. One postgres.js pool per process (kept on globalThis so
 * dev hot reloads don't open new pools). Tests swap in PGlite with `setDb`.
 */
export function db(): Database {
  if (!globalForDb.__omnisuiteDb) {
    const client = postgres(serverEnv().DATABASE_URL, { max: 10, prepare: true });
    globalForDb.__omnisuiteDb = drizzle(client, { schema });
  }
  return globalForDb.__omnisuiteDb;
}

/** Test hook: use another database (PGlite). */
export function setDb(database: Database): void {
  globalForDb.__omnisuiteDb = database;
}

export { schema };
