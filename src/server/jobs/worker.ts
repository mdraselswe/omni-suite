import "server-only";
import { db } from "@/server/db";
import { createHandlers, scheduleRecurring } from "./handlers";
import { pruneCounters } from "@/server/rate-limit";
import { pruneJobs, recoverStaleJobs, runOneJob } from "./queue";

const POLL_MS = 5_000;
const SCHEDULE_MS = 60_000;
const globalForWorker = globalThis as unknown as { __omnisuiteWorker?: boolean };

/**
 * In-process worker (no Redis): polls the jobs table and runs a scheduler tick
 * every minute. Safe to run in several processes thanks to SKIP LOCKED.
 */
export function startWorker(): void {
  if (globalForWorker.__omnisuiteWorker) return;
  globalForWorker.__omnisuiteWorker = true;
  let busy = false;
  const jobHandlers = createHandlers(db);

  const drain = async () => {
    if (busy) return;
    busy = true;
    try {
      // Run up to 20 jobs per tick so one slow tenant cannot starve the loop forever.
      for (let i = 0; i < 20 && (await runOneJob(db(), jobHandlers)); i++);
    } catch (error) {
      console.error("[jobs] worker error", error);
    } finally {
      busy = false;
    }
  };

  // Each step on its own, so one failing step never skips the others.
  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      console.error(`[jobs] scheduler step "${name}" failed`, error);
    }
  };
  const schedule = async () => {
    await step("recover", () => recoverStaleJobs(db()));
    await step("schedule", () => scheduleRecurring(db(), new Date()));
    await step("prune", () => pruneJobs(db()));
    await step("prune counters", () => pruneCounters(db()));
  };

  setInterval(() => void drain(), POLL_MS).unref();
  setInterval(() => void schedule(), SCHEDULE_MS).unref();
  void schedule().then(drain);
}
