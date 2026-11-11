import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lte, notInArray, or, sql } from "drizzle-orm";
import { t } from "@/i18n";
import type { CustomValues } from "@/lib/custom-fields";
import { addDays, addMonths } from "@/lib/dates";
import { computeTotals, formatDocNumber, type LineItem } from "@/lib/line-items";
import { formatMoney } from "@/lib/money";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import {
  accounts,
  categories,
  clients,
  invoicePayments,
  invoices,
  recurringInvoices,
  timeEntries,
} from "@/server/db/schema";
import { clientUserIds, nextCounter, notify, queueMail } from "@/server/shared";
import type { TenantContext } from "@/server/tenancy/context";
import { insertTransaction, type Writer } from "@/features/finance";

/** Who is acting: a member (ctx) or the system (scheduled jobs). */
export type Actor = { tenant: TenantContext["tenant"]; userId: string | null };
export const actorOf = (ctx: TenantContext): Actor => ({ tenant: ctx.tenant, userId: ctx.user.id });

export type InvoiceStatus = (typeof invoices.$inferSelect)["status"];

/** "overdue" is derived: sent or part-paid and past the due date. */
export function displayStatus(
  inv: { status: InvoiceStatus; dueDate: string },
  today: string,
): InvoiceStatus | "overdue" {
  return (inv.status === "sent" || inv.status === "partially_paid") && inv.dueDate < today
    ? "overdue"
    : inv.status;
}

export type InvoiceInput = {
  clientId: string;
  issueDate: string;
  dueDate: string;
  items: LineItem[];
  notes: string;
  custom: CustomValues;
  currency?: string;
};

async function assertClient(tx: DbOrTx, tenantId: string, clientId: string) {
  const [c] = await tx
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)));
  if (!c) throw new UserError(t("clients.missing"));
  return c;
}

export async function insertInvoice(
  tx: DbOrTx,
  actor: Actor,
  input: InvoiceInput & { recurringId?: string | null; proposalId?: string | null },
): Promise<string> {
  if (input.items.length === 0) throw new UserError(t("invoices.noItems"));
  if (input.dueDate < input.issueDate) throw new UserError(t("invoices.dueBeforeIssue"));
  await assertClient(tx, actor.tenant.id, input.clientId);
  const s = actor.tenant.settings;
  const totals = computeTotals(input.items, s.tax.pricesIncludeTax);
  const number = formatDocNumber(s.invoicePrefix, await nextCounter(tx, actor.tenant.id, "invoice"));
  const [row] = await tx
    .insert(invoices)
    .values({
      tenantId: actor.tenant.id,
      clientId: input.clientId,
      number,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      currency: input.currency ?? s.currency,
      items: input.items,
      subtotalMinor: totals.subtotalMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      notes: input.notes,
      custom: input.custom,
      recurringId: input.recurringId ?? null,
      proposalId: input.proposalId ?? null,
      createdBy: actor.userId,
    })
    .returning({ id: invoices.id });
  if (!row) throw new Error("Invoice insert failed");
  await audit(tx, {
    tenantId: actor.tenant.id,
    actorUserId: actor.userId,
    action: "invoice.create",
    entityType: "invoice",
    entityId: row.id,
    data: { number, total: totals.totalMinor },
  });
  await markChanged(tx, actor.tenant.id, "invoice", row.id);
  return row.id;
}

export async function createInvoice(
  database: Database,
  ctx: TenantContext,
  input: InvoiceInput,
): Promise<string> {
  return database.transaction((tx) => insertInvoice(tx, actorOf(ctx), input));
}

async function loadInvoice(tx: DbOrTx, tenantId: string, id: string) {
  const [inv] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)))
    // Every caller changes the invoice: lock the row so concurrent payments, sends and
    // voids run one after another instead of overwriting each other's totals.
    .for("update");
  if (!inv) throw new UserError(t("invoices.missing"));
  return inv;
}

