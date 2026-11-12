import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { t } from "@/i18n";
import { sum } from "@/lib/money";
import { paginate, type PageRequest } from "@/lib/pagination";
import { UserError } from "@/server/action";
import { audit, markChanged, toJsonSafe } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import {
  capitalContributions,
  distributionRuns,
  memberships,
  ownershipEvents,
  ownershipPeriods,
  partners,
  profitRuleApprovals,
  profitRules,
  timeEntries,
  transactions,
} from "@/server/db/schema";
import { notify } from "@/server/shared";
import type { TenantContext } from "@/server/tenancy/context";
import { assertOpenDate, insertTransaction, profitAndLoss, totalOfKind } from "@/features/finance";
import {
  calculateProfit,
  combineResults,
  holdingsFromPercentages,
  issueUnitsForInvestment,
  monthsCovered,
  profitRuleSchema,
  splitPeriod,
  transferUnits,
  type Holding,
  type PartnerInput,
  type ProfitResult,
  type ProfitRule,
} from "./profit";

/* ─── Partners ─────────────────────────────────────────────────── */

export async function holdingsOn(database: DbOrTx, tenantId: string, date: string): Promise<Holding[]> {
  const rows = await database
    .select({ partnerId: ownershipPeriods.partnerId, units: ownershipPeriods.units })
    .from(ownershipPeriods)
    .where(
      and(
        eq(ownershipPeriods.tenantId, tenantId),
        lte(ownershipPeriods.effectiveFrom, date),
        or(isNull(ownershipPeriods.effectiveTo), sql`${ownershipPeriods.effectiveTo} > ${date}`),
      ),
    );
  return rows;
}

async function lastOwnershipDate(database: DbOrTx, tenantId: string): Promise<string | null> {
  const [row] = await database
    .select({ date: ownershipEvents.date })
    .from(ownershipEvents)
    .where(eq(ownershipEvents.tenantId, tenantId))
    .orderBy(desc(ownershipEvents.date))
    .limit(1);
  return row?.date ?? null;
}

export async function listPartners(database: DbOrTx, tenantId: string, onDate: string) {
  const [rows, capital, holdings] = await Promise.all([
    database.select().from(partners).where(eq(partners.tenantId, tenantId)).orderBy(asc(partners.joinedOn)),
    database
      .select({
        partnerId: capitalContributions.partnerId,
        total: sql<string>`coalesce(sum(${capitalContributions.amountMinor}), 0)`,
      })
      .from(capitalContributions)
      .where(eq(capitalContributions.tenantId, tenantId))
      .groupBy(capitalContributions.partnerId),
    holdingsOn(database, tenantId, onDate),
  ]);
  const totalUnits = sum(holdings.map((h) => h.units));
  return rows.map((p) => {
    const units = holdings.find((h) => h.partnerId === p.id)?.units ?? 0n;
    return {
      ...p,
      capitalMinor: BigInt(capital.find((c) => c.partnerId === p.id)?.total ?? "0"),
      units,
      /** Basis points of ownership (10000 = 100%). */
      ownershipBp: totalUnits === 0n ? 0 : Number((units * 10000n * 2n + totalUnits) / (totalUnits * 2n)),
    };
  });
}

export type PartnerRow = Awaited<ReturnType<typeof listPartners>>[number];

/**
 * A partner's app login must be an active team member of this business, linked to
 * one partner only, so nobody can approve profit rules on someone else's behalf.
 */
async function assertMembershipLink(
  tx: DbOrTx,
  tenantId: string,
  membershipId: string | null,
  partnerId: string | null,
): Promise<void> {
  if (!membershipId) return;
  const [member] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.id, membershipId),
        eq(memberships.tenantId, tenantId),
        eq(memberships.kind, "internal"),
        eq(memberships.status, "active"),
      ),
    );
  if (!member) throw new UserError(t("partners.memberMissing"));
  const [taken] = await tx
    .select({ id: partners.id })
    .from(partners)
    .where(and(eq(partners.tenantId, tenantId), eq(partners.membershipId, membershipId)));
  if (taken && taken.id !== partnerId) throw new UserError(t("partners.memberTaken"));
}

