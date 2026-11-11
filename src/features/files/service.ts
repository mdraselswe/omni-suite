import "server-only";
import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { serverEnv } from "@/config/env";
import { t } from "@/i18n";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { clients, files, projectMembers, projects, user } from "@/server/db/schema";
import type { Scope } from "@/server/rbac/resolve";
import { removeFile, storeFile } from "@/server/storage";
import type { TenantContext } from "@/server/tenancy/context";

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
  if (scope === "all") return undefined;
  const mine = eq(files.uploadedBy, ctx.user.id);
  if (scope === "own") return mine;
  return or(
    mine,
    and(
      eq(files.entityType, "project"),
      sql`${files.entityId} in (select ${projectMembers.projectId} from ${projectMembers} where ${projectMembers.membershipId} = ${ctx.membership.id})`,
    ),
  );
}

export async function listFiles(
  database: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  filter: { entityType?: FileEntity; entityId?: string } = {},
) {
  return database
    .select({ file: files, uploaderName: user.name })
    .from(files)
    .leftJoin(user, eq(user.id, files.uploadedBy))
    .where(
      and(
        eq(files.tenantId, ctx.tenant.id),
        fileScope(ctx, scope),
        filter.entityType ? eq(files.entityType, filter.entityType) : undefined,
        filter.entityId ? eq(files.entityId, filter.entityId) : undefined,
      ),
    )
    .orderBy(desc(files.createdAt))
    .limit(500);
}

export async function fileForDownload(database: DbOrTx, ctx: TenantContext, scope: Scope, id: string) {
  const [row] = await database
    .select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.tenantId, ctx.tenant.id), fileScope(ctx, scope)));
  return row ?? null;
}

async function assertEntity(tx: DbOrTx, ctx: TenantContext, entityType: FileEntity, entityId: string | null) {
  if (entityType === "general") return;
  if (!entityId) throw new UserError(t("form.invalid"));
  if (ctx.membership.kind === "client") {
    const clientId = ctx.membership.clientId;
    const ok =
      (entityType === "client" && entityId === clientId) ||
      (entityType === "project" &&
        (
          await tx
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.id, entityId), eq(projects.clientId, clientId ?? "")))
        ).length > 0);
    if (!ok) throw new UserError(t("projects.missing"));
    return;
  }
  const table = entityType === "project" ? projects : entityType === "client" ? clients : null;
  if (!table) return;
  const found = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, entityId), eq(table.tenantId, ctx.tenant.id)));
  if (found.length === 0) throw new UserError(t("projects.missing"));
}

export async function uploadFile(
  database: Database,
  ctx: TenantContext,
  input: { file: File; entityType: FileEntity; entityId: string | null; clientVisible: boolean },
): Promise<string> {
  const max = serverEnv().MAX_UPLOAD_MB;
  if (input.file.size === 0) throw new UserError(t("files.empty"));
  if (input.file.size > max * 1024 * 1024) throw new UserError(t("files.tooLarge", { mb: max }));
  await assertEntity(database, ctx, input.entityType, input.entityId);
  const key = await storeFile(ctx.tenant.id, new Uint8Array(await input.file.arrayBuffer()));
  try {
    return await database.transaction(async (tx) => {
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
          // Files uploaded by a client are shared with them by definition.
          clientVisible: ctx.membership.kind === "client" ? true : input.clientVisible,
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