export async function updateInvoice(
  database: Database,
  ctx: TenantContext,
  id: string,
  input: InvoiceInput,
): Promise<void> {
  await database.transaction(async (tx) => {
    const inv = await loadInvoice(tx, ctx.tenant.id, id);
    if (inv.status !== "draft") throw new UserError(t("invoices.onlyDraft"));
    if (input.items.length === 0) throw new UserError(t("invoices.noItems"));
    await assertClient(tx, ctx.tenant.id, input.clientId);
    const totals = computeTotals(input.items, ctx.tenant.settings.tax.pricesIncludeTax);
    await tx
      .update(invoices)
      .set({
        clientId: input.clientId,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        items: input.items,
        notes: input.notes,
        custom: input.custom,
        subtotalMinor: totals.subtotalMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
      })
      .where(eq(invoices.id, id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "invoice.update",
      entityType: "invoice",
      entityId: id,
      data: { total: totals.totalMinor },
    });
    await markChanged(tx, ctx.tenant.id, "invoice", id);
  });
}

/** How the client heard about a sent document. */
export type Delivery = "portal" | "email" | "none";

export async function sendInvoiceTx(tx: DbOrTx, actor: Actor, id: string): Promise<Delivery> {
  const inv = await loadInvoice(tx, actor.tenant.id, id);
  if (inv.status !== "draft") throw new UserError(t("invoices.onlyDraft"));
  await tx.update(invoices).set({ status: "sent" }).where(eq(invoices.id, id));
  const total = formatMoney(inv.totalMinor, inv.currency, actor.tenant.settings.locale);
  const business = actor.tenant.settings.branding.displayName || actor.tenant.name;
  const title = t("invoices.notifyTitle", { number: inv.number, name: business });
  const portalUsers = await clientUserIds(tx, actor.tenant.id, inv.clientId);
  let delivery: Delivery = "none";
  if (portalUsers.length > 0) {
    await notify(tx, actor.tenant.id, portalUsers, {
      title,
      body: t("invoices.notifyBody", { total, due: inv.dueDate }),
      link: `/${actor.tenant.slug}/portal/invoices/${inv.id}/`,
      email: true,
    });
    delivery = "portal";
  } else {
    // No portal login: email the client's contact address with the details instead.
    const [client] = await tx
      .select({ name: clients.name, email: clients.email })
      .from(clients)
      .where(eq(clients.id, inv.clientId));
    if (client?.email) {
      const footer = actor.tenant.settings.invoiceFooter.trim();
      await queueMail(tx, {
        to: client.email,
        subject: title,
        text: [
          t("invoices.emailGreeting", { name: client.name }),
          t("invoices.emailBody", { number: inv.number, total, due: inv.dueDate, business }),
          footer,
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
      delivery = "email";
    }
  }
  await audit(tx, {
    tenantId: actor.tenant.id,
    actorUserId: actor.userId,
    action: "invoice.send",
    entityType: "invoice",
    entityId: id,
    data: { delivery },
  });
  await markChanged(tx, actor.tenant.id, "invoice", id);
  return delivery;
}

export async function sendInvoice(database: Database, ctx: TenantContext, id: string): Promise<Delivery> {
  return database.transaction((tx) => sendInvoiceTx(tx, actorOf(ctx), id));
}

export async function voidInvoice(database: Database, ctx: TenantContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const inv = await loadInvoice(tx, ctx.tenant.id, id);
    if (inv.paidMinor > 0n) throw new UserError(t("invoices.hasPayments"));
    await tx.update(invoices).set({ status: "void" }).where(eq(invoices.id, id));
    // Time billed on this invoice can be billed again.
    await tx
      .update(timeEntries)
      .set({ invoiceId: null })
      .where(and(eq(timeEntries.tenantId, ctx.tenant.id), eq(timeEntries.invoiceId, id)));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "invoice.void",
      entityType: "invoice",
      entityId: id,
    });
    await markChanged(tx, ctx.tenant.id, "invoice", id);
  });
}