export async function createPartner(
  database: Database,
  ctx: TenantContext,
  input: { name: string; email: string; joinedOn: string; membershipId: string | null },
): Promise<string> {
  return database.transaction(async (tx) => {
    await assertMembershipLink(tx, ctx.tenant.id, input.membershipId, null);
    const [row] = await tx
      .insert(partners)
      .values({ tenantId: ctx.tenant.id, ...input })
      .returning({ id: partners.id });
    if (!row) throw new Error("Partner insert failed");
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "partner.create",
      entityType: "partner",
      entityId: row.id,
      data: input,
    });
    await markChanged(tx, ctx.tenant.id, "partner", row.id);
    return row.id;
  });
}

export async function updatePartner(
  database: Database,
  ctx: TenantContext,
  id: string,
  input: { name: string; email: string; membershipId: string | null; leftOn: string | null },
): Promise<void> {
  await database.transaction(async (tx) => {
    const current = await assertPartner(tx, ctx.tenant.id, id);
    await assertMembershipLink(tx, ctx.tenant.id, input.membershipId, id);
    if (current.membershipId !== input.membershipId) {
      // Relinking during a vote would let someone decide for another partner.
      const [open] = await tx
        .select({ id: profitRules.id })
        .from(profitRules)
        .where(and(eq(profitRules.tenantId, ctx.tenant.id), eq(profitRules.status, "proposed")))
        .limit(1);
      if (open) throw new UserError(t("partners.linkDuringVote"));
    }
    await tx
      .update(partners)
      .set(input)
      .where(and(eq(partners.id, id), eq(partners.tenantId, ctx.tenant.id)));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "partner.update",
      entityType: "partner",
      entityId: id,
      data: input,
    });
    await markChanged(tx, ctx.tenant.id, "partner", id);
  });
}

async function assertPartner(tx: DbOrTx, tenantId: string, id: string) {
  const [row] = await tx
    .select()
    .from(partners)
    .where(and(eq(partners.id, id), eq(partners.tenantId, tenantId)));
  if (!row) throw new UserError(t("partners.unknown"));
  return row;
}

/* ─── Capital ──────────────────────────────────────────────────── */

async function insertCapital(
  tx: DbOrTx,
  ctx: TenantContext,
  input: {
    partnerId: string;
    date: string;
    kind: "cash" | "asset" | "work";
    amountMinor: bigint;
    description: string;
    accountId: string | null;
    /** The investment event these units came from, if any. */
    ownershipEventId?: string | null;
  },
): Promise<void> {
  const partner = await assertPartner(tx, ctx.tenant.id, input.partnerId);
  await assertOpenDate(tx, ctx.tenant.id, input.date);
  let transactionId: string | null = null;
  if (input.kind === "cash" && input.accountId) {
    transactionId = await insertTransaction(tx, ctx, {
      kind: "capital_in",
      accountId: input.accountId,
      date: input.date,
      description: `${t("partners.capital")}: ${partner.name}${input.description ? ` (${input.description})` : ""}`,
      amountMinor: input.amountMinor,
      partnerId: input.partnerId,
    });
  }
  // Capital is kept in the base currency (the ledger row has the converted amount).
  const [ledger] = transactionId
    ? await tx
        .select({ baseAmountMinor: transactions.baseAmountMinor })
        .from(transactions)
        .where(eq(transactions.id, transactionId))
    : [];
  const [row] = await tx
    .insert(capitalContributions)
    .values({
      tenantId: ctx.tenant.id,
      partnerId: input.partnerId,
      date: input.date,
      kind: input.kind,
      amountMinor: ledger?.baseAmountMinor ?? input.amountMinor,
      description: input.description,
      transactionId,
      ownershipEventId: input.ownershipEventId ?? null,
      createdBy: ctx.user.id,
    })
    .returning({ id: capitalContributions.id });
  if (!row) throw new Error("Capital insert failed");
  await audit(tx, {
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: "capital.record",
    entityType: "partner",
    entityId: input.partnerId,
    data: input,
  });
  await markChanged(tx, ctx.tenant.id, "capital", row.id);
}

