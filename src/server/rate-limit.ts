import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { rateCounters } from "@/server/db/schema";

/**
 * Fixed-window counters in Postgres (no Redis on one VPS). Each check-and-count
 * is one statement, so two requests at once can never both take the last slot.
 * Inside a transaction a rolled-back action gives its slot back automatically.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export type Rule = { key: string; limit: number; windowMs: number };

// Inside ON CONFLICT both the stored row and `excluded` have these columns,
// so name the table explicitly (Drizzle prints bare column names in sql``).
const storedCount = sql`${sql.identifier("rate_counters")}.${sql.identifier("count")}`;

function bucketOf(windowMs: number, now: Date): { bucket: string; expiresAt: Date } {
  const n = Math.floor(now.getTime() / windowMs);
  return { bucket: String(n), expiresAt: new Date((n + 1) * windowMs) };
}

/** Takes one slot from the rule's current window. False when the window is full. */
export async function consume(database: DbOrTx, rule: Rule, now: Date = new Date()): Promise<boolean> {
  if (rule.limit <= 0) return false;
  const { bucket, expiresAt } = bucketOf(rule.windowMs, now);
  const rows = await database
    .insert(rateCounters)
    .values({ key: rule.key, bucket, count: 1, expiresAt })
    .onConflictDoUpdate({
      target: [rateCounters.key, rateCounters.bucket],
      set: { count: sql`${storedCount} + 1` },
      setWhere: sql`${storedCount} < ${rule.limit}`,
    })
    .returning({ count: rateCounters.count });
  return rows.length > 0;
}

/** Gives a slot back (the counted action didn't happen after all). */
export async function release(database: DbOrTx, rule: Rule, now: Date = new Date()): Promise<void> {
  const { bucket } = bucketOf(rule.windowMs, now);
  await database
    .update(rateCounters)
    .set({ count: sql`greatest(${rateCounters.count} - 1, 0)` })
    .where(and(eq(rateCounters.key, rule.key), eq(rateCounters.bucket, bucket)));
}

/**
 * Takes a slot from every rule, or from none: returns the first rule that is
 * full (after giving back the slots already taken), or null when all passed.
 */
export async function consumeAll(
  database: DbOrTx,
  rules: readonly Rule[],
  now: Date = new Date(),
): Promise<Rule | null> {
  const taken: Rule[] = [];
  for (const rule of rules) {
    if (!(await consume(database, rule, now))) {
      for (const r of taken) await release(database, r, now);
      return rule;
    }
    taken.push(rule);
  }
  return null;
}

/** Slots used in the rule's current window (for tests and messages). */
export async function used(database: DbOrTx, rule: Omit<Rule, "limit">, now: Date = new Date()) {
  const { bucket } = bucketOf(rule.windowMs, now);
  const [row] = await database
    .select({ count: rateCounters.count })
    .from(rateCounters)
    .where(and(eq(rateCounters.key, rule.key), eq(rateCounters.bucket, bucket)));
  return row?.count ?? 0;
}

/** Deletes counters whose window has ended (run by the worker's scheduler). */
export async function pruneCounters(database: DbOrTx, now: Date = new Date()): Promise<void> {
  await database.delete(rateCounters).where(lt(rateCounters.expiresAt, now));
}