/** Records a payment: income in the ledger, payment row, paid amount and status. */
export type PaymentInput = {
  amountMinor: bigint;
  date: string;
  accountId: string;
  method: string;
  categoryId: string | null;
  /** Provider reference (Stripe Checkout Session id); a repeat is ignored. */
  externalRef?: string;
};

export async function recordPayment(
  database: Database,
  ctx: Writer,
  id: string,
  input: PaymentInput,
): Promise<void> {
  await database.transaction(async (tx) => {
    const inv = await loadInvoice(tx, ctx.tenant.id, id);
    if (input.externalRef) {
      const [seen] = await tx
        .select({ id: invoicePayments.id })
        .from(invoicePayments)
        .where(
          and(
            eq(invoicePayments.tenantId, ctx.tenant.id),
            eq(invoicePayments.externalRef, input.externalRef),
          ),
        );
      if (seen) return;
    }
    if (inv.status === "draft" || inv.status === "void" || inv.status === "paid")
      throw new UserError(t("invoices.notPayable"));
    const balance = inv.totalMinor - inv.paidMinor;
    if (input.amountMinor <= 0n || input.amountMinor > balance) {
      throw new UserError(
        t("invoices.overpay", { balance: formatMoney(balance, inv.currency, ctx.tenant.settings.locale) }),
      );
    }
    const [account] = await tx
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), eq(accounts.tenantId, ctx.tenant.id)));
    if (account && account.currency !== inv.currency) {
      throw new UserError(t("invoices.accountCurrency", { currency: inv.currency }));
    }
    let categoryId = input.categoryId;
    if (!categoryId) {
      const [cat] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.tenantId, ctx.tenant.id),
            eq(categories.kind, "income"),
            eq(categories.archived, false),
          ),
        )
        .orderBy(asc(categories.createdAt))
        .limit(1);
      categoryId = cat?.id ?? null;
    }
    const transactionId = await insertTransaction(tx, ctx, {
      kind: "income",
      accountId: input.accountId,
      categoryId,
      date: input.date,
      description: `${t("invoices.payment")} ${inv.number}`,
      amountMinor: input.amountMinor,
      clientId: inv.clientId,
      invoiceId: inv.id,
    });
    await tx.insert(invoicePayments).values({
      tenantId: ctx.tenant.id,
      invoiceId: inv.id,
      transactionId,
      amountMinor: input.amountMinor,
      date: input.date,
      method: input.method,
      externalRef: input.externalRef ?? null,
    });
    const paid = inv.paidMinor + input.amountMinor;
    await tx
      .update(invoices)
      .set({ paidMinor: paid, status: paid >= inv.totalMinor ? "paid" : "partially_paid" })
      .where(eq(invoices.id, inv.id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user?.id ?? null,
      action: "invoice.payment",
      entityType: "invoice",
      entityId: inv.id,
      data: { amount: input.amountMinor, transactionId },
    });
    await markChanged(tx, ctx.tenant.id, "invoice", inv.id);
  });
}