export async function recordCapital(
  database: Database,
  ctx: TenantContext,
  input: Parameters<typeof insertCapital>[2],
): Promise<void> {
  if (input.amountMinor <= 0n) throw new UserError(t("form.amount"));
  await database.transaction((tx) => insertCapital(tx, ctx, input));
}

export async function capitalHistory(database: DbOrTx, tenantId: string, partnerId?: string) {
  return database
    .select({ c: capitalContributions, partnerName: partners.name })
    .from(capitalContributions)
    .innerJoin(partners, eq(partners.id, capitalContributions.partnerId))
    .where(
      and(
        eq(capitalContributions.tenantId, tenantId),
        partnerId ? eq(capitalContributions.partnerId, partnerId) : undefined,
      ),
    )
    .orderBy(desc(capitalContributions.date));
}

/* ─── Ownership ────────────────────────────────────────────────── */

async function applyOwnership(
  tx: DbOrTx,
  ctx: TenantContext,
  event: {
    type: "initial" | "investment" | "transfer" | "adjustment";
    date: string;
    data: unknown;
    note: string;
  },
  holdings: readonly Holding[],
): Promise<string> {
  await assertOpenDate(tx, ctx.tenant.id, event.date);
  const [ev] = await tx
    .insert(ownershipEvents)
    .values({
      tenantId: ctx.tenant.id,
      type: event.type,
      date: event.date,
      data: toJsonSafe({ ...(event.data as object), holdings }) as object,
      note: event.note,
      createdBy: ctx.user.id,
    })
    .returning({ id: ownershipEvents.id });
  if (!ev) throw new Error("Event insert failed");
  await tx
    .update(ownershipPeriods)
    .set({ effectiveTo: event.date })
    .where(and(eq(ownershipPeriods.tenantId, ctx.tenant.id), isNull(ownershipPeriods.effectiveTo)));
  const kept = holdings.filter((h) => h.units > 0n);
  if (kept.length > 0) {
    await tx.insert(ownershipPeriods).values(
      kept.map((h) => ({
        tenantId: ctx.tenant.id,
        partnerId: h.partnerId,
        units: h.units,
        effectiveFrom: event.date,
        eventId: ev.id,
      })),
    );
  }
  await audit(tx, {
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: `ownership.${event.type}`,
    entityType: "ownership",
    entityId: ev.id,
    data: { date: event.date, holdings },
  });
  await markChanged(tx, ctx.tenant.id, "ownership", ev.id);
  return ev.id;
}

async function assertAfterLast(tx: DbOrTx, tenantId: string, date: string) {
  const last = await lastOwnershipDate(tx, tenantId);
  if (!last) throw new UserError(t("partners.noOwnership"));
  if (date <= last) throw new UserError(t("partners.ownershipDateOrder", { date: last }));
}

export async function setInitialOwnership(
  database: Database,
  ctx: TenantContext,
  input: { date: string; shares: { partnerId: string; basisPoints: number }[]; note: string },
): Promise<void> {
  await database.transaction(async (tx) => {
    if (await lastOwnershipDate(tx, ctx.tenant.id)) throw new UserError(t("partners.alreadyInitial"));
    const shares = input.shares.filter((s) => s.basisPoints > 0);
    if (shares.reduce((a, s) => a + s.basisPoints, 0) !== 10000) throw new UserError(t("rules.mustSum"));
    for (const s of shares) await assertPartner(tx, ctx.tenant.id, s.partnerId);
    await applyOwnership(
      tx,
      ctx,
      { type: "initial", date: input.date, data: {}, note: input.note },
      holdingsFromPercentages(shares),
    );
  });
}

export async function previewInvestment(
  database: DbOrTx,
  tenantId: string,
  input: { partnerId: string; date: string; preMoneyMinor: bigint; investmentMinor: bigint },
) {
  const before = await holdingsOn(database, tenantId, input.date);
  if (before.length === 0) throw new UserError(t("partners.noOwnership"));
  const after = issueUnitsForInvestment(before, input.partnerId, input.preMoneyMinor, input.investmentMinor);
  return { before, after };
}

