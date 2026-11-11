/**
 * Next.js calls this once per server start. On Node.js it applies migrations
 * and starts the job worker. process.env is read directly here (not via
 * src/config/env.ts) because NEXT_RUNTIME must be a literal for Next to drop
 * the Node-only import from other runtimes.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build" || process.env.NODE_ENV === "test") return;
  const { boot } = await import("@/server/boot");
  await boot();
}