export async function listInvoices(
  database: DbOrTx,
  tenantId: string,
  filter: {
    status?: InvoiceStatus | "overdue";
    clientId?: string;
    q?: string;
    today?: string;
    portal?: boolean;
    /** Rows to return (pages ask for one more to know if there is a next page). */
    limit?: number;
  } = {},
) {
  const overdue = filter.status === "overdue" && filter.today;
  return database
    .select({ invoice: invoices, clientName: clients.name })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        filter.clientId ? eq(invoices.clientId, filter.clientId) : undefined,
        filter.portal ? notInArray(invoices.status, ["draft"]) : undefined,
        overdue
          ? and(
              inArray(invoices.status, ["sent", "partially_paid"]),
              sql`${invoices.dueDate} < ${filter.today}`,
            )
          : filter.status && filter.status !== "overdue"
            ? eq(invoices.status, filter.status)
            : undefined,
        filter.q
          ? or(
              ilike(invoices.number, `%${filter.q.replace(/[%_]/g, "")}%`),
              ilike(clients.name, `%${filter.q.replace(/[%_]/g, "")}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(invoices.issueDate), desc(invoices.number))
    .limit(Math.min(filter.limit ?? 500, 2000));
}

export async function getInvoice(database: DbOrTx, tenantId: string, id: string) {
  const [row] = await database
    .select({ invoice: invoices, client: clients })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
  if (!row) return null;
  const payments = await database
    .select()
    .from(invoicePayments)
    .where(and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.invoiceId, id)))
    .orderBy(asc(invoicePayments.date));
  return { ...row, payments };
}

/** Money owed by clients now, and the overdue part. */
export async function receivables(database: DbOrTx, tenantId: string, today: string) {
  const [row] = await database
    .select({
      total: sql<string>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor}), 0)`,
      overdue: sql<string>`coalesce(sum(case when ${invoices.dueDate} < ${today} then ${invoices.totalMinor} - ${invoices.paidMinor} else 0 end), 0)`,
    })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.status, ["sent", "partially_paid"])));
  return { totalMinor: BigInt(row?.total ?? "0"), overdueMinor: BigInt(row?.overdue ?? "0") };
}

/** Tax on invoices issued in a range (for BAS preparation; accrual view). */
export async function gstSummary(database: DbOrTx, tenantId: string, from: string, to: string) {
  const [row] = await database
    .select({
      tax: sql<string>`coalesce(sum(${invoices.taxMinor}), 0)`,
      total: sql<string>`coalesce(sum(${invoices.totalMinor}), 0)`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        gte(invoices.issueDate, from),
        lte(invoices.issueDate, to),
        notInArray(invoices.status, ["draft", "void"]),
      ),
    );
  return { taxMinor: BigInt(row?.tax ?? "0"), salesMinor: BigInt(row?.total ?? "0") };
}

/* ─── Recurring ────────────────────────────────────────────────── */

export async function listRecurring(database: DbOrTx, tenantId: string) {
  return database
    .select({ r: recurringInvoices, clientName: clients.name })
    .from(recurringInvoices)
    .innerJoin(clients, eq(clients.id, recurringInvoices.clientId))
    .where(eq(recurringInvoices.tenantId, tenantId))
    .orderBy(asc(recurringInvoices.nextRunDate));
}

export async function createRecurring(
  database: Database,
  ctx: TenantContext,
  input: {
    clientId: string;
    name: string;
    intervalMonths: number;
    nextRunDate: string;
    items: LineItem[];
    autoSend: boolean;
  },
): Promise<void> {
  if (input.items.length === 0) throw new UserError(t("invoices.noItems"));
  await database.transaction(async (tx) => {
    await assertClient(tx, ctx.tenant.id, input.clientId);
    const [row] = await tx
      .insert(recurringInvoices)
      .values({ tenantId: ctx.tenant.id, currency: ctx.tenant.settings.currency, ...input })
      .returning({ id: recurringInvoices.id });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "recurring.create",
      entityType: "recurring",
      entityId: row?.id,
      data: { name: input.name },
    });
  });
}

export async function setRecurringActive(
  database: Database,
  ctx: TenantContext,
  id: string,
  active: boolean,
) {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .update(recurringInvoices)
      .set({ active })
      .where(and(eq(recurringInvoices.id, id), eq(recurringInvoices.tenantId, ctx.tenant.id)))
      .returning({ id: recurringInvoices.id });
    if (!row) throw new UserError(t("invoices.recurringMissing"));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: active ? "recurring.resume" : "recurring.pause",
      entityType: "recurring",
      entityId: id,
      data: { active },
    });
    await markChanged(tx, ctx.tenant.id, "recurring", id);
  });
}

