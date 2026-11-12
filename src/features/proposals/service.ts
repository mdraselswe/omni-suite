import "server-only";
import { and, asc, count, desc, eq, isNotNull, lt, ne, notInArray, type SQL } from "drizzle-orm";
import { t } from "@/i18n";
import { addDays, formatDate } from "@/lib/dates";
import { computeTotals, formatDocNumber, lineAmount, type LineItem } from "@/lib/line-items";
import { allocateShare } from "@/lib/money";
import { paginate, type PageRequest } from "@/lib/pagination";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { clients, invoices, projects, proposals } from "@/server/db/schema";
import { matchesSearch } from "@/server/search";
import { ensureShareToken, shareUrl } from "@/server/share-links";
import { clientUserIds, nextCounter, notify, queueMail, usersWithPermission } from "@/server/shared";
import type { TenantContext } from "@/server/tenancy/context";
import { actorOf, insertInvoice, type Delivery } from "@/features/invoices";
import { createProjectTx } from "@/features/projects";
import { isProposalExpired } from "./status";

export type ProposalInput = {
  clientId: string;
  title: string;
  intro: string;
  terms: string;
  items: LineItem[];
  validUntil: string | null;
};

async function assertClient(tx: DbOrTx, tenantId: string, clientId: string) {
  const [c] = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)));
  if (!c) throw new UserError(t("clients.missing"));
}

export async function createProposal(
  database: Database,
  ctx: TenantContext,
  input: ProposalInput,
): Promise<string> {
  if (input.items.length === 0) throw new UserError(t("invoices.noItems"));
  return database.transaction(async (tx) => {
    await assertClient(tx, ctx.tenant.id, input.clientId);
    const totals = computeTotals(input.items, ctx.tenant.settings.tax.pricesIncludeTax);
    const number = formatDocNumber(
      ctx.tenant.settings.proposalPrefix,
      await nextCounter(tx, ctx.tenant.id, "proposal"),
    );
    const [row] = await tx
      .insert(proposals)
      .values({
        tenantId: ctx.tenant.id,
        ...input,
        number,
        currency: ctx.tenant.settings.currency,
        subtotalMinor: totals.subtotalMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        pricesIncludeTax: ctx.tenant.settings.tax.pricesIncludeTax,
        createdBy: ctx.user.id,
      })
      .returning({ id: proposals.id });
    if (!row) throw new Error("Proposal insert failed");
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "proposal.create",
      entityType: "proposal",
      entityId: row.id,
      data: { number, title: input.title },
    });
    await markChanged(tx, ctx.tenant.id, "proposal", row.id);
    return row.id;
  });
}

async function loadProposal(tx: DbOrTx, tenantId: string, id: string) {
  const [p] = await tx
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.tenantId, tenantId)))
    // Every caller changes the proposal: one change at a time.
    .for("update");
  if (!p) throw new UserError(t("proposals.missing"));
  return p;
}

export async function updateProposal(
  database: Database,
  ctx: TenantContext,
  id: string,
  input: ProposalInput,
) {
  if (input.items.length === 0) throw new UserError(t("invoices.noItems"));
  await database.transaction(async (tx) => {
    const p = await loadProposal(tx, ctx.tenant.id, id);
    if (p.status !== "draft") throw new UserError(t("invoices.onlyDraft"));
    await assertClient(tx, ctx.tenant.id, input.clientId);
    const totals = computeTotals(input.items, ctx.tenant.settings.tax.pricesIncludeTax);
    await tx
      .update(proposals)
      .set({
        ...input,
        subtotalMinor: totals.subtotalMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        pricesIncludeTax: ctx.tenant.settings.tax.pricesIncludeTax,
      })
      .where(eq(proposals.id, id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "proposal.update",
      entityType: "proposal",
      entityId: id,
    });
    await markChanged(tx, ctx.tenant.id, "proposal", id);
  });
}

