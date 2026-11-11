import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { today } from "@/lib/dates";
import { parseTenantSettings } from "@/lib/tenant-settings";
import { audit } from "@/server/audit";
import { decrypt, encrypt } from "@/server/crypto";
import type { Database, DbOrTx } from "@/server/db";
import { googleConnections, syncOutbox, tenants } from "@/server/db/schema";
import {
  ENTITY_SETS,
  EXPORT_SET_NAMES,
  exportRows,
  exportTenant,
  toTable,
  type ExportSet,
} from "@/server/export";
import {
  accessToken,
  addSheets,
  createFolder,
  createSpreadsheet,
  pruneSnapshots,
  replaceSheet,
  sheetTitles,
  uploadJson,
} from "@/server/google";
import { enqueue } from "@/server/jobs/queue";

export async function getConnection(database: DbOrTx, tenantId: string) {
  const [row] = await database
    .select()
    .from(googleConnections)
    .where(eq(googleConnections.tenantId, tenantId));
  return row ?? null;
}

export async function saveConnection(
  database: Database,
  input: { tenantId: string; userId: string; refreshToken: string; email: string },
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx
      .insert(googleConnections)
      .values({
        tenantId: input.tenantId,
        connectedBy: input.userId,
        googleEmail: input.email,
        refreshTokenEnc: encrypt(input.refreshToken),
      })
      .onConflictDoUpdate({
        target: googleConnections.tenantId,
        set: {
          connectedBy: input.userId,
          googleEmail: input.email,
          refreshTokenEnc: encrypt(input.refreshToken),
          lastError: null,
        },
      });
    await audit(tx, {
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: "backup.connect",
      entityType: "backup",
      data: { email: input.email },
    });
    await enqueue(tx, {
      type: "backup.full",
      tenantId: input.tenantId,
      dedupeKey: `backup.full:${input.tenantId}`,
    });
  });
}

export async function disconnect(database: Database, tenantId: string, userId: string): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.delete(googleConnections).where(eq(googleConnections.tenantId, tenantId));
    await audit(tx, { tenantId, actorUserId: userId, action: "backup.disconnect", entityType: "backup" });
  });
}

/** Makes sure the Drive folder and spreadsheet exist; returns an access token and ids. */
async function prepare(database: DbOrTx, tenantId: string) {
  const conn = await getConnection(database, tenantId);
  if (!conn) return null;
  const token = await accessToken(decrypt(conn.refreshTokenEnc));
  let { folderId, spreadsheetId } = conn;
  if (!folderId || !spreadsheetId) {
    const [tenant] = await database
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const name = tenant?.name ?? "Business";
    folderId ??= await createFolder(token, `OmniSuite backup – ${name}`);
    spreadsheetId ??= await createSpreadsheet(token, `OmniSuite – ${name}`, folderId);
    await database
      .update(googleConnections)
      .set({ folderId, spreadsheetId })
      .where(eq(googleConnections.tenantId, tenantId));
  }
  return { token, folderId, spreadsheetId };
}

async function writeSets(database: DbOrTx, tenantId: string, sets: readonly ExportSet[]) {
  const ready = await prepare(database, tenantId);
  if (!ready) return;
  const existing = await sheetTitles(ready.token, ready.spreadsheetId);
  await addSheets(
    ready.token,
    ready.spreadsheetId,
    sets.filter((s) => !existing.includes(s)),
  );
  for (const set of sets) {
    const rows = await exportRows(database, tenantId, set);
    await replaceSheet(ready.token, ready.spreadsheetId, set, toTable(rows));
  }
}

async function recordResult(
  database: DbOrTx,
  tenantId: string,
  fields: Partial<typeof googleConnections.$inferInsert>,
) {
  await database.update(googleConnections).set(fields).where(eq(googleConnections.tenantId, tenantId));
}

/** Mirrors changed entities to their sheet tabs (one-way: app → Sheets). */
export async function syncChanges(database: Database, tenantId: string): Promise<void> {
  const pending = await database
    .select({ id: syncOutbox.id, entity: syncOutbox.entity })
    .from(syncOutbox)
    .where(and(eq(syncOutbox.tenantId, tenantId), isNull(syncOutbox.processedAt)))
    .limit(5000);
  if (pending.length === 0) return;
  const conn = await getConnection(database, tenantId);
  const ids = pending.map((p) => p.id);
  if (conn) {
    const sets = [...new Set(pending.flatMap((p) => ENTITY_SETS[p.entity] ?? []))];
    try {
      await writeSets(database, tenantId, [...sets, "audit_log"]);
      await recordResult(database, tenantId, { lastSyncedAt: new Date(), lastError: null });
    } catch (error) {
      await recordResult(database, tenantId, { lastError: String(error).slice(0, 1000) });
      throw error;
    }
  }
  // Without a connection there is nothing to mirror; clear the outbox so it doesn't grow.
  await database.update(syncOutbox).set({ processedAt: new Date() }).where(inArray(syncOutbox.id, ids));
}

/** Rewrites every tab (first connection, or "Sync now"). */
export async function fullSync(database: Database, tenantId: string): Promise<void> {
  try {
    await writeSets(database, tenantId, EXPORT_SET_NAMES);
    await recordResult(database, tenantId, { lastSyncedAt: new Date(), lastError: null });
    await database
      .update(syncOutbox)
      .set({ processedAt: new Date() })
      .where(and(eq(syncOutbox.tenantId, tenantId), isNull(syncOutbox.processedAt)));
  } catch (error) {
    await recordResult(database, tenantId, { lastError: String(error).slice(0, 1000) });
    throw error;
  }
}

/** Nightly full JSON snapshot in the Drive folder; keeps the last 30. */
export async function snapshot(database: Database, tenantId: string): Promise<void> {
  const ready = await prepare(database, tenantId);
  if (!ready) return;
  const [tenant] = await database.select().from(tenants).where(eq(tenants.id, tenantId));
  const day = today(parseTenantSettings(tenant?.settings).timezone);
  const data = await exportTenant(database, tenantId);
  try {
    await uploadJson(ready.token, ready.folderId, `snapshot-${day}.json`, JSON.stringify(data));
    await pruneSnapshots(ready.token, ready.folderId, 30);
    await recordResult(database, tenantId, { lastSnapshotAt: new Date(), lastError: null });
  } catch (error) {
    await recordResult(database, tenantId, { lastError: String(error).slice(0, 1000) });
    throw error;
  }
}

/** Tenants with a backup connection (for the nightly scheduler). */
export async function connectedTenants(database: DbOrTx) {
  return database
    .select({ tenantId: googleConnections.tenantId, lastSnapshotAt: googleConnections.lastSnapshotAt })
    .from(googleConnections);
}
