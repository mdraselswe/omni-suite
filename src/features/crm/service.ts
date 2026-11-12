import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { t } from "@/i18n";
import type { CustomValues } from "@/lib/custom-fields";
import { paginate, type PageRequest } from "@/lib/pagination";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { leads, memberships, user } from "@/server/db/schema";
import type { Scope } from "@/server/rbac/resolve";
import { matchesSearch } from "@/server/search";
import { customFieldsFor } from "@/server/shared";
import type { TenantContext } from "@/server/tenancy/context";
import { insertClient } from "@/features/clients";
import { carryCustomValues } from "./carry-custom";

export type LeadFilter = {
  /** Words to find in the name, company, email or phone. */
  q?: string;
  /** false (default): active leads only; true: active and archived. */
  archived?: boolean;
  /** Only these stages. */
  stages?: readonly string[];
  /** None of these stages (e.g. leads whose stage was removed from the pipeline). */
  notStages?: readonly string[];
  /** Open leads with a follow-up on or before this day (most overdue first). */
  dueBy?: string;
};

/** Stage keys of the open (not won or lost) part of the pipeline. */
const openStages = (ctx: TenantContext) =>
  ctx.tenant.settings.pipelineStages.filter((s) => s.kind === "open").map((s) => s.key);

/** Open, active leads whose follow-up day has come. */
function dueWhere(ctx: TenantContext, day: string): SQL | undefined {
  const open = openStages(ctx);
  return and(
    isNull(leads.archivedAt),
    lte(leads.followUpDate, day),
    open.length > 0 ? inArray(leads.stage, open) : sql`false`,
  );
}

function leadScope(ctx: TenantContext, scope: Scope): SQL | undefined {
  return scope === "all" ? undefined : eq(leads.ownerMembershipId, ctx.membership.id);
}

function leadWhere(ctx: TenantContext, scope: Scope, filter: LeadFilter): SQL | undefined {
  return and(
    eq(leads.tenantId, ctx.tenant.id),
    leadScope(ctx, scope),
    filter.archived ? undefined : isNull(leads.archivedAt),
    filter.stages ? inArray(leads.stage, [...filter.stages]) : undefined,
    filter.notStages?.length ? notInArray(leads.stage, [...filter.notStages]) : undefined,
    matchesSearch(filter.q, [leads.name, leads.company, leads.email, leads.phone]),
    filter.dueBy ? dueWhere(ctx, filter.dueBy) : undefined,
  );
}

async function leadRows(
  database: DbOrTx,
  where: SQL | undefined,
  limit: number,
  offset = 0,
  byFollowUp = false,
) {
  return database
    .select({ lead: leads, ownerName: user.name })
    .from(leads)
    .leftJoin(memberships, eq(memberships.id, leads.ownerMembershipId))
    .leftJoin(user, eq(user.id, memberships.userId))
    .where(where)
    .orderBy(...(byFollowUp ? [asc(leads.followUpDate)] : []), desc(leads.createdAt), desc(leads.id))
    .limit(limit)
    .offset(offset);
}

export type LeadRow = Awaited<ReturnType<typeof leadRows>>[number];

/** One page of leads, newest first, and the number that match (the list view). */
export async function pageLeads(
  database: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  filter: LeadFilter,
  page: PageRequest,
) {
  const where = leadWhere(ctx, scope, filter);
  return paginate(
    page,
    async () => {
      const [row] = await database.select({ n: count() }).from(leads).where(where);
      return row?.n ?? 0;
    },
    (limit, offset) => leadRows(database, where, limit, offset, Boolean(filter.dueBy)),
  );
}

/**
 * The board: the newest `perStage` leads of every stage (newest first). Columns show
 * how many there are in total (leadStageTotals) and link to the list view for the rest.
 */
export async function boardLeads(
  database: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  filter: LeadFilter,
  perStage: number,
) {
  const newest = sql`${leads.id} in (
    select ranked.id from (
      select ${leads.id} as id,
        row_number() over (partition by ${leads.stage} order by ${leads.createdAt} desc, ${leads.id} desc) as n
      from ${leads} where ${leadWhere(ctx, scope, filter)}
    ) ranked where ranked.n <= ${perStage})`;
  // Every stage is capped, so the whole board is bounded; the limit is only a safety net.
  return leadRows(database, newest, perStage * 50);
}

