import "server-only";
import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { createInvitationIn } from "@/features/team";
import { t } from "@/i18n";
import { businessName } from "@/lib/business-name";
import type { CustomValues } from "@/lib/custom-fields";
import { paginate, type PageRequest } from "@/lib/pagination";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import {
  clients,
  files,
  invitations,
  invoices,
  onboardingRequests,
  onboardingTemplates,
  projectMembers,
  projects,
  rolePermissions,
  roles,
} from "@/server/db/schema";
import type { Scope } from "@/server/rbac/resolve";
import { matchesSearch } from "@/server/search";
import { clientUserIds, notify, usersWithPermission } from "@/server/shared";
import { hasPermission, type TenantContext } from "@/server/tenancy/context";

/** Row filter for a member's clients.read scope. */
export function clientScopeFilter(ctx: TenantContext, scope: Scope): SQL | undefined {
  if (scope === "all") return undefined;
  const assigned = sql`${clients.id} in (
    select ${projects.clientId} from ${projects}
    inner join ${projectMembers} on ${projectMembers.projectId} = ${projects.id}
    where ${projectMembers.membershipId} = ${ctx.membership.id} and ${projects.clientId} is not null)`;
  const own = eq(clients.createdBy, ctx.user.id);
  return scope === "assigned" ? or(own, assigned) : own;
}

export type ClientFilter = {
  /** Words to find in the name, email or phone. */
  q?: string;
  status?: "active" | "inactive";
};

/** One page of clients by name, with what each owes on sent invoices. */
export async function pageClients(
  database: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  filter: ClientFilter,
  page: PageRequest,
) {
  const where = and(
    eq(clients.tenantId, ctx.tenant.id),
    clientScopeFilter(ctx, scope),
    filter.status ? eq(clients.status, filter.status) : undefined,
    matchesSearch(filter.q, [clients.name, clients.email, clients.phone]),
  );
  // Owed per client (base and other currencies alike, as clients are billed in one currency).
  const owed = database
    .select({
      clientId: invoices.clientId,
      owed: sql<string>`sum(${invoices.totalMinor} - ${invoices.paidMinor} - ${invoices.writtenOffMinor} - ${invoices.creditedMinor})`.as(
        "owed",
      ),
    })
    .from(invoices)
    .where(and(eq(invoices.tenantId, ctx.tenant.id), inArray(invoices.status, ["sent", "partially_paid"])))
    .groupBy(invoices.clientId)
    .as("owed");
  return paginate(
    page,
    async () => {
      const [row] = await database.select({ n: count() }).from(clients).where(where);
      return row?.n ?? 0;
    },
    async (limit, offset) => {
      const rows = await database
        .select({ client: clients, balance: sql<string>`coalesce(${owed.owed}, 0)` })
        .from(clients)
        .leftJoin(owed, eq(owed.clientId, clients.id))
        .where(where)
        .orderBy(asc(clients.name), asc(clients.id))
        .limit(limit)
        .offset(offset);
      return rows.map((r) => ({ ...r.client, balanceMinor: BigInt(r.balance) }));
    },
  );
}

export async function getClient(database: DbOrTx, ctx: TenantContext, scope: Scope, id: string) {
  const [row] = await database
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.tenantId, ctx.tenant.id), clientScopeFilter(ctx, scope)));
  return row ?? null;
}

export type ClientInput = {
  name: string;
  email: string;
  contactName?: string;
  billingEmail?: string;
  phone: string;
  website: string;
  address: string;
  notes: string;
  status: "active" | "inactive";
  custom: CustomValues;
};

export async function insertClient(tx: DbOrTx, ctx: TenantContext, input: ClientInput): Promise<string> {
  {
    const [row] = await tx
      .insert(clients)
      .values({ tenantId: ctx.tenant.id, createdBy: ctx.user.id, ...input })
      .returning({ id: clients.id });
    if (!row) throw new Error("Client insert failed");
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "client.create",
      entityType: "client",
      entityId: row.id,
      data: { name: input.name },
    });
    await markChanged(tx, ctx.tenant.id, "client", row.id);
    return row.id;
  }
}

export async function createClient(
  database: Database,
  ctx: TenantContext,
  input: ClientInput,
): Promise<string> {
  return database.transaction((tx) => insertClient(tx, ctx, input));
}

