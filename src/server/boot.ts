import "server-only";
import { serverEnv } from "@/config/env";
import { runMigrations } from "@/server/db/migrate";
import { startWorker } from "@/server/jobs/worker";

/** Runs once when the Node.js server starts (see src/instrumentation.ts). */
export async function boot(): Promise<void> {
  const env = serverEnv();
  if (env.AUTO_MIGRATE) {
    try {
      await runMigrations();
    } catch (error) {
      console.error("[db] migration failed. Is Postgres running? (docker compose up -d)", error);
      return;
    }
  }
  if (env.WORKER_ENABLED) startWorker();
}