/** Count and value per stage (whole pipeline, not just the loaded page), active leads only. */
export async function leadStageTotals(
  database: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  filter: LeadFilter = {},
) {
  const rows = await database
    .select({
      stage: leads.stage,
      count: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${leads.valueMinor}), 0)`,
    })
    .from(leads)
    .where(leadWhere(ctx, scope, filter))
    .groupBy(leads.stage);
  return new Map(rows.map((r) => [r.stage, { count: Number(r.count), valueMinor: BigInt(r.value) }]));
}

/** Number of archived leads the member can see (for the "show archived" toggle). */
export async function archivedLeadCount(database: DbOrTx, ctx: TenantContext, scope: Scope) {
  const [row] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.tenantId, ctx.tenant.id), leadScope(ctx, scope), isNotNull(leads.archivedAt)));
  return Number(row?.n ?? 0);
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
  followUpDate?: string | null;
  ownerMembershipId: string | null;
  custom: CustomValues;
};

function assertStage(ctx: TenantContext, stage: string) {
  if (!ctx.tenant.settings.pipelineStages.some((s) => s.key === stage))
    throw new UserError(t("leads.badStage"));
}

/** The owner picked in a form must be an active team member of this business. */
async function assertOwner(tx: DbOrTx, ctx: TenantContext, membershipId: string | null) {
  if (!membershipId || membershipId === ctx.membership.id) return;
  const [m] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.id, membershipId),
        eq(memberships.tenantId, ctx.tenant.id),
        eq(memberships.kind, "internal"),
        eq(memberships.status, "active"),
      ),
    );
  if (!m) throw new UserError(t("leads.badOwner"));
}

export async function createLead(database: Database, ctx: TenantContext, input: LeadInput): Promise<string> {
  assertStage(ctx, input.stage);
  return database.transaction(async (tx) => {
    await assertOwner(tx, ctx, input.ownerMembershipId);
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
    .where(and(eq(leads.id, id), eq(leads.tenantId, ctx.tenant.id), leadScope(ctx, scope)));
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
    const lead = await loadLead(tx, ctx, scope, id);
    if (input.ownerMembershipId !== lead.ownerMembershipId)
      await assertOwner(tx, ctx, input.ownerMembershipId);
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
    // Carry over custom values whose key also exists (and validates) as a client field.
    const custom = carryCustomValues(await customFieldsFor(tx, ctx.tenant.id, "client"), lead.custom);
    const clientId = await insertClient(tx, ctx, {
      name: lead.company || lead.name,
      email: lead.email,
      phone: lead.phone,
      website: "",
      address: "",
      notes: lead.notes,
      status: "active",
      custom,
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

/** Archive (spam, duplicates, dead leads) or restore a lead. Archived leads leave the board and totals. */
export async function setLeadArchived(
  database: Database,
  ctx: TenantContext,
  scope: Scope,
  id: string,
  archived: boolean,
): Promise<void> {
  await database.transaction(async (tx) => {
    await loadLead(tx, ctx, scope, id);
    await tx
      .update(leads)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(leads.id, id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: archived ? "lead.archive" : "lead.unarchive",
      entityType: "lead",
      entityId: id,
    });
    await markChanged(tx, ctx.tenant.id, "lead", id);
  });
}

/**
 * Open pipeline value and count (stages that are not won or lost), counting only
 * the leads this member may see ("own" scope: the leads they own).
 */
export async function pipelineSummary(database: DbOrTx, ctx: TenantContext, today?: string) {
  const open = openStages(ctx);
  const scope = ctx.permissions.get("leads.read");
  if (open.length === 0 || !scope) return { count: 0, valueMinor: 0n, dueCount: 0 };
  const [row] = await database
    .select({
      count: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${leads.valueMinor}), 0)`,
      due: today
        ? sql<number>`count(*) filter (where ${leads.followUpDate} <= ${today})::int`
        : sql<number>`0`,
    })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, ctx.tenant.id),
        inArray(leads.stage, open),
        isNull(leads.archivedAt),
        leadScope(ctx, scope),
      ),
    );
  return {
    count: Number(row?.count ?? 0),
    valueMinor: BigInt(row?.value ?? "0"),
    dueCount: Number(row?.due ?? 0),
  };
}