export async function recordInvestment(
  database: Database,
  ctx: TenantContext,
  input: {
    partnerId: string;
    date: string;
    preMoneyMinor: bigint;
    investmentMinor: bigint;
    accountId: string | null;
    note: string;
  },
): Promise<void> {
  if (input.preMoneyMinor <= 0n || input.investmentMinor <= 0n) throw new UserError(t("form.amount"));
  await database.transaction(async (tx) => {
    await assertPartner(tx, ctx.tenant.id, input.partnerId);
    await assertAfterLast(tx, ctx.tenant.id, input.date);
    const { after } = await previewInvestment(tx, ctx.tenant.id, input);
    const eventId = await applyOwnership(
      tx,
      ctx,
      {
        type: "investment",
        date: input.date,
        data: {
          partnerId: input.partnerId,
          preMoneyMinor: input.preMoneyMinor,
          investmentMinor: input.investmentMinor,
        },
        note: input.note,
      },
      after,
    );
    await insertCapital(tx, ctx, {
      partnerId: input.partnerId,
      date: input.date,
      kind: "cash",
      amountMinor: input.investmentMinor,
      description: t("partners.event.investment"),
      accountId: input.accountId,
      ownershipEventId: eventId,
    });
  });
}

export async function recordTransfer(
  database: Database,
  ctx: TenantContext,
  input: { fromPartnerId: string; toPartnerId: string; date: string; basisPoints: number; note: string },
): Promise<void> {
  await database.transaction(async (tx) => {
    await assertPartner(tx, ctx.tenant.id, input.fromPartnerId);
    await assertPartner(tx, ctx.tenant.id, input.toPartnerId);
    await assertAfterLast(tx, ctx.tenant.id, input.date);
    const before = await holdingsOn(tx, ctx.tenant.id, input.date);
    const total = sum(before.map((h) => h.units));
    const units = (total * BigInt(input.basisPoints)) / 10000n;
    let after: Holding[];
    try {
      after = transferUnits(before, input.fromPartnerId, input.toPartnerId, units);
    } catch {
      throw new UserError(t("form.amount"));
    }
    await applyOwnership(
      tx,
      ctx,
      { type: "transfer", date: input.date, data: { ...input, units }, note: input.note },
      after,
    );
  });
}

export async function ownershipHistory(database: DbOrTx, tenantId: string) {
  return database
    .select()
    .from(ownershipEvents)
    .where(eq(ownershipEvents.tenantId, tenantId))
    .orderBy(desc(ownershipEvents.date), desc(ownershipEvents.createdAt));
}

/* ─── Profit rules ─────────────────────────────────────────────── */

export async function listRules(database: DbOrTx, tenantId: string) {
  const rules = await database
    .select()
    .from(profitRules)
    .where(eq(profitRules.tenantId, tenantId))
    .orderBy(desc(profitRules.version));
  const approvals = rules.length
    ? await database
        .select()
        .from(profitRuleApprovals)
        .where(
          inArray(
            profitRuleApprovals.ruleId,
            rules.map((r) => r.id),
          ),
        )
    : [];
  return rules.map((r) => ({
    ...r,
    config: profitRuleSchema.parse(r.config),
    approvals: approvals.filter((a) => a.ruleId === r.id),
  }));
}

export type RuleRow = Awaited<ReturnType<typeof listRules>>[number];

/** The active rule that applies on `date` (latest effectiveFrom ≤ date, then highest version). */
export function ruleFor(rules: readonly RuleRow[], date: string): RuleRow | undefined {
  return rules
    .filter((r) => r.status === "active" && r.effectiveFrom <= date)
    .sort((a, b) =>
      a.effectiveFrom === b.effectiveFrom
        ? b.version - a.version
        : a.effectiveFrom < b.effectiveFrom
          ? 1
          : -1,
    )[0];
}