export async function sendProposal(database: Database, ctx: TenantContext, id: string): Promise<Delivery> {
  return database.transaction(async (tx) => {
    const p = await loadProposal(tx, ctx.tenant.id, id);
    if (p.status !== "draft") throw new UserError(t("invoices.onlyDraft"));
    await tx.update(proposals).set({ status: "sent" }).where(eq(proposals.id, id));
    const business = ctx.tenant.settings.branding.displayName || ctx.tenant.name;
    const title = t("proposals.notifyTitle", { name: business });
    const portalUsers = await clientUserIds(tx, ctx.tenant.id, p.clientId, "portal.proposals");
    let delivery: Delivery = "none";
    if (portalUsers.length > 0) {
      await notify(tx, ctx.tenant.id, portalUsers, {
        title,
        body: p.title,
        link: `/${ctx.tenant.slug}/portal/proposals/${p.id}/`,
        email: true,
      });
      delivery = "portal";
    } else {
      const [client] = await tx
        .select({ name: clients.name, email: clients.email, contactName: clients.contactName })
        .from(clients)
        .where(eq(clients.id, p.clientId));
      if (client?.email) {
        await queueMail(
          tx,
          {
            to: client.email,
            subject: title,
            text: [
              t("invoices.emailGreeting", { name: client.contactName.trim() || client.name }),
              t("proposals.emailBody", { business, title: p.title, number: p.number }),
              // No login needed: the link opens this proposal, to read and accept or decline.
              t("share.proposalEmail", {
                url: shareUrl("proposal", await ensureShareToken(tx, "proposal", ctx.tenant.id, p.id)),
              }),
            ].join("\n\n"),
          },
          { tenantId: ctx.tenant.id },
        );
        delivery = "email";
      }
    }
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "proposal.send",
      entityType: "proposal",
      entityId: id,
      data: { delivery },
    });
    await markChanged(tx, ctx.tenant.id, "proposal", id);
    return delivery;
  });
}

/** Takes a sent (or expired) proposal back to draft so it can be changed and sent again. */
export async function reopenProposal(database: Database, ctx: TenantContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const p = await loadProposal(tx, ctx.tenant.id, id);
    if (p.status !== "sent" && p.status !== "declined") throw new UserError(t("proposals.cannotReopen"));
    await tx
      .update(proposals)
      .set({
        status: "draft",
        respondedAt: null,
        respondedByName: null,
        respondedIp: null,
        declineReason: "",
      })
      .where(eq(proposals.id, id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "proposal.reopen",
      entityType: "proposal",
      entityId: id,
      data: { from: p.status },
    });
    await markChanged(tx, ctx.tenant.id, "proposal", id);
  });
}

/** Deletes a draft that was never sent. */
export async function deleteProposal(database: Database, ctx: TenantContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const p = await loadProposal(tx, ctx.tenant.id, id);
    if (p.status !== "draft") throw new UserError(t("proposals.onlyDraftDelete"));
    await tx.delete(proposals).where(eq(proposals.id, id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "proposal.delete",
      entityType: "proposal",
      entityId: id,
      data: { number: p.number, title: p.title },
    });
    await markChanged(tx, ctx.tenant.id, "proposal", id, "delete");
  });
}

/** The live (not void) invoices made from a proposal (a deposit, then the rest), oldest first. */
export async function invoicesForProposal(database: DbOrTx, tenantId: string, proposalId: string) {
  return database
    .select({
      id: invoices.id,
      number: invoices.number,
      items: invoices.items,
      totalMinor: invoices.totalMinor,
    })
    .from(invoices)
    .where(
      and(eq(invoices.tenantId, tenantId), eq(invoices.proposalId, proposalId), ne(invoices.status, "void")),
    )
    .orderBy(asc(invoices.createdAt));
}

/** The first live invoice made from a proposal, if any. */
export async function invoiceForProposal(
  database: DbOrTx,
  tenantId: string,
  proposalId: string,
): Promise<{ id: string; number: string } | null> {
  const [row] = await invoicesForProposal(database, tenantId, proposalId);
  return row ? { id: row.id, number: row.number } : null;
}

