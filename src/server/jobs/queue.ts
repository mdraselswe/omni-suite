import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { jobs } from "@/server/db/schema";

export type Job = typeof jobs.$inferSelect;
export type JobHandler = (job: Job) => Promise<void>;

const MAX_ATTEMPTS = 5;
const STALE_AFTER_MS = 10 * 60_000;

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

/** Runs one due job with the matching handler. Returns false when the queue is empty. */
export async function runOneJob(
  database: DbOrTx,
  handlers: ReadonlyMap<string, JobHandler>,
): Promise<boolean> {
  const job = await claimJob(database);
  if (!job) return false;
  const handler = handlers.get(job.type);
  try {
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    await handler(job);
    await database
      .update(jobs)
      .set({ status: "done", lockedAt: null, lastError: null })
      .where(eq(jobs.id, job.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retry = job.attempts < MAX_ATTEMPTS;
    // Back off 1, 4, 9, 16 minutes.
    const runAt = new Date(Date.now() + job.attempts * job.attempts * 60_000);
    await database
      .update(jobs)
      .set({ status: retry ? "pending" : "failed", lockedAt: null, lastError: message.slice(0, 2000), runAt })
      .where(eq(jobs.id, job.id))
      .catch(async () => {
        // A pending duplicate with the same dedupe key exists: this one is no longer needed.
        await database
          .update(jobs)
          .set({ status: "failed", lastError: message.slice(0, 2000) })
          .where(eq(jobs.id, job.id));
      });
    console.error(`[jobs] ${job.type} failed (attempt ${job.attempts})`, message);
  }
  return true;
}

/** Puts jobs stuck in "running" (crashed worker) back in the queue. */
export async function recoverStaleJobs(database: DbOrTx): Promise<void> {
  await database
    .update(jobs)
    .set({ status: "pending", lockedAt: null })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(Date.now() - STALE_AFTER_MS))));
}

/** Deletes finished jobs older than 30 days. */
export async function pruneJobs(database: DbOrTx): Promise<void> {
  await database
    .delete(jobs)
    .where(and(eq(jobs.status, "done"), lt(jobs.createdAt, new Date(Date.now() - 30 * 86_400_000))));
}