async function activePartnerIds(
  tx: DbOrTx,
  tenantId: string,
): Promise<{ id: string; membershipId: string | null; name: string }[]> {
  return tx
    .select({ id: partners.id, membershipId: partners.membershipId, name: partners.name })
    .from(partners)
    .where(and(eq(partners.tenantId, tenantId), isNull(partners.leftOn)));
}

export async function proposeRule(
  database: Database,
  ctx: TenantContext,
  input: { config: ProfitRule; effectiveFrom: string; note: string },
): Promise<string> {
  const config = profitRuleSchema.parse(input.config);
  return database.transaction(async (tx) => {
    const active = await activePartnerIds(tx, ctx.tenant.id);
    if (active.length === 0) throw new UserError(t("partners.needPartners"));
    const ids = new Set(active.map((p) => p.id));
    const referenced = [
      ...config.fees.map((f) => f.partnerId),
      ...(config.method.type === "fixed_percent" ? config.method.shares.map((s) => s.partnerId) : []),
    ];
    if (referenced.some((id) => !ids.has(id))) throw new UserError(t("partners.unknown"));
    const [max] = await tx
      .select({ v: sql<number>`coalesce(max(${profitRules.version}), 0)` })
      .from(profitRules)
      .where(eq(profitRules.tenantId, ctx.tenant.id));
    const [rule] = await tx
      .insert(profitRules)
      .values({
        tenantId: ctx.tenant.id,
        version: Number(max?.v ?? 0) + 1,
        effectiveFrom: input.effectiveFrom,
        status: "proposed",
        config,
        note: input.note,
        proposedBy: ctx.user.id,
      })
      .returning({ id: profitRules.id });
    if (!rule) throw new Error("Rule insert failed");
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "profitRule.propose",
      entityType: "profitRule",
      entityId: rule.id,
      data: input,
    });
    // The proposer approves their own proposal if they are a partner.
    const mine = active.find((p) => p.membershipId === ctx.membership.id);
    if (mine) await decide(tx, ctx, rule.id, mine.id, "approved");
    // Tell every other partner with an app login that a rule is waiting for them.
    const linked = active.filter((p) => p.membershipId && p.membershipId !== ctx.membership.id);
    if (linked.length > 0) {
      const users = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          inArray(
            memberships.id,
            linked.flatMap((p) => (p.membershipId ? [p.membershipId] : [])),
          ),
        );
      await notify(
        tx,
        ctx.tenant.id,
        users.map((u) => u.userId),
        {
          title: t("rules.notifyTitle"),
          body: t("rules.notifyBody", { by: ctx.user.name || ctx.user.email }),
          link: `/${ctx.tenant.slug}/partners/rules/`,
          email: true,
        },
      );
    }
    await markChanged(tx, ctx.tenant.id, "profitRule", rule.id);
    return rule.id;
  });
}

async function decide(
  tx: DbOrTx,
  ctx: TenantContext,
  ruleId: string,
  partnerId: string,
  decision: "approved" | "rejected",
): Promise<void> {
  const [rule] = await tx
    .select()
    .from(profitRules)
    .where(and(eq(profitRules.id, ruleId), eq(profitRules.tenantId, ctx.tenant.id)))
    // Partners deciding at the same moment must see each other's approval.
    .for("update");
  if (!rule) throw new UserError(t("rules.notProposed"));
  if (rule.status !== "proposed") throw new UserError(t("rules.notProposed"));
  await tx
    .delete(profitRuleApprovals)
    .where(and(eq(profitRuleApprovals.ruleId, ruleId), eq(profitRuleApprovals.partnerId, partnerId)));
  await tx.insert(profitRuleApprovals).values({ ruleId, partnerId, decision, decidedBy: ctx.user.id });

  const active = await activePartnerIds(tx, ctx.tenant.id);
  const decisions = await tx.select().from(profitRuleApprovals).where(eq(profitRuleApprovals.ruleId, ruleId));
  let status: "proposed" | "active" | "rejected" = "proposed";
  if (decisions.some((d) => d.decision === "rejected")) status = "rejected";
  else if (active.every((p) => decisions.some((d) => d.partnerId === p.id && d.decision === "approved"))) {
    status = "active";
  }
  if (status !== "proposed") {
    await tx.update(profitRules).set({ status }).where(eq(profitRules.id, ruleId));
    if (status === "active") {
      await tx
        .update(profitRules)
        .set({ status: "superseded" })
        .where(
          and(
            eq(profitRules.tenantId, ctx.tenant.id),
            eq(profitRules.status, "active"),
            eq(profitRules.effectiveFrom, rule.effectiveFrom),
            sql`${profitRules.id} <> ${ruleId}`,
          ),
        );
    }
  }
  await audit(tx, {
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: `profitRule.${decision}`,
    entityType: "profitRule",
    entityId: ruleId,
    data: { partnerId, result: status },
  });
}