/** The value of line items before tax as they're entered (what "the rest" is measured in). */
const linesValue = (items: readonly LineItem[]) => items.reduce((sum, item) => sum + lineAmount(item), 0n);

/**
 * The client accepts or declines in the portal. Their name and IP are kept as evidence.
 * Accepting a proposal with terms needs `acceptTerms`; declining may give a reason.
 */
export type ProposalResponse = {
  accept: boolean;
  name: string;
  ip: string;
  today: string;
  acceptTerms?: boolean;
  reason?: string;
};

/** Who answers a proposal: a portal user (for their client only), or a share-link visitor. */
export type Responder = {
  tenant: TenantContext["tenant"];
  /** Null for a share-link visitor (no login). */
  userId: string | null;
  /** The client they answer for; null = staff (any client of the business). */
  clientId: string | null;
  via: "portal" | "link";
};

export async function respondToProposal(
  database: Database,
  ctx: TenantContext,
  id: string,
  input: ProposalResponse,
) {
  await respondToProposalAs(
    database,
    {
      tenant: ctx.tenant,
      userId: ctx.user.id,
      clientId: ctx.membership.kind === "client" ? (ctx.membership.clientId ?? "") : null,
      via: "portal",
    },
    id,
    input,
  );
}

export async function respondToProposalAs(
  database: Database,
  who: Responder,
  id: string,
  input: ProposalResponse,
) {
  const ctx = who;
  await database.transaction(async (tx) => {
    const p = await loadProposal(tx, ctx.tenant.id, id);
    if (who.clientId !== null && p.clientId !== who.clientId) throw new UserError(t("proposals.missing"));
    if (p.status !== "sent") throw new UserError(t("proposals.notOpen"));
    if (isProposalExpired(p, input.today))
      throw new UserError(
        t("proposals.expiredOn", {
          date: formatDate(p.validUntil, ctx.tenant.settings.locale),
          business: ctx.tenant.settings.branding.displayName || ctx.tenant.name,
        }),
      );
    if (input.accept && p.terms.trim() && !input.acceptTerms)
      throw new UserError(t("proposals.acceptTermsRequired"));
    const reason = input.accept ? "" : (input.reason ?? "").trim().slice(0, 1000);
    await tx
      .update(proposals)
      .set({
        status: input.accept ? "accepted" : "declined",
        respondedAt: new Date(),
        respondedByName: input.name,
        respondedIp: input.ip,
        declineReason: reason,
      })
      .where(eq(proposals.id, id));
    await notify(tx, ctx.tenant.id, await usersWithPermission(tx, ctx.tenant.id, "proposals.write"), {
      title: t(input.accept ? "proposals.acceptedTitle" : "proposals.declinedTitle", { number: p.number }),
      body: [`${p.title} · ${input.name}`, reason ? t("proposals.declineReasonShown", { reason }) : ""]
        .filter(Boolean)
        .join("\n\n"),
      link: `/${ctx.tenant.slug}/proposals/${p.id}`,
      email: true,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: who.userId,
      action: input.accept ? "proposal.accept" : "proposal.decline",
      entityType: "proposal",
      entityId: id,
      data: {
        name: input.name,
        ip: input.ip,
        via: who.via,
        ...(reason ? { reason } : {}),
        acceptTerms: !!input.acceptTerms,
      },
    });
    await markChanged(tx, ctx.tenant.id, "proposal", id);
  });
}

/**
 * Gives a sent proposal a new valid-until day (today or later), so a client can
 * still accept it after it expired. The client's portal users are told.
 */
