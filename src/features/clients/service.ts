import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { t } from "@/i18n";
import type { CustomValues } from "@/lib/custom-fields";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import {
  clients,
  invoices,
  onboardingRequests,
  onboardingTemplates,
  projectMembers,
  projects,
} from "@/server/db/schema";
import type { Scope } from "@/server/rbac/resolve";
import { clientUserIds, notify, usersWithPermission } from "@/server/shared";
import type { TenantContext } from "@/server/tenancy/context";

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

export async function listClients(
  database: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  filter: { q?: string; status?: "active" | "inactive" } = {},
) {
  const balance = sql<string>`coalesce((select sum(${invoices.totalMinor} - ${invoices.paidMinor}) from ${invoices}
    where ${invoices.clientId} = ${clients.id} and ${invoices.status} in ('sent','partially_paid')), 0)`;
  const rows = await database
    .select({ client: clients, balance })
    .from(clients)
    .where(
      and(
        eq(clients.tenantId, ctx.tenant.id),
        clientScopeFilter(ctx, scope),
        filter.status ? eq(clients.status, filter.status) : undefined,
        filter.q
          ? or(
              ilike(clients.name, `%${filter.q.replace(/[%_]/g, "")}%`),
              ilike(clients.email, `%${filter.q.replace(/[%_]/g, "")}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(clients.name))
    .limit(500);
  return rows.map((r) => ({ ...r.client, balanceMinor: BigInt(r.balance) }));
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

export type OnboardingField = { key: string; label: string; type: "text" | "textarea"; required: boolean };

export function parseTemplateFields(value: unknown): OnboardingField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((f) => {
    if (typeof f !== "object" || f === null) return [];
    const o = f as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.label !== "string") return [];
    return [
      {
        key: o.key,
        label: o.label,
        type: o.type === "textarea" ? "textarea" : "text",
        required: o.required === true,
      },
    ];
  });
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
  await database.transaction(async (tx) => {
    if (input.id) {
      await tx
        .update(onboardingTemplates)
        .set({ name: input.name, fields: input.fields, checklist: input.checklist })
        .where(and(eq(onboardingTemplates.id, input.id), eq(onboardingTemplates.tenantId, ctx.tenant.id)));
    } else {
      await tx.insert(onboardingTemplates).values({
        tenantId: ctx.tenant.id,
        name: input.name,
        fields: input.fields,
        checklist: input.checklist,
      });
    }
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "onboardingTemplate.save",
      entityType: "onboardingTemplate",
      entityId: input.id,
      data: { name: input.name },
    });
  });
}

export async function sendOnboarding(
  database: Database,
  ctx: TenantContext,
  input: { clientId: string; templateId: string },
): Promise<string> {
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
    const [row] = await tx
      .insert(onboardingRequests)
      .values({ tenantId: ctx.tenant.id, clientId: client.id, templateId: template.id })
      .returning({ id: onboardingRequests.id });
    if (!row) throw new Error("Onboarding insert failed");
    await notify(tx, ctx.tenant.id, await clientUserIds(tx, ctx.tenant.id, client.id), {
      title: t("onboarding.notifyTitle", { name: ctx.tenant.name }),
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
      data: { template: template.name },
    });
    await markChanged(tx, ctx.tenant.id, "onboarding", row.id);
    return row.id;
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

/** The client fills in the questionnaire (portal). */
export async function submitOnboarding(
  database: Database,
  ctx: TenantContext,
  requestId: string,
  answers: Record<string, string>,
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
    const clean: Record<string, string> = {};
    for (const f of fields) {
      const v = (answers[f.key] ?? "").trim().slice(0, 5000);
      if (f.required && !v) throw new UserError(t("onboarding.missingAnswer", { field: f.label }));
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