/**
 * Records a partner's decision. Partners with app access decide for themselves;
 * for a partner without app access, someone with profit.propose records it.
 */
export async function decideRule(
  database: Database,
  ctx: TenantContext,
  input: { ruleId: string; partnerId: string; decision: "approved" | "rejected" },
): Promise<void> {
  await database.transaction(async (tx) => {
    const partner = await assertPartner(tx, ctx.tenant.id, input.partnerId);
    const self = partner.membershipId === ctx.membership.id;
    const onBehalf = partner.membershipId === null && ctx.permissions.has("profit.propose");
    if (!self && !onBehalf) throw new UserError(t("rules.notPartner"));
    await decide(tx, ctx, input.ruleId, input.partnerId, input.decision);
    await markChanged(tx, ctx.tenant.id, "profitRule", input.ruleId);
  });
}

/* ─── Distributions ────────────────────────────────────────────── */

export type Segment = {
  start: string;
  end: string;
  ruleId: string;
  ruleVersion: number;
  result: ProfitResult;
};

/** Calculates profit shares for a period, splitting it where ownership or the rule changed. */
export async function computeDistribution(
  database: DbOrTx,
  tenantId: string,
  input: { start: string; end: string; manualLabor: Record<string, bigint> },
): Promise<{ segments: Segment[]; total: ProfitResult; partnerNames: Record<string, string> }> {
  if (input.end < input.start) throw new UserError(t("finance.periodRange"));
  const [rules, events, allPartners] = await Promise.all([
    listRules(database, tenantId),
    ownershipHistory(database, tenantId),
    database.select().from(partners).where(eq(partners.tenantId, tenantId)),
  ]);
  const boundaries = [
    ...events.map((e) => e.date),
    ...rules.filter((r) => r.status === "active").map((r) => r.effectiveFrom),
    ...allPartners.flatMap((p) => [p.joinedOn, ...(p.leftOn ? [p.leftOn] : [])]),
  ];
  const segments: Segment[] = [];
  for (const [start, end] of splitPeriod(input.start, input.end, boundaries)) {
    const rule = ruleFor(rules, start);
    if (!rule) throw new UserError(t("rules.noRule", { date: start }));
    const inSegment = allPartners.filter((p) => p.joinedOn <= end && (!p.leftOn || p.leftOn > start));
    const [pnl, holdings, capitalRows, laborRows] = await Promise.all([
      profitAndLoss(database, tenantId, start, end),
      holdingsOn(database, tenantId, start),
      database
        .select({
          partnerId: capitalContributions.partnerId,
          total: sql<string>`coalesce(sum(${capitalContributions.amountMinor}), 0)`,
        })
        .from(capitalContributions)
        .where(and(eq(capitalContributions.tenantId, tenantId), lte(capitalContributions.date, end)))
        .groupBy(capitalContributions.partnerId),
      rule.config.method.type === "weighted" && rule.config.method.laborSource === "time_entries"
        ? database
            .select({
              membershipId: timeEntries.membershipId,
              minutes: sql<string>`coalesce(sum(${timeEntries.minutes}), 0)`,
            })
            .from(timeEntries)
            .where(
              and(
                eq(timeEntries.tenantId, tenantId),
                gte(timeEntries.date, start),
                lte(timeEntries.date, end),
              ),
            )
            .groupBy(timeEntries.membershipId)
        : Promise.resolve([] as { membershipId: string; minutes: string }[]),
    ]);
    const method = rule.config.method;
    const inputs: PartnerInput[] = inSegment.map((p) => ({
      partnerId: p.id,
      capitalMinor: BigInt(capitalRows.find((c) => c.partnerId === p.id)?.total ?? "0"),
      units: holdings.find((h) => h.partnerId === p.id)?.units ?? 0n,
      labor:
        method.type === "weighted" && method.laborSource === "time_entries"
          ? BigInt(laborRows.find((l) => l.membershipId === p.membershipId)?.minutes ?? "0")
          : (input.manualLabor[p.id] ?? 0n),
    }));
    const result = calculateProfit({
      revenueMinor: pnl.incomeMinor,
      expenseMinor: pnl.expenseMinor,
      partners: inputs,
      rule: rule.config,
      feeMonths: monthsCovered(start, end),
    });
    segments.push({ start, end, ruleId: rule.id, ruleVersion: rule.version, result });
  }
  return {
    segments,
    total: combineResults(segments.map((s) => s.result)),
    partnerNames: Object.fromEntries(allPartners.map((p) => [p.id, p.name])),
  };
}