export async function updateClient(
  database: Database,
  ctx: TenantContext,
  id: string,
  input: ClientInput,
): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .update(clients)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(clients.id, id), eq(clients.tenantId, ctx.tenant.id)))
      .returning({ id: clients.id });
    if (!row) throw new UserError(t("clients.missing"));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "client.update",
      entityType: "client",
      entityId: id,
      data: input,
    });
    await markChanged(tx, ctx.tenant.id, "client", id);
  });
}

/* ─── Onboarding ───────────────────────────────────────────────── */

export const ONBOARDING_FIELD_TYPES = ["text", "textarea", "select", "file"] as const;
export type OnboardingFieldType = (typeof ONBOARDING_FIELD_TYPES)[number];

/** One question. `options` are the choices of a "select" (empty for every other type). */
export type OnboardingField = {
  key: string;
  label: string;
  type: OnboardingFieldType;
  required: boolean;
  options: string[];
};

/** Most choices one question offers, and longest choice. */
const MAX_OPTIONS = 50;
const MAX_OPTION_LENGTH = 200;
/** Most files one answer may point at. */
const MAX_FILES_PER_ANSWER = 20;

function cleanOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const o of value) {
    if (typeof o !== "string") continue;
    const v = o.trim().slice(0, MAX_OPTION_LENGTH);
    if (v) seen.add(v);
    if (seen.size >= MAX_OPTIONS) break;
  }
  return [...seen];
}

/**
 * Stored template fields → questions. Tolerant: old templates (text/textarea, no
 * options) keep working, unknown types read as text, a choice without options as text.
 */
export function parseTemplateFields(value: unknown): OnboardingField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((f): OnboardingField[] => {
    if (typeof f !== "object" || f === null) return [];
    const o = f as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.label !== "string") return [];
    const known = ONBOARDING_FIELD_TYPES.find((type) => type === o.type) ?? "text";
    const options = known === "select" ? cleanOptions(o.options) : [];
    const type = known === "select" && options.length === 0 ? "text" : known;
    return [{ key: o.key, label: o.label, type, required: o.required === true, options }];
  });
}

/**
 * The template editor's line format → questions. One question per line:
 * "Label | type | required", where type is text, textarea, file or
 * "select: Option A, Option B". Throws a UserError naming a choice without options.
 */
export function parseQuestionLines(text: string): OnboardingField[] {
  const used = new Set<string>();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i): OnboardingField => {
      const [label = "", typePart = "", required = ""] = line.split("|").map((p) => p.trim());
      const [typeName = "", ...rest] = typePart.split(":");
      const typeKey = typeName.trim().toLowerCase();
      const type = ONBOARDING_FIELD_TYPES.find((x) => x === typeKey) ?? "text";
      const options = type === "select" ? cleanOptions(rest.join(":").split(",")) : [];
      if (type === "select" && options.length === 0) {
        throw new UserError(t("access.onboarding.selectNeedsOptions", { field: label || `#${i + 1}` }));
      }
      let key =
        label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "")
          .slice(0, 40) || `q${i + 1}`;
      if (used.has(key)) key = `${key}_${i + 1}`;
      used.add(key);
      return { key, label, type, required: required.toLowerCase() === "required", options };
    });
}

/** Questions → the editor's line format (the inverse of parseQuestionLines). */
export function questionLines(fields: readonly OnboardingField[]): string {
  return fields
    .map((f) => {
      const type = f.type === "select" ? `select: ${f.options.join(", ")}` : f.type;
      return [f.label, type, f.required ? "required" : ""].filter(Boolean).join(" | ");
    })
    .join("\n");
}

/** File ids stored as a "file" answer (a list; tolerant of a single id). */
export function answerFileIds(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v !== "");
}

export async function listTemplates(database: DbOrTx, tenantId: string) {
  const rows = await database
    .select()
    .from(onboardingTemplates)
    .where(eq(onboardingTemplates.tenantId, tenantId))
    .orderBy(asc(onboardingTemplates.name));
  return rows.map((r) => ({ ...r, fields: parseTemplateFields(r.fields) }));
}

