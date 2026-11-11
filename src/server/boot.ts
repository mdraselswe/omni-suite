import "server-only";
import { insecureSecrets, serverEnv } from "@/config/env";
import { runMigrations } from "@/server/db/migrate";
import { startWorker } from "@/server/jobs/worker";

/** Logs why the server can't start and stops the process (Docker restarts it and shows the log). */
function fatal(message: string, error?: unknown): never {
  console.error(`[boot] ${message}`, ...(error === undefined ? [] : [error]));
  process.exit(1);
}

/**
 * Runs once when the Node.js server starts (see src/instrumentation.ts; skipped
 * during `next build` and tests). Refuses to serve with public default secrets
 * or on a database whose migrations failed.
 */
export async function boot(): Promise<void> {
  const env = serverEnv();
  const insecure = insecureSecrets(env);
  if (insecure.length > 0) {
    fatal(
      `${insecure.join(" and ")} still use the public development default. ` +
        `Set random values in .env.production (see .env.example) and restart.`,
    );
  }
  if (env.AUTO_MIGRATE) {
    try {
      await runMigrations();
    } catch (error) {
      fatal(
        "Database migration failed, so the server will not start on an old schema. Is Postgres running? (docker compose up -d)",
        error,
      );
    }
  }
  if (env.WORKER_ENABLED) startWorker();
}