export async function extendProposal(
  database: Database,
  ctx: TenantContext,
  id: string,
  input: { validUntil: string; today: string },
) {
  if (input.validUntil < input.today) throw new UserError(t("proposals.extendPast"));
  await database.transaction(async (tx) => {
    const p = await loadProposal(tx, ctx.tenant.id, id);
    if (p.status !== "sent") throw new UserError(t("proposals.extendOnlySent"));
    await tx.update(proposals).set({ validUntil: input.validUntil }).where(eq(proposals.id, id));
    await notify(tx, ctx.tenant.id, await clientUserIds(tx, ctx.tenant.id, p.clientId, "portal.proposals"), {
      title: t("proposals.extendedTitle", {
        number: p.number,
        date: formatDate(input.validUntil, ctx.tenant.settings.locale),
      }),
      body: p.title,
      link: `/${ctx.tenant.slug}/portal/proposals/${p.id}`,
      email: true,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "proposal.extend",
      entityType: "proposal",
      entityId: id,
      data: { from: p.validUntil, to: input.validUntil },
    });
    await markChanged(tx, ctx.tenant.id, "proposal", id);
  });
}

/**
 * Draft invoice from an accepted proposal. With `depositBp` (5000 = 50%) it bills
 * that share up front as one line; without it, it bills everything still
 * unbilled: the full proposal, or its lines less what earlier invoices covered.
 */
export async function invoiceFromProposal(
  database: Database,
  ctx: TenantContext,
  id: string,
  today: string,
  options: { depositBp?: number } = {},
): Promise<string> {
  return database.transaction(async (tx) => {
    const p = await loadProposal(tx, ctx.tenant.id, id);
    if (p.status !== "accepted") throw new UserError(t("proposals.notAccepted"));
    // The proposal row is locked, so two clicks can't both create an invoice.
    const earlier = await invoicesForProposal(tx, ctx.tenant.id, p.id);
    const fullValue = linesValue(p.items);
    const billed = earlier.reduce((sum, inv) => sum + linesValue(inv.items), 0n);
    const taxRateBp = p.items[0]?.taxRateBp ?? ctx.tenant.settings.tax.rateBp;
    let items: LineItem[];
    if (options.depositBp !== undefined) {
      if (options.depositBp <= 0 || options.depositBp >= 10000)
        throw new UserError(t("proposals.depositRange"));
      if (earlier.length > 0) throw new UserError(t("proposals.alreadyInvoiced"));
      items = [
        {
          description: t("proposals.depositLine", {
            percent: String(options.depositBp / 100),
            title: p.title,
          }).slice(0, 500),
          quantity: "1",
          unitPriceMinor: allocateShare(fullValue, BigInt(options.depositBp), 10000n).toString(),
          taxRateBp,
        },
      ];
    } else if (earlier.length === 0) {
      items = p.items;
    } else {
      if (billed >= fullValue) throw new UserError(t("proposals.alreadyInvoiced"));
      items = [
        ...p.items,
        {
          description: t("proposals.lessInvoiced", {
            numbers: earlier.map((e) => e.number).join(", "),
          }).slice(0, 500),
          quantity: "1",
          unitPriceMinor: (-billed).toString(),
          taxRateBp,
        },
      ];
    }
    return insertInvoice(tx, actorOf(ctx), {
      clientId: p.clientId,
      issueDate: today,
      dueDate: addDays(today, ctx.tenant.settings.paymentTermsDays),
      items,
      notes: p.title,
      custom: {},
      currency: p.currency,
      proposalId: p.id,
    });
  });
}

/** What's still to bill on an accepted proposal (line value before tax) and its invoices. */
export async function proposalBilling(
  database: DbOrTx,
  tenantId: string,
  p: { id: string; items: LineItem[] },
) {
  const earlier = await invoicesForProposal(database, tenantId, p.id);
  const billed = earlier.reduce((sum, inv) => sum + linesValue(inv.items), 0n);
  const remaining = linesValue(p.items) - billed;
  return { invoices: earlier, remainingMinor: remaining > 0n ? remaining : 0n };
}