export async function saveTemplate(
  database: Database,
  ctx: TenantContext,
  input: { id: string | null; name: string; fields: OnboardingField[]; checklist: string[] },
): Promise<void> {
  // Stored in the parsed shape, so what is saved is exactly what the portal shows.
  const fields = parseTemplateFields(input.fields);
  await database.transaction(async (tx) => {
    let id = input.id;
    if (id) {
      const [row] = await tx
        .update(onboardingTemplates)
        .set({ name: input.name, fields, checklist: input.checklist })
        .where(and(eq(onboardingTemplates.id, id), eq(onboardingTemplates.tenantId, ctx.tenant.id)))
        .returning({ id: onboardingTemplates.id });
      if (!row) throw new UserError(t("form.invalid"));
    } else {
      const [row] = await tx
        .insert(onboardingTemplates)
        .values({ tenantId: ctx.tenant.id, name: input.name, fields, checklist: input.checklist })
        .returning({ id: onboardingTemplates.id });
      if (!row) throw new Error("Template insert failed");
      id = row.id;
    }
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "onboardingTemplate.save",
      entityType: "onboardingTemplate",
      entityId: id,
      data: { name: input.name, types: fields.map((f) => f.type) },
    });
    await markChanged(tx, ctx.tenant.id, "onboardingTemplate", id);
  });
}

/** Deletes an onboarding form that was never sent (sent forms keep the client's answers readable). */
export async function deleteTemplate(database: Database, ctx: TenantContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [used] = await tx
      .select({ id: onboardingRequests.id })
      .from(onboardingRequests)
      .where(and(eq(onboardingRequests.tenantId, ctx.tenant.id), eq(onboardingRequests.templateId, id)))
      .limit(1);
    if (used) throw new UserError(t("onboarding.templateInUse"));
    const [row] = await tx
      .delete(onboardingTemplates)
      .where(and(eq(onboardingTemplates.id, id), eq(onboardingTemplates.tenantId, ctx.tenant.id)))
      .returning({ name: onboardingTemplates.name });
    if (!row) throw new UserError(t("form.invalid"));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "onboardingTemplate.delete",
      entityType: "onboardingTemplate",
      entityId: id,
      data: { name: row.name },
    });
    await markChanged(tx, ctx.tenant.id, "onboardingTemplate", id, "delete");
  });
}

/**
 * Who will see an onboarding form sent to this client:
 * - "portal": portal users who may answer it are notified (and emailed) now;
 * - "pendingInvite": nobody yet, but a pending portal invitation will give someone access;
 * - "invited": nobody, so the first portal user was invited along with it.
 */
export type OnboardingDelivery = "portal" | "pendingInvite" | "invited";

