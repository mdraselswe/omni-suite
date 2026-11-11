import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { t } from "@/i18n";
import type { CustomValues } from "@/lib/custom-fields";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { leads, memberships, user } from "@/server/db/schema";
import type { Scope } from "@/server/rbac/resolve";
import type { TenantContext } from "@/server/tenancy/context";
import { insertClient } from "@/features/clients";

export async function listLeads(database: DbOrTx, ctx: TenantContext, scope: Scope) {
  return database
    .select({ lead: leads, ownerName: user.name })
    .from(leads)
    .leftJoin(memberships, eq(memberships.id, leads.ownerMembershipId))
    .leftJoin(user, eq(user.id, memberships.userId))
    .where(
      and(
        eq(leads.tenantId, ctx.tenant.id),
        scope === "all" ? undefined : eq(leads.ownerMembershipId, ctx.membership.id),
      ),
    )
    .orderBy(asc(leads.createdAt));
}

export type LeadInput = {
  name: string;
  company: string;
  email: string;
  phone: string;
  source: string;
  stage: string;
  valueMinor: bigint;
  notes: string;
  ownerMembershipId: string | null;
  custom: CustomValues;
};

function assertStage(ctx: TenantContext, stage: string) {
  if (!ctx.tenant.settings.pipelineStages.some((s) => s.key === stage))
    throw new UserError(t("leads.badStage"));
}

export async function createLead(database: Database, ctx: TenantContext, input: LeadInput): Promise<string> {
  assertStage(ctx, input.stage);
  return database.transaction(async (tx) => {
    const [row] = await tx
      .insert(leads)
      .values({
        tenantId: ctx.tenant.id,
        ...input,
        ownerMembershipId: input.ownerMembershipId ?? ctx.membership.id,
      })
      .returning({ id: leads.id });
    if (!row) throw new Error("Lead insert failed");
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "lead.create",
      entityType: "lead",
      entityId: row.id,
      data: { name: input.name },
    });
    await markChanged(tx, ctx.tenant.id, "lead", row.id);
    return row.id;
  });
}

async function loadLead(tx: DbOrTx, ctx: TenantContext, scope: Scope, id: string) {
  const [row] = await tx
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.id, id),
        eq(leads.tenantId, ctx.tenant.id),
        scope === "all" ? undefined : eq(leads.ownerMembershipId, ctx.membership.id),
      ),
    );
  if (!row) throw new UserError(t("leads.missing"));
  return row;
}

export async function updateLead(
  database: Database,
  ctx: TenantContext,
  scope: Scope,
  id: string,
  input: LeadInput,
): Promise<void> {
  assertStage(ctx, input.stage);
  await database.transaction(async (tx) => {
    await loadLead(tx, ctx, scope, id);
    await tx
      .update(leads)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(leads.id, id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "lead.update",
      entityType: "lead",
      entityId: id,
      data: { stage: input.stage },
    });
    await markChanged(tx, ctx.tenant.id, "lead", id);
  });
}

export async function moveLead(
  database: Database,
  ctx: TenantContext,
  scope: Scope,
  id: string,
  stage: string,
) {
  assertStage(ctx, stage);
  await database.transaction(async (tx) => {
    await loadLead(tx, ctx, scope, id);
    await tx.update(leads).set({ stage, updatedAt: new Date() }).where(eq(leads.id, id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "lead.move",
      entityType: "lead",
      entityId: id,
      data: { stage },
    });
    await markChanged(tx, ctx.tenant.id, "lead", id);
  });
}

/** Turns a lead into a client and moves it to the first "won" stage. */
export async function convertLead(
  database: Database,
  ctx: TenantContext,
  scope: Scope,
  id: string,
): Promise<string> {
  return database.transaction(async (tx) => {
    const lead = await loadLead(tx, ctx, scope, id);
    if (lead.clientId) return lead.clientId;
    const clientId = await insertClient(tx, ctx, {
      name: lead.company || lead.name,
      email: lead.email,
      phone: lead.phone,
      website: "",
      address: "",
      notes: lead.notes,
      status: "active",
      custom: {},
    });
    const won = ctx.tenant.settings.pipelineStages.find((s) => s.kind === "won")?.key ?? lead.stage;
    await tx.update(leads).set({ clientId, stage: won, updatedAt: new Date() }).where(eq(leads.id, id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "lead.convert",
      entityType: "lead",
      entityId: id,
      data: { clientId },
    });
    await markChanged(tx, ctx.tenant.id, "lead", id);
    return clientId;
  });
}

/** Open pipeline value and count (stages that are not won or lost). */
export async function pipelineSummary(database: DbOrTx, ctx: TenantContext) {
  const open = ctx.tenant.settings.pipelineStages.filter((s) => s.kind === "open").map((s) => s.key);
  if (open.length === 0) return { count: 0, valueMinor: 0n };
  const [row] = await database
    .select({
      count: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${leads.valueMinor}), 0)`,
    })
    .from(leads)
    .where(and(eq(leads.tenantId, ctx.tenant.id), inArray(leads.stage, open)));
  return { count: Number(row?.count ?? 0), valueMinor: BigInt(row?.value ?? "0") };
}