export async function saveDistribution(
  database: Database,
  ctx: TenantContext,
  input: { start: string; end: string; manualLabor: Record<string, bigint>; final: boolean },
): Promise<string> {
  return database.transaction(async (tx) => {
    if (input.final) {
      const overlap = await tx
        .select({ id: distributionRuns.id })
        .from(distributionRuns)
        .where(
          and(
            eq(distributionRuns.tenantId, ctx.tenant.id),
            eq(distributionRuns.status, "final"),
            lte(distributionRuns.periodStart, input.end),
            gte(distributionRuns.periodEnd, input.start),
          ),
        );
      if (overlap.length > 0) throw new UserError(t("dist.overlap"));
    }
    const computed = await computeDistribution(tx, ctx.tenant.id, input);
    const [row] = await tx
      .insert(distributionRuns)
      .values({
        tenantId: ctx.tenant.id,
        periodStart: input.start,
        periodEnd: input.end,
        status: input.final ? "final" : "draft",
        inputs: toJsonSafe({ manualLabor: input.manualLabor, segments: computed.segments }) as object,
        result: toJsonSafe({ ...computed.total, partnerNames: computed.partnerNames }) as object,
        createdBy: ctx.user.id,
      })
      .returning({ id: distributionRuns.id });
    if (!row) throw new Error("Run insert failed");
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: input.final ? "distribution.final" : "distribution.draft",
      entityType: "distribution",
      entityId: row.id,
      data: { start: input.start, end: input.end },
    });
    await markChanged(tx, ctx.tenant.id, "distribution", row.id);
    return row.id;
  });
}

export async function finaliseDistribution(
  database: Database,
  ctx: TenantContext,
  id: string,
): Promise<void> {
  await database.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(distributionRuns)
      .where(and(eq(distributionRuns.id, id), eq(distributionRuns.tenantId, ctx.tenant.id)));
    if (!run) throw new UserError(t("finance.txMissing"));
    if (run.status === "final") throw new UserError(t("dist.alreadyFinal"));
    const manual = ((run.inputs as { manualLabor?: Record<string, string> }).manualLabor ?? {}) as Record<
      string,
      string
    >;
    await tx.delete(distributionRuns).where(eq(distributionRuns.id, id));
    // Recalculate at finalisation so late entries are included, then lock.
    const manualLabor = Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, BigInt(v)]));
    const overlap = await tx
      .select({ id: distributionRuns.id })
      .from(distributionRuns)
      .where(
        and(
          eq(distributionRuns.tenantId, ctx.tenant.id),
          eq(distributionRuns.status, "final"),
          lte(distributionRuns.periodStart, run.periodEnd),
          gte(distributionRuns.periodEnd, run.periodStart),
        ),
      );
    if (overlap.length > 0) throw new UserError(t("dist.overlap"));
    const computed = await computeDistribution(tx, ctx.tenant.id, {
      start: run.periodStart,
      end: run.periodEnd,
      manualLabor,
    });
    await tx.insert(distributionRuns).values({
      id: run.id,
      tenantId: ctx.tenant.id,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      status: "final",
      inputs: toJsonSafe({ manualLabor, segments: computed.segments }) as object,
      result: toJsonSafe({ ...computed.total, partnerNames: computed.partnerNames }) as object,
      createdBy: ctx.user.id,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "distribution.final",
      entityType: "distribution",
      entityId: id,
    });
    await markChanged(tx, ctx.tenant.id, "distribution", id, "delete");
  });
}