/** Open portal invitations of a client whose roles let the invitee answer onboarding forms. */
async function pendingOnboardingInvites(tx: DbOrTx, tenantId: string, clientId: string): Promise<number> {
  const open = await tx
    .select({ roleIds: invitations.roleIds })
    .from(invitations)
    .where(
      and(
        eq(invitations.tenantId, tenantId),
        eq(invitations.clientId, clientId),
        eq(invitations.kind, "client"),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    );
  const roleIds = [...new Set(open.flatMap((r) => r.roleIds))];
  if (roleIds.length === 0) return 0;
  const granting = await tx
    .selectDistinct({ roleId: rolePermissions.roleId })
    .from(rolePermissions)
    .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
    .where(
      and(
        eq(roles.tenantId, tenantId),
        inArray(rolePermissions.roleId, roleIds),
        eq(rolePermissions.permission, "portal.onboarding"),
      ),
    );
  const ok = new Set(granting.map((g) => g.roleId));
  return open.filter((r) => r.roleIds.some((id) => ok.has(id))).length;
}

/**
 * Who at a client can receive an onboarding form: portal users who may answer
 * it, any portal users at all, and pending invitations that will let someone answer.
 */
export async function onboardingReach(database: DbOrTx, tenantId: string, clientId: string) {
  const [canAnswer, portalUsers, pendingInvites] = await Promise.all([
    clientUserIds(database, tenantId, clientId, "portal.onboarding"),
    clientUserIds(database, tenantId, clientId),
    pendingOnboardingInvites(database, tenantId, clientId),
  ]);
  return { canAnswer: canAnswer.length, portalUsers: portalUsers.length, pendingInvites };
}

/** The client portal role that can answer onboarding forms (the default client owner role first). */
async function onboardingRoleId(tx: DbOrTx, tenantId: string): Promise<string | null> {
  const rows = await tx
    .selectDistinct({ id: roles.id, key: roles.key })
    .from(roles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(
      and(
        eq(roles.tenantId, tenantId),
        eq(roles.audience, "client"),
        eq(rolePermissions.permission, "portal.onboarding"),
      ),
    );
  return (rows.find((r) => r.key === "client_owner") ?? rows[0])?.id ?? null;
}

/**
 * Sends an onboarding form to a client. Never silent: if nobody at the client
 * can open it, it is only sent when a pending invitation will give someone
 * access, or when `inviteEmail` is given (the first portal user is invited in
 * the same step, if the actor may invite). Otherwise a UserError says what to do.
 */
export async function sendOnboarding(
  database: Database,
  ctx: TenantContext,
  input: { clientId: string; templateId: string; inviteEmail?: string | null },
): Promise<{ id: string; delivery: OnboardingDelivery }> {
  return database.transaction(async (tx) => {
    const [client] = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.id, input.clientId), eq(clients.tenantId, ctx.tenant.id)));
    const [template] = await tx
      .select()
      .from(onboardingTemplates)
      .where(
        and(eq(onboardingTemplates.id, input.templateId), eq(onboardingTemplates.tenantId, ctx.tenant.id)),
      );
    if (!client || !template) throw new UserError(t("clients.missing"));

    const recipients = await clientUserIds(tx, ctx.tenant.id, client.id, "portal.onboarding");
    let delivery: OnboardingDelivery = "portal";
    if (recipients.length === 0) {
      if ((await pendingOnboardingInvites(tx, ctx.tenant.id, client.id)) > 0) {
        delivery = "pendingInvite";
      } else if (input.inviteEmail) {
        if (!hasPermission(ctx, "members.invite")) throw new UserError(t("access.onboarding.cantInvite"));
        const roleId = await onboardingRoleId(tx, ctx.tenant.id);
        if (!roleId) throw new UserError(t("access.onboarding.noRole"));
        await createInvitationIn(tx, ctx, {
          email: input.inviteEmail,
          kind: "client",
          clientId: client.id,
          roleIds: [roleId],
        });
        delivery = "invited";
      } else {
        const anyone = (await clientUserIds(tx, ctx.tenant.id, client.id)).length > 0;
        throw new UserError(
          t(anyone ? "access.onboarding.noOneMayAnswer" : "access.onboarding.noPortalUser", {
            client: client.name,
          }),
        );
      }
    }

    const [row] = await tx
      .insert(onboardingRequests)
      .values({ tenantId: ctx.tenant.id, clientId: client.id, templateId: template.id })
      .returning({ id: onboardingRequests.id });
    if (!row) throw new Error("Onboarding insert failed");
    await notify(tx, ctx.tenant.id, recipients, {
      title: t("onboarding.notifyTitle", { name: businessName(ctx.tenant) }),
      body: template.name,
      link: `/${ctx.tenant.slug}/portal/onboarding`,
      email: true,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "onboarding.send",
      entityType: "client",
      entityId: client.id,
      data: { template: template.name, delivery },
    });
    await markChanged(tx, ctx.tenant.id, "onboarding", row.id);
    return { id: row.id, delivery };
  });
}

export async function onboardingForClient(database: DbOrTx, tenantId: string, clientId: string) {
  const rows = await database
    .select({ request: onboardingRequests, template: onboardingTemplates })
    .from(onboardingRequests)
    .innerJoin(onboardingTemplates, eq(onboardingTemplates.id, onboardingRequests.templateId))
    .where(and(eq(onboardingRequests.tenantId, tenantId), eq(onboardingRequests.clientId, clientId)))
    .orderBy(desc(onboardingRequests.createdAt));
  return rows.map((r) => ({
    ...r.request,
    templateName: r.template.name,
    fields: parseTemplateFields(r.template.fields),
    checklist: r.template.checklist,
  }));
}

/** Names of the files given as onboarding answers (only this client's own files). */
export async function onboardingAnswerFiles(
  database: DbOrTx,
  tenantId: string,
  clientId: string,
  ids: readonly string[],
  options: { clientVisibleOnly?: boolean } = {},
): Promise<Map<string, { name: string; size: number }>> {
  const valid = [...new Set(ids)].filter((id) => z.uuid().safeParse(id).success);
  if (valid.length === 0) return new Map();
  const rows = await database
    .select({ id: files.id, name: files.name, size: files.size })
    .from(files)
    .where(
      and(
        eq(files.tenantId, tenantId),
        eq(files.entityType, "client"),
        eq(files.entityId, clientId),
        inArray(files.id, valid),
        options.clientVisibleOnly ? eq(files.clientVisible, true) : undefined,
      ),
    );
  return new Map(rows.map((r) => [r.id, { name: r.name, size: r.size }]));
}