/** Starts the project for an accepted proposal: its title, client and value as the budget. */
export async function projectFromProposal(database: Database, ctx: TenantContext, id: string, today: string) {
  return database.transaction(async (tx) => {
    const p = await loadProposal(tx, ctx.tenant.id, id);
    if (p.status !== "accepted") throw new UserError(t("proposals.notAccepted"));
    const [existing] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.tenantId, ctx.tenant.id), eq(projects.proposalId, p.id)))
      .limit(1);
    if (existing) return existing.id;
    const status = ctx.tenant.settings.projectStatuses.find((s) => !s.done)?.key;
    if (!status) throw new UserError(t("form.invalid"));
    return createProjectTx(tx, ctx, {
      name: p.title.slice(0, 120),
      description: p.intro,
      clientId: p.clientId,
      status,
      startDate: today,
      dueDate: null,
      budgetMinor: p.subtotalMinor,
      custom: {},
      templateId: null,
      proposalId: p.id,
    });
  });
}

/** The project started from a proposal, if any. */
export async function projectForProposal(database: DbOrTx, tenantId: string, proposalId: string) {
  const [row] = await database
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.tenantId, tenantId), eq(projects.proposalId, proposalId)))
    .limit(1);
  return row ?? null;
}

export type ProposalStatus = (typeof proposals.$inferSelect)["status"];

export type ProposalFilter = {
  clientId?: string;
  /** "expired": still sent but past valid-until (needs `today`). */
  status?: ProposalStatus | "expired";
  /** Needed for status "expired". */
  today?: string;
  /** Words to find in the title, number or client name. */
  q?: string;
  /** Client portal: no drafts. */
  portal?: boolean;
};

function proposalWhere(tenantId: string, filter: ProposalFilter): SQL | undefined {
  return and(
    eq(proposals.tenantId, tenantId),
    filter.clientId ? eq(proposals.clientId, filter.clientId) : undefined,
    filter.status === "expired"
      ? and(
          eq(proposals.status, "sent"),
          isNotNull(proposals.validUntil),
          lt(proposals.validUntil, filter.today ?? "9999-12-31"),
        )
      : filter.status
        ? eq(proposals.status, filter.status)
        : undefined,
    filter.portal ? notInArray(proposals.status, ["draft"]) : undefined,
    matchesSearch(filter.q, [proposals.title, proposals.number, clients.name]),
  );
}

async function proposalRows(database: DbOrTx, where: SQL | undefined, limit: number, offset = 0) {
  return database
    .select({ proposal: proposals, clientName: clients.name })
    .from(proposals)
    .innerJoin(clients, eq(clients.id, proposals.clientId))
    .where(where)
    .orderBy(desc(proposals.createdAt), desc(proposals.id))
    .limit(limit)
    .offset(offset);
}

/** Up to `limit` proposals, newest first (portal home). Lists use pageProposals. */
export async function listProposals(
  database: DbOrTx,
  tenantId: string,
  filter: ProposalFilter & { limit?: number } = {},
) {
  return proposalRows(database, proposalWhere(tenantId, filter), Math.min(filter.limit ?? 500, 2000));
}

/** One page of proposals and the number that match. */
export async function pageProposals(
  database: DbOrTx,
  tenantId: string,
  filter: ProposalFilter,
  page: PageRequest,
) {
  const where = proposalWhere(tenantId, filter);
  return paginate(
    page,
    async () => {
      const [row] = await database
        .select({ n: count() })
        .from(proposals)
        .innerJoin(clients, eq(clients.id, proposals.clientId))
        .where(where);
      return row?.n ?? 0;
    },
    (limit, offset) => proposalRows(database, where, limit, offset),
  );
}

export async function getProposal(database: DbOrTx, tenantId: string, id: string) {
  const [row] = await database
    .select({ proposal: proposals, client: clients })
    .from(proposals)
    .innerJoin(clients, eq(clients.id, proposals.clientId))
    .where(and(eq(proposals.id, id), eq(proposals.tenantId, tenantId)));
  return row ?? null;
}
