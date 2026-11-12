import "server-only";
import { and, count, desc, eq, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { limits } from "@/config";
import { serverEnv } from "@/config/env";
import { t } from "@/i18n";
import { paginate, type PageRequest } from "@/lib/pagination";
import { fields, formObject, UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { clients, files, projectMembers, projects, transactions, user } from "@/server/db/schema";
import type { Scope } from "@/server/rbac/resolve";
import { matchesSearch } from "@/server/search";
import { notify, usersWithPermission } from "@/server/shared";
import { removeFile, storeFile } from "@/server/storage";
import type { TenantContext } from "@/server/tenancy/context";
import { clientScopeFilter } from "@/features/clients";
import { projectScopeFilter } from "@/features/projects";

export type FileEntity = "project" | "client" | "transaction" | "general";

/** Files a member may see: clients only see shared files of their own client and its projects. */
function fileScope(ctx: TenantContext, scope: Scope): SQL | undefined {
  if (ctx.membership.kind === "client") {
    const clientId = ctx.membership.clientId ?? "00000000-0000-0000-0000-000000000000";
    return and(
      eq(files.clientVisible, true),
      or(
        and(eq(files.entityType, "client"), eq(files.entityId, clientId)),
        and(
          eq(files.entityType, "project"),
          sql`${files.entityId} in (select ${projects.id} from ${projects} where ${projects.clientId} = ${clientId})`,
        ),
      ),
    );
  }
  // Receipts on ledger rows are finance records: only for people who may read the ledger.
  const receipts = ctx.permissions.has("finance.read") ? undefined : ne(files.entityType, "transaction");
  if (scope === "all") return receipts;
  const mine = eq(files.uploadedBy, ctx.user.id);
  if (scope === "own") return and(receipts, mine);
  return and(
    receipts,
    or(
      mine,
      and(
        eq(files.entityType, "project"),
        sql`${files.entityId} in (select ${projectMembers.projectId} from ${projectMembers} where ${projectMembers.membershipId} = ${ctx.membership.id})`,
      ),
    ),
  );
}

export type FileFilter = {
  entityType?: FileEntity;
  entityId?: string;
  /** Words to find in the file name. */
  q?: string;
};

function fileWhere(ctx: TenantContext, scope: Scope, filter: FileFilter): SQL | undefined {
  return and(
    eq(files.tenantId, ctx.tenant.id),
    fileScope(ctx, scope),
    filter.entityType ? eq(files.entityType, filter.entityType) : undefined,
    filter.entityId ? eq(files.entityId, filter.entityId) : undefined,
    matchesSearch(filter.q, [files.name]),
  );
}

async function fileRows(database: DbOrTx, where: SQL | undefined, limit: number, offset = 0) {
  return database
    .select({ file: files, uploaderName: user.name })
    .from(files)
    .leftJoin(user, eq(user.id, files.uploadedBy))
    .where(where)
    .orderBy(desc(files.createdAt), desc(files.id))
    .limit(limit)
    .offset(offset);
}

/** Up to `limit` files, newest first (detail pages). Lists use pageFiles. */
export async function listFiles(
  database: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  filter: FileFilter & { limit?: number } = {},
) {
  return fileRows(database, fileWhere(ctx, scope, filter), filter.limit ?? 500);
}

/** One page of files and the number that match. */
export async function pageFiles(
  database: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  filter: FileFilter,
  page: PageRequest,
) {
  const where = fileWhere(ctx, scope, filter);
  return paginate(
    page,
    async () => {
      const [row] = await database.select({ n: count() }).from(files).where(where);
      return row?.n ?? 0;
    },
    (limit, offset) => fileRows(database, where, limit, offset),
  );
}

export async function fileForDownload(database: DbOrTx, ctx: TenantContext, scope: Scope, id: string) {
  const [row] = await database
    .select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.tenantId, ctx.tenant.id), fileScope(ctx, scope)));
  return row ?? null;
}

type Target = { name: string; link: string };

/**
 * Checks the upload target is one the uploader may write to and returns its name and link.
 * Clients: their own client record or its projects. Staff: targets inside their files.write
 * scope (a project they are on or created, a client they work for; "all" reaches any).
 */
async function assertTarget(
  tx: DbOrTx,
  ctx: TenantContext,
  entityType: FileEntity,
  entityId: string | null,
): Promise<Target> {
  const base = `/${ctx.tenant.slug}`;
  const isClient = ctx.membership.kind === "client";
  const scope: Scope | undefined = isClient ? "all" : ctx.permissions.get("files.write");
  if (!scope) throw new UserError(t("files.badTarget"));
  if (entityType === "general") {
    if (isClient) throw new UserError(t("files.badTarget"));
    return { name: t("files.entity.general"), link: `${base}/files` };
  }
  if (!entityId) throw new UserError(t("form.invalid"));
  if (entityType === "project") {
    const [p] = await tx
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(
        and(eq(projects.id, entityId), eq(projects.tenantId, ctx.tenant.id), projectScopeFilter(ctx, scope)),
      );
    if (!p) throw new UserError(t("files.badTarget"));
    return { name: p.name, link: `${base}/projects/${p.id}` };
  }
  if (entityType === "client") {
    const [c] = await tx
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(
        and(
          eq(clients.id, entityId),
          eq(clients.tenantId, ctx.tenant.id),
          isClient ? eq(clients.id, ctx.membership.clientId ?? "") : clientScopeFilter(ctx, scope),
        ),
      );
    if (!c) throw new UserError(t("files.badTarget"));
    return { name: c.name, link: `${base}/clients/${c.id}` };
  }
  // Receipts on ledger transactions: staff who can see the ledger.
  if (isClient || !ctx.permissions.has("finance.read")) throw new UserError(t("files.badTarget"));
  const [tr] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, entityId), eq(transactions.tenantId, ctx.tenant.id)));
  if (!tr) throw new UserError(t("files.badTarget"));
  return { name: t("files.entity.transaction"), link: `${base}/finance` };
}