export async function openOnboarding(database: DbOrTx, tenantId: string) {
  return database
    .select({ request: onboardingRequests, clientName: clients.name, templateName: onboardingTemplates.name })
    .from(onboardingRequests)
    .innerJoin(clients, eq(clients.id, onboardingRequests.clientId))
    .innerJoin(onboardingTemplates, eq(onboardingTemplates.id, onboardingRequests.templateId))
    .where(
      and(
        eq(onboardingRequests.tenantId, tenantId),
        inArray(onboardingRequests.status, ["sent", "submitted"]),
      ),
    )
    .orderBy(desc(onboardingRequests.createdAt));
}

export type OnboardingAnswers = Record<string, string | string[]>;

/** The client fills in the questionnaire (portal). */
export async function submitOnboarding(
  database: Database,
  ctx: TenantContext,
  requestId: string,
  answers: OnboardingAnswers,
): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .select({ request: onboardingRequests, template: onboardingTemplates })
      .from(onboardingRequests)
      .innerJoin(onboardingTemplates, eq(onboardingTemplates.id, onboardingRequests.templateId))
      .where(and(eq(onboardingRequests.id, requestId), eq(onboardingRequests.tenantId, ctx.tenant.id)));
    if (!row || (ctx.membership.kind === "client" && row.request.clientId !== ctx.membership.clientId)) {
      throw new UserError(t("clients.missing"));
    }
    if (row.request.status === "completed") throw new UserError(t("onboarding.completed"));
    const fields = parseTemplateFields(row.template.fields);
    const clean: Record<string, string | string[]> = {};
    for (const f of fields) {
      const raw = answers[f.key];
      if (f.type === "file") {
        const ids = [...new Set(answerFileIds(raw))].slice(0, MAX_FILES_PER_ANSWER);
        if (f.required && ids.length === 0) {
          throw new UserError(t("onboarding.missingAnswer", { field: f.label }));
        }
        // Only files of this client that the client can see may be an answer.
        const known = await onboardingAnswerFiles(tx, ctx.tenant.id, row.request.clientId, ids, {
          clientVisibleOnly: true,
        });
        if (known.size !== ids.length) {
          throw new UserError(t("access.onboarding.fileMissing", { field: f.label }));
        }
        clean[f.key] = ids;
        continue;
      }
      const v = (typeof raw === "string" ? raw : (raw?.[0] ?? "")).trim().slice(0, 5000);
      if (f.required && !v) throw new UserError(t("onboarding.missingAnswer", { field: f.label }));
      if (f.type === "select" && v && !f.options.includes(v)) {
        throw new UserError(t("access.onboarding.invalidChoice", { field: f.label }));
      }
      clean[f.key] = v;
    }
    await tx
      .update(onboardingRequests)
      .set({ answers: clean, status: "submitted", submittedAt: new Date() })
      .where(eq(onboardingRequests.id, requestId));
    await notify(tx, ctx.tenant.id, await usersWithPermission(tx, ctx.tenant.id, "onboarding.manage"), {
      title: t("onboarding.submittedTitle"),
      body: row.template.name,
      link: `/${ctx.tenant.slug}/clients/${row.request.clientId}`,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "onboarding.submit",
      entityType: "client",
      entityId: row.request.clientId,
    });
    await markChanged(tx, ctx.tenant.id, "onboarding", requestId);
  });
}

/** Team ticks checklist items and can mark the onboarding complete. */
export async function updateOnboardingChecklist(
  database: Database,
  ctx: TenantContext,
  requestId: string,
  done: string[],
  complete: boolean,
): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .update(onboardingRequests)
      .set({ checklistDone: done, ...(complete ? { status: "completed" as const } : {}) })
      .where(and(eq(onboardingRequests.id, requestId), eq(onboardingRequests.tenantId, ctx.tenant.id)))
      .returning({ clientId: onboardingRequests.clientId });
    if (!row) throw new UserError(t("clients.missing"));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: complete ? "onboarding.complete" : "onboarding.checklist",
      entityType: "client",
      entityId: row.clientId,
      data: { done },
    });
    await markChanged(tx, ctx.tenant.id, "onboarding", requestId);
  });
}
