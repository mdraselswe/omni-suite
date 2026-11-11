import "server-only";
import { db } from "@/server/db";
import { createHandlers, scheduleRecurring } from "./handlers";
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

  const schedule = async () => {
    try {
      await recoverStaleJobs(db());
      await scheduleRecurring(db(), new Date());
      await pruneJobs(db());
    } catch (error) {
      console.error("[jobs] scheduler error", error);
    }
  };

  setInterval(() => void drain(), POLL_MS).unref();
  setInterval(() => void schedule(), SCHEDULE_MS).unref();
  void schedule().then(drain);
}