export async function deleteDraftDistribution(
  database: Database,
  ctx: TenantContext,
  id: string,
): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .delete(distributionRuns)
      .where(
        and(
          eq(distributionRuns.id, id),
          eq(distributionRuns.tenantId, ctx.tenant.id),
          eq(distributionRuns.status, "draft"),
        ),
      )
      .returning({ id: distributionRuns.id });
    if (!row) return;
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "distribution.delete",
      entityType: "distribution",
      entityId: id,
      data: {},
    });
    await markChanged(tx, ctx.tenant.id, "distribution", id);
  });
}

export type StoredResult = {
  profitMinor: string;
  reserveMinor: string;
  feesMinor: string;
  distributableMinor: string;
  lines: { partnerId: string; feeMinor: string; shareMinor: string; totalMinor: string }[];
  partnerNames: Record<string, string>;
};

function distributionRow(r: typeof distributionRuns.$inferSelect) {
  return {
    ...r,
    result: r.result as StoredResult,
    segmentCount: ((r.inputs as { segments?: unknown[] }).segments ?? []).length,
  };
}

export async function listDistributions(database: DbOrTx, tenantId: string) {
  const rows = await database
    .select()
    .from(distributionRuns)
    .where(eq(distributionRuns.tenantId, tenantId))
    .orderBy(desc(distributionRuns.periodStart), desc(distributionRuns.createdAt), desc(distributionRuns.id));
  return rows.map(distributionRow);
}

/** One page of saved distribution runs, latest period first. */
export async function pageDistributions(database: DbOrTx, tenantId: string, page: PageRequest) {
  const where = eq(distributionRuns.tenantId, tenantId);
  return paginate(
    page,
    async () => {
      const [row] = await database.select({ n: count() }).from(distributionRuns).where(where);
      return row?.n ?? 0;
    },
    async (limit, offset) => {
      const rows = await database
        .select()
        .from(distributionRuns)
        .where(where)
        .orderBy(
          desc(distributionRuns.periodStart),
          desc(distributionRuns.createdAt),
          desc(distributionRuns.id),
        )
        .limit(limit)
        .offset(offset);
      return rows.map(distributionRow);
    },
  );
}

/** A partner's running account: capital, final profit shares, drawings. */
export async function partnerStatement(database: DbOrTx, tenantId: string, partnerId: string) {
  const [capital, runs, drawingsMinor, drawings] = await Promise.all([
    capitalHistory(database, tenantId, partnerId),
    listDistributions(database, tenantId),
    totalOfKind(database, tenantId, "drawing", { partnerId }),
    database
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          eq(transactions.kind, "drawing"),
          eq(transactions.partnerId, partnerId),
        ),
      )
      .orderBy(desc(transactions.date)),
  ]);
  const shares = runs
    .filter((r) => r.status === "final")
    .map((r) => ({
      id: r.id,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      totalMinor: BigInt(r.result.lines.find((l) => l.partnerId === partnerId)?.totalMinor ?? "0"),
    }));
  const capitalMinor = sum(capital.map((c) => c.c.amountMinor));
  const sharesMinor = sum(shares.map((s) => s.totalMinor));
  return {
    capital,
    capitalMinor,
    shares,
    sharesMinor,
    drawings,
    drawingsMinor,
    owedMinor: sharesMinor - drawingsMinor,
  };
}