export async function updateRecurring(
  database: Database,
  ctx: TenantContext,
  id: string,
  input: {
    clientId: string;
    name: string;
    intervalMonths: number;
    nextRunDate: string;
    items: LineItem[];
    autoSend: boolean;
  },
): Promise<void> {
  if (input.items.length === 0) throw new UserError(t("invoices.noItems"));
  await database.transaction(async (tx) => {
    await assertClient(tx, ctx.tenant.id, input.clientId);
    const [row] = await tx
      .update(recurringInvoices)
      .set(input)
      .where(and(eq(recurringInvoices.id, id), eq(recurringInvoices.tenantId, ctx.tenant.id)))
      .returning({ id: recurringInvoices.id });
    if (!row) throw new UserError(t("invoices.recurringMissing"));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "recurring.update",
      entityType: "recurring",
      entityId: id,
      data: { name: input.name },
    });
    await markChanged(tx, ctx.tenant.id, "recurring", id);
  });
}

/** Deletes a schedule. Invoices it already created stay. */
export async function deleteRecurring(database: Database, ctx: TenantContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .delete(recurringInvoices)
      .where(and(eq(recurringInvoices.id, id), eq(recurringInvoices.tenantId, ctx.tenant.id)))
      .returning({ id: recurringInvoices.id, name: recurringInvoices.name });
    if (!row) throw new UserError(t("invoices.recurringMissing"));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "recurring.delete",
      entityType: "recurring",
      entityId: id,
      data: { name: row.name },
    });
    await markChanged(tx, ctx.tenant.id, "recurring", id, "delete");
  });
}

/** Monthly recurring revenue from active schedules (base currency only). */
export async function monthlyRecurring(database: DbOrTx, ctx: TenantContext): Promise<bigint> {
  const rows = await database
    .select()
    .from(recurringInvoices)
    .where(
      and(
        eq(recurringInvoices.tenantId, ctx.tenant.id),
        eq(recurringInvoices.active, true),
        eq(recurringInvoices.currency, ctx.tenant.settings.currency),
      ),
    );
  return rows.reduce((acc, r) => {
    const total = computeTotals(r.items, ctx.tenant.settings.tax.pricesIncludeTax).totalMinor;
    return acc + total / BigInt(Math.max(1, r.intervalMonths));
  }, 0n);
}

/** Creates the invoices that are due today or earlier. Idempotent: advances nextRunDate. */
export async function runRecurring(
  database: Database,
  tenant: TenantContext["tenant"],
  today: string,
): Promise<number> {
  const due = await database
    .select()
    .from(recurringInvoices)
    .where(
      and(
        eq(recurringInvoices.tenantId, tenant.id),
        eq(recurringInvoices.active, true),
        lte(recurringInvoices.nextRunDate, today),
      ),
    );
  let created = 0;
  for (const r of due) {
    await database.transaction(async (tx) => {
      // Re-check inside the transaction so two workers never bill twice.
      const [fresh] = await tx
        .update(recurringInvoices)
        .set({ nextRunDate: addMonths(r.nextRunDate, r.intervalMonths) })
        .where(and(eq(recurringInvoices.id, r.id), eq(recurringInvoices.nextRunDate, r.nextRunDate)))
        .returning({ id: recurringInvoices.id });
      if (!fresh) return;
      const actor: Actor = { tenant, userId: null };
      const id = await insertInvoice(tx, actor, {
        clientId: r.clientId,
        issueDate: r.nextRunDate,
        dueDate: addDays(r.nextRunDate, tenant.settings.paymentTermsDays),
        items: r.items,
        notes: "",
        custom: {},
        currency: r.currency,
        recurringId: r.id,
      });
      if (r.autoSend) await sendInvoiceTx(tx, actor, id);
      created++;
    });
  }
  return created;
}
