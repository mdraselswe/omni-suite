import "server-only";
import { and, desc, eq, ne, notInArray } from "drizzle-orm";
import { t } from "@/i18n";
import { addDays } from "@/lib/dates";
import { computeTotals, formatDocNumber, type LineItem } from "@/lib/line-items";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { clients, invoices, proposals } from "@/server/db/schema";
import { clientUserIds, nextCounter, notify, queueMail, usersWithPermission } from "@/server/shared";
import type { TenantContext } from "@/server/tenancy/context";
import { actorOf, insertInvoice, type Delivery } from "@/features/invoices";

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
    const portalUsers = await clientUserIds(tx, ctx.tenant.id, p.clientId);
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
        .select({ name: clients.name, email: clients.email })
        .from(clients)
        .where(eq(clients.id, p.clientId));
      if (client?.email) {
        await queueMail(tx, {
          to: client.email,
          subject: title,
          text: [
            t("invoices.emailGreeting", { name: client.name }),
            t("proposals.emailBody", { business, title: p.title, number: p.number }),
          ].join("\n\n"),
        });
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
      .set({ status: "draft", respondedAt: null, respondedByName: null, respondedIp: null })
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

/** The live (not void) invoice made from a proposal, if any. */
export async function invoiceForProposal(
  database: DbOrTx,
  tenantId: string,
  proposalId: string,
): Promise<{ id: string; number: string } | null> {
  const [row] = await database
    .select({ id: invoices.id, number: invoices.number })
    .from(invoices)
    .where(
      and(eq(invoices.tenantId, tenantId), eq(invoices.proposalId, proposalId), ne(invoices.status, "void")),
    )
    .limit(1);
  return row ?? null;
}

/** The client accepts or declines in the portal. Their name and IP are kept as evidence. */
export async function respondToProposal(
  database: Database,
  ctx: TenantContext,
  id: string,
  input: { accept: boolean; name: string; ip: string; today: string },
) {
  await database.transaction(async (tx) => {
    const p = await loadProposal(tx, ctx.tenant.id, id);
    if (ctx.membership.kind === "client" && p.clientId !== ctx.membership.clientId)
      throw new UserError(t("proposals.missing"));
    if (p.status !== "sent") throw new UserError(t("proposals.notOpen"));
    if (p.validUntil && p.validUntil < input.today) throw new UserError(t("proposals.expired"));
    await tx
      .update(proposals)
      .set({
        status: input.accept ? "accepted" : "declined",
        respondedAt: new Date(),
        respondedByName: input.name,
        respondedIp: input.ip,
      })
      .where(eq(proposals.id, id));
    await notify(tx, ctx.tenant.id, await usersWithPermission(tx, ctx.tenant.id, "proposals.write"), {
      title: t(input.accept ? "proposals.acceptedTitle" : "proposals.declinedTitle", { number: p.number }),
      body: `${p.title} · ${input.name}`,
      link: `/${ctx.tenant.slug}/proposals/${p.id}`,
      email: true,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: input.accept ? "proposal.accept" : "proposal.decline",
      entityType: "proposal",
      entityId: id,
      data: { name: input.name, ip: input.ip },
    });
    await markChanged(tx, ctx.tenant.id, "proposal", id);
  });
}

/** Draft invoice from an accepted proposal. */
export async function invoiceFromProposal(
  database: Database,
  ctx: TenantContext,
  id: string,
  today: string,
): Promise<string> {
  return database.transaction(async (tx) => {
    const p = await loadProposal(tx, ctx.tenant.id, id);
    if (p.status !== "accepted") throw new UserError(t("proposals.notAccepted"));
    // The proposal row is locked, so two clicks can't both create an invoice.
    if (await invoiceForProposal(tx, ctx.tenant.id, p.id))
      throw new UserError(t("proposals.alreadyInvoiced"));
    return insertInvoice(tx, actorOf(ctx), {
      clientId: p.clientId,
      issueDate: today,
      dueDate: addDays(today, ctx.tenant.settings.paymentTermsDays),
      items: p.items,
      notes: p.title,
      custom: {},
      currency: p.currency,
      proposalId: p.id,
    });
  });
}

export async function listProposals(
  database: DbOrTx,
  tenantId: string,
  filter: { clientId?: string; portal?: boolean; limit?: number } = {},
) {
  return database
    .select({ proposal: proposals, clientName: clients.name })
    .from(proposals)
    .innerJoin(clients, eq(clients.id, proposals.clientId))
    .where(
      and(
        eq(proposals.tenantId, tenantId),
        filter.clientId ? eq(proposals.clientId, filter.clientId) : undefined,
        filter.portal ? notInArray(proposals.status, ["draft"]) : undefined,
      ),
    )
    .orderBy(desc(proposals.createdAt))
    .limit(Math.min(filter.limit ?? 500, 2000));
}

export async function getProposal(database: DbOrTx, tenantId: string, id: string) {
  const [row] = await database
    .select({ proposal: proposals, client: clients })
    .from(proposals)
    .innerJoin(clients, eq(clients.id, proposals.clientId))
    .where(and(eq(proposals.id, id), eq(proposals.tenantId, tenantId)));
  return row ?? null;
}
