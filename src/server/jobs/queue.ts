import "server-only";
import { and, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { jobs } from "@/server/db/schema";

export type Job = typeof jobs.$inferSelect;
export type JobHandler = (job: Job) => Promise<void>;

export const MAX_ATTEMPTS = 5;
/** A "running" job whose lock is older than this belongs to a crashed worker. */
export const STALE_AFTER_MS = 10 * 60_000;
/** How often a running job refreshes its lock (well inside STALE_AFTER_MS). */
export const HEARTBEAT_MS = 60_000;

/** Adds a job. With `dedupeKey`, a second pending job with the same key is skipped. */
export async function enqueue(
  database: DbOrTx,
  job: { type: string; tenantId?: string | null; payload?: object; runAt?: Date; dedupeKey?: string },
): Promise<void> {
  await database
    .insert(jobs)
    .values({
      type: job.type,
      tenantId: job.tenantId ?? null,
      payload: job.payload ?? {},
      runAt: job.runAt ?? new Date(),
      dedupeKey: job.dedupeKey ?? null,
    })
    .onConflictDoNothing();
}

/**
 * Enqueues a scheduled job unless one with the same key is pending or running,
 * or gave up (failed) less than `failureCooldownMs` ago. Keeps the scheduler from
 * re-queuing a job every minute while it runs or after it keeps failing.
 */
export async function enqueueUnlessBusy(
  database: DbOrTx,
  job: { type: string; tenantId?: string | null; payload?: object; dedupeKey: string },
  options: { failureCooldownMs: number; now?: Date },
): Promise<boolean> {
  const now = options.now ?? new Date();
  const [busy] = await database
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.dedupeKey, job.dedupeKey),
        or(
          inArray(jobs.status, ["pending", "running"]),
          // A failed job's run_at is the time it gave up (see runOneJob).
          and(eq(jobs.status, "failed"), gt(jobs.runAt, new Date(now.getTime() - options.failureCooldownMs))),
        ),
      ),
    )
    .limit(1);
  if (busy) return false;
  await enqueue(database, { ...job, runAt: now });
  return true;
}

/** Claims the next due job (FOR UPDATE SKIP LOCKED, so several workers never take the same one). */
export async function claimJob(database: DbOrTx): Promise<Job | null> {
  const rows = await database.execute<Record<string, unknown>>(sql`
    update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
    where id = (
      select id from jobs
      where status = 'pending' and run_at <= now()
      order by run_at
      limit 1
      for update skip locked
    )
    returning id`);
  const list = Array.isArray(rows) ? rows : ((rows as { rows?: Record<string, unknown>[] }).rows ?? []);
  const id = list[0]?.id;
  if (typeof id !== "string") return null;
  const [job] = await database.select().from(jobs).where(eq(jobs.id, id));
  return job ?? null;
}

/** Keeps a running job's lock fresh so recoverStaleJobs never hands it to a second worker. */
function startHeartbeat(database: DbOrTx, jobId: string, everyMs: number): () => void {
  const timer = setInterval(() => {
    database
      .update(jobs)
      .set({ lockedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")))
      .catch((error: unknown) => console.error("[jobs] heartbeat failed", error));
  }, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Runs one due job with the matching handler. Returns false when the queue is empty. */
export async function runOneJob(
  database: DbOrTx,
  handlers: ReadonlyMap<string, JobHandler>,
  options: { heartbeatMs?: number } = {},
): Promise<boolean> {
  const job = await claimJob(database);
  if (!job) return false;
  const handler = handlers.get(job.type);
  const stopHeartbeat = startHeartbeat(database, job.id, options.heartbeatMs ?? HEARTBEAT_MS);
  try {
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    await handler(job);
    stopHeartbeat();
    await database
      .update(jobs)
      .set({ status: "done", lockedAt: null, lastError: null })
      .where(eq(jobs.id, job.id));
  } catch (error) {
    stopHeartbeat();
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    const retry = job.attempts < MAX_ATTEMPTS;
    // Retry after 1, 4, 9, 16 minutes; a failed job keeps the time it gave up in run_at.
    const runAt = retry ? new Date(Date.now() + job.attempts * job.attempts * 60_000) : new Date();
    await database
      .update(jobs)
      .set({ status: retry ? "pending" : "failed", lockedAt: null, lastError: message, runAt })
      .where(eq(jobs.id, job.id))
      .catch(async () => {
        // A pending duplicate with the same dedupe key exists: this one is no longer needed.
        await database
          .update(jobs)
          .set({ status: "failed", lockedAt: null, lastError: message, runAt: new Date() })
          .where(eq(jobs.id, job.id));
      });
    console.error(`[jobs] ${job.type} failed (attempt ${job.attempts})`, message);
  }
  return true;
}

/**
 * Jobs stuck in "running" (crashed worker: no heartbeat for STALE_AFTER_MS).
 * Each goes back in the queue, unless it has used all its attempts (a job that
 * crashes the worker must not run forever) or a pending job with the same dedupe
 * key already exists (that one does the work; resetting would break jobs_dedupe_uq).
 */
export async function recoverStaleJobs(database: DbOrTx, now: Date = new Date()): Promise<void> {
  const stale = await database
    .select({ id: jobs.id, attempts: jobs.attempts, type: jobs.type })
    .from(jobs)
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(now.getTime() - STALE_AFTER_MS))));
  for (const job of stale) {
    const fail = (lastError: string) =>
      database
        .update(jobs)
        .set({ status: "failed", lockedAt: null, lastError, runAt: now })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")));
    if (job.attempts >= MAX_ATTEMPTS) {
      await fail(`Stopped after ${job.attempts} attempts (the worker stopped while running it)`);
      continue;
    }
    const superseded = "Replaced by a newer pending job (the worker stopped while running it)";
    try {
      const reset = await database
        .update(jobs)
        .set({ status: "pending", lockedAt: null, runAt: now })
        .where(
          and(
            eq(jobs.id, job.id),
            eq(jobs.status, "running"),
            sql`not exists (select 1 from jobs d where d.dedupe_key = ${jobs.dedupeKey} and d.status = 'pending')`,
          ),
        )
        .returning({ id: jobs.id });
      if (reset.length === 0) await fail(superseded);
    } catch {
      // A duplicate was queued between the check and the update (jobs_dedupe_uq).
      await fail(superseded);
    }
    console.error(`[jobs] recovered stale ${job.type} job ${job.id}`);
  }
}

/** Deletes finished and failed jobs older than 30 days. */
export async function pruneJobs(database: DbOrTx, now: Date = new Date()): Promise<void> {
  await database
    .delete(jobs)
    .where(
      and(
        inArray(jobs.status, ["done", "failed"]),
        lt(jobs.createdAt, new Date(now.getTime() - 30 * 86_400_000)),
      ),
    );
}
