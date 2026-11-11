import "server-only";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { auditLogs, googleConnections, jobs, syncOutbox } from "@/server/db/schema";

/** Changes within this window share one backup.sync job (bursts coalesce). */
export const BACKUP_SYNC_DELAY_MS = 60_000;

/** JSON-safe copy (bigint → string, Date → ISO) for audit data and exports. */
export function toJsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
}

/** Appends an audit entry. Call inside the same transaction as the change. */
export async function audit(
  tx: DbOrTx,
  entry: {
    tenantId: string | null;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    data?: unknown;
  },
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: entry.tenantId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    data: toJsonSafe(entry.data ?? {}) as object,
  });
}

/**
 * Records that an entity changed so the backup worker mirrors it (ADR 0007),
 * and makes sure one sync job is pending for the tenant. The job runs a minute
 * later, so a burst of writes is mirrored once. Tenants without a Google
 * connection have nothing to mirror: no outbox row, no job (connecting runs a
 * full sync anyway).
 */
export async function markChanged(
  tx: DbOrTx,
  tenantId: string,
  entity: string,
  entityId: string,
  op: "upsert" | "delete" = "upsert",
): Promise<void> {
  const [connected] = await tx
    .select({ id: googleConnections.id })
    .from(googleConnections)
    .where(eq(googleConnections.tenantId, tenantId))
    .limit(1);
  if (!connected) return;
  await tx.insert(syncOutbox).values({ tenantId, entity, entityId, op });
  await tx
    .insert(jobs)
    .values({
      type: "backup.sync",
      tenantId,
      dedupeKey: `backup.sync:${tenantId}`,
      payload: {},
      runAt: new Date(Date.now() + BACKUP_SYNC_DELAY_MS),
    })
    .onConflictDoNothing();
}
