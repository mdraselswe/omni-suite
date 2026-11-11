import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { aiUsage } from "@/server/db/schema";

// Inside ON CONFLICT both the stored row and `excluded` have these columns,
// so name the table explicitly (Drizzle prints bare column names in sql``).
const stored = (column: string) => sql`${sql.identifier("ai_usage")}.${sql.identifier(column)}`;

/**
 * Takes one request from today's allowance in a single statement, so two
 * requests at once can never both pass the limit. False when the limit is reached.
 */
export async function reserveAiRequest(
  database: DbOrTx,
  tenantId: string,
  day: string,
  limit: number,
): Promise<boolean> {
  if (limit <= 0) return false;
  const rows = await database
    .insert(aiUsage)
    .values({ tenantId, day, requests: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.tenantId, aiUsage.day],
      set: { requests: sql`${stored("requests")} + 1` },
      setWhere: sql`${stored("requests")} < ${limit}`,
    })
    .returning({ requests: aiUsage.requests });
  return rows.length > 0;
}

/** Gives a reserved request back (the call failed, so it shouldn't count). */
export async function releaseAiRequest(database: DbOrTx, tenantId: string, day: string): Promise<void> {
  await database
    .update(aiUsage)
    .set({ requests: sql`greatest(${aiUsage.requests} - 1, 0)` })
    .where(and(eq(aiUsage.tenantId, tenantId), eq(aiUsage.day, day)));
}

export async function recordAiTokens(
  database: DbOrTx,
  tenantId: string,
  day: string,
  tokens: { inputTokens: number; outputTokens: number },
): Promise<void> {
  await database
    .update(aiUsage)
    .set({
      inputTokens: sql`${aiUsage.inputTokens} + ${tokens.inputTokens}`,
      outputTokens: sql`${aiUsage.outputTokens} + ${tokens.outputTokens}`,
    })
    .where(and(eq(aiUsage.tenantId, tenantId), eq(aiUsage.day, day)));
}

export async function aiUsageOn(database: DbOrTx, tenantId: string, day: string) {
  const [row] = await database
    .select()
    .from(aiUsage)
    .where(and(eq(aiUsage.tenantId, tenantId), eq(aiUsage.day, day)));
  return row ?? { tenantId, day, requests: 0, inputTokens: 0, outputTokens: 0 };
}
