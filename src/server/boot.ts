import "server-only";
import { insecureSecrets, MIN_SECRET_LENGTH, serverEnv, weakSecrets } from "@/config/env";
import { revokeLegacyBoundSessions } from "@/server/auth/handoff-access";
import { db } from "@/server/db";
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
  const weak = weakSecrets(env);
  if (weak.length > 0) {
    fatal(
      `${weak.join(" and ")} too weak: ENCRYPTION_KEY must be 32 random bytes (base64), ` +
        `secrets at least ${MIN_SECRET_LENGTH} random characters. See .env.example.`,
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
  try {
    // Custom-domain sessions bound the old way (a purgeable row) must sign in again.
    const revoked = await revokeLegacyBoundSessions(db());
    if (revoked > 0) console.warn(`[boot] signed out ${revoked} custom-domain session(s) bound the old way`);
  } catch (error) {
    // Fail closed: such a session would otherwise work in every business.
    fatal("Could not sign out custom-domain sessions bound the old way.", error);
  }
  if (env.WORKER_ENABLED) startWorker();
}