/** Bytes of all files the business keeps. */
export async function storageUsed(database: DbOrTx, tenantId: string): Promise<number> {
  const [row] = await database
    .select({ bytes: sql<string>`coalesce(sum(${files.size}), 0)::bigint` })
    .from(files)
    .where(eq(files.tenantId, tenantId));
  return Number(row?.bytes ?? 0);
}

/** The business's storage quota in bytes (src/config/limits.ts). */
export function storageQuota(): number {
  return limits.storage.perBusinessMb * 1024 * 1024;
}

/** Throws when `size` more bytes would take the business over its storage quota. */
async function assertStorageFor(database: DbOrTx, tenantId: string, size: number): Promise<void> {
  const used = await storageUsed(database, tenantId);
  const quota = storageQuota();
  if (used + size > quota) {
    throw new UserError(t("security.storageFull", { limit: formatBytes(quota), used: formatBytes(used) }));
  }
}

const uploadFields = z.object({
  entityType: z.enum(["project", "client", "transaction", "general"]).default("general"),
  entityId: fields.optionalId(),
  clientVisible: fields.checkbox(),
});

/** The upload form's fields and file (server action or the upload route). */
export function parseUploadForm(formData: FormData) {
  const input = uploadFields.parse(formObject(formData));
  const file = formData.get("file");
  if (!(file instanceof File)) throw new UserError(t("files.empty"));
  return { ...input, file };
}

export async function uploadFile(
  database: Database,
  ctx: TenantContext,
  input: { file: File; entityType: FileEntity; entityId: string | null; clientVisible: boolean },
): Promise<string> {
  const max = serverEnv().MAX_UPLOAD_MB;
  if (input.file.size === 0) throw new UserError(t("files.empty"));
  if (input.file.size > max * 1024 * 1024) throw new UserError(t("files.tooLarge", { mb: max }));
  const target = await assertTarget(database, ctx, input.entityType, input.entityId);
  const isClient = ctx.membership.kind === "client";
  // Checked before writing to disk, and again under a per-business lock (parallel uploads).
  await assertStorageFor(database, ctx.tenant.id, input.file.size);
  const key = await storeFile(ctx.tenant.id, new Uint8Array(await input.file.arrayBuffer()));
  try {
    return await database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`files:${ctx.tenant.id}`}))`);
      await assertStorageFor(tx, ctx.tenant.id, input.file.size);
      const [row] = await tx
        .insert(files)
        .values({
          tenantId: ctx.tenant.id,
          entityType: input.entityType,
          entityId: input.entityId,
          name: input.file.name.slice(0, 200) || "file",
          mime: input.file.type || "application/octet-stream",
          size: input.file.size,
          storageKey: key,
          // Files uploaded by a client are shared with them by definition; general and
          // ledger files never reach the portal.
          clientVisible: isClient
            ? true
            : input.clientVisible && (input.entityType === "project" || input.entityType === "client"),
          uploadedBy: ctx.user.id,
        })
        .returning({ id: files.id });
      if (!row) throw new Error("File insert failed");
      await audit(tx, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        action: "file.upload",
        entityType: input.entityType,
        entityId: input.entityId,
        data: { name: input.file.name, size: input.file.size },
      });
      await markChanged(tx, ctx.tenant.id, "file", row.id);
      if (isClient) {
        // Tell the team a client sent something (staff without access to the target simply get a 404).
        const team = (await usersWithPermission(tx, ctx.tenant.id, "files.read")).filter(
          (id) => id !== ctx.user.id,
        );
        await notify(tx, ctx.tenant.id, team, {
          title: t("files.clientUploadedTitle", { name: input.file.name.slice(0, 100), target: target.name }),
          body: ctx.user.name,
          link: target.link,
        });
      }
      return row.id;
    });
  } catch (error) {
    await removeFile(key);
    throw error;
  }
}

export async function setFileVisibility(
  database: Database,
  ctx: TenantContext,
  scope: Scope,
  id: string,
  visible: boolean,
) {
  const [row] = await database
    .update(files)
    .set({ clientVisible: visible })
    .where(and(eq(files.id, id), eq(files.tenantId, ctx.tenant.id), fileScope(ctx, scope)))
    .returning({ id: files.id });
  if (!row) throw new UserError(t("projects.missing"));
}

export async function deleteFile(database: Database, ctx: TenantContext, scope: Scope, id: string) {
  const row = await database.transaction(async (tx) => {
    const [f] = await tx
      .delete(files)
      .where(and(eq(files.id, id), eq(files.tenantId, ctx.tenant.id), fileScope(ctx, scope)))
      .returning();
    if (!f) throw new UserError(t("projects.missing"));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "file.delete",
      entityType: f.entityType,
      entityId: f.entityId,
      data: { name: f.name },
    });
    await markChanged(tx, ctx.tenant.id, "file", id, "delete");
    return f;
  });
  await removeFile(row.storageKey);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
