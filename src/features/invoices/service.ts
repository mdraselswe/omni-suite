import "server-only";
import { and, asc, count, desc, eq, gte, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { t } from "@/i18n";
import type { CustomValues } from "@/lib/custom-fields";
import { addDays, addMonthsAnchored, formatDate, today as todayIn } from "@/lib/dates";
import { computeTotals, formatDocNumber, type LineItem } from "@/lib/line-items";
import { allocateShare, formatMoney } from "@/lib/money";
import { paginate, type PageRequest } from "@/lib/pagination";
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
  transactions,
} from "@/server/db/schema";
import { matchesSearch } from "@/server/search";
import { clientUserIds, nextCounter, notify, queueMail } from "@/server/shared";
import type { TenantContext } from "@/server/tenancy/context";
import { assertOpenDate, insertTransaction, isClosedDate, type Writer } from "@/features/finance";

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

/** What the client still owes: nothing on drafts and void invoices, never below zero. */
export function invoiceBalance(inv: {
  status: InvoiceStatus;
  totalMinor: bigint;
  paidMinor: bigint;
  writtenOffMinor: bigint;
}): bigint {
  if (inv.status === "draft" || inv.status === "void") return 0n;
  const owed = inv.totalMinor - inv.paidMinor - inv.writtenOffMinor;
  return owed > 0n ? owed : 0n;
}

/** Status after the paid or written-off amount changed (draft and void stay). */
export function settledStatus(inv: {
  status: InvoiceStatus;
  totalMinor: bigint;
  paidMinor: bigint;
  writtenOffMinor: bigint;
}): InvoiceStatus {
  if (inv.status === "draft" || inv.status === "void") return inv.status;
  if (inv.paidMinor + inv.writtenOffMinor >= inv.totalMinor) return "paid";
  return inv.paidMinor > 0n ? "partially_paid" : "sent";
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
  await assertOpenDate(tx, actor.tenant.id, input.issueDate);
  const s = actor.tenant.settings;
  const totals = computeTotals(input.items, s.tax.pricesIncludeTax);
  // Credits are refunds, not invoices: a zero or negative total can't be paid or tracked.
  if (totals.totalMinor <= 0n) throw new UserError(t("invoices.totalPositive"));
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
      pricesIncludeTax: s.tax.pricesIncludeTax,
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
    if (input.dueDate < input.issueDate) throw new UserError(t("invoices.dueBeforeIssue"));
    await assertClient(tx, ctx.tenant.id, input.clientId);
    await assertOpenDate(tx, ctx.tenant.id, input.issueDate);
    const totals = computeTotals(input.items, ctx.tenant.settings.tax.pricesIncludeTax);
    if (totals.totalMinor <= 0n) throw new UserError(t("invoices.totalPositive"));
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
        pricesIncludeTax: ctx.tenant.settings.tax.pricesIncludeTax,
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

/** Why the client is hearing about an invoice. */
export type DeliveryKind = "new" | "reminder";

/**
 * Tells the client about an invoice: in the portal (with an email) for portal users
 * who can see invoices, otherwise by email to the billing address. Reminders say
 * what is still owed and whether it is late.
 */
export async function deliverInvoiceTx(
  tx: DbOrTx,
  actor: Actor,
  inv: typeof invoices.$inferSelect,
  kind: DeliveryKind,
): Promise<Delivery> {
  const settings = actor.tenant.settings;
  const money = (minor: bigint) => formatMoney(minor, inv.currency, settings.locale);
  const due = formatDate(inv.dueDate, settings.locale);
  const business = settings.branding.displayName || actor.tenant.name;
  const late = inv.dueDate < todayIn(settings.timezone);
  const vars = { number: inv.number, name: business, business, total: money(inv.totalMinor), due };
  const balance = money(invoiceBalance(inv));
  const title =
    kind === "new"
      ? t("invoices.notifyTitle", vars)
      : t(late ? "invoices.reminderLateTitle" : "invoices.reminderTitle", vars);
  const body =
    kind === "new"
      ? t("invoices.notifyBody", vars)
      : t(late ? "invoices.reminderLateBody" : "invoices.reminderBody", { ...vars, balance });
  const portalUsers = await clientUserIds(tx, actor.tenant.id, inv.clientId, "portal.invoices");
  if (portalUsers.length > 0) {
    await notify(tx, actor.tenant.id, portalUsers, {
      title,
      body,
      link: `/${actor.tenant.slug}/portal/invoices/${inv.id}/`,
      email: true,
    });
    return "portal";
  }
  // No portal login: email the billing address (or the main one) with the details.
  const [client] = await tx
    .select({
      email: sql<string>`coalesce(nullif(trim(${clients.billingEmail}), ''), trim(${clients.email}))`,
      greet: sql<string>`coalesce(nullif(trim(${clients.contactName}), ''), ${clients.name})`,
    })
    .from(clients)
    .where(eq(clients.id, inv.clientId));
  if (!client?.email) return "none";
  const text = [
    t("invoices.emailGreeting", { name: client.greet }),
    kind === "new" ? t("invoices.emailBody", vars) : body,
    settings.invoiceFooter.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
  await queueMail(tx, { to: client.email, subject: title, text }, { tenantId: actor.tenant.id });
  return "email";
}

export async function sendInvoiceTx(tx: DbOrTx, actor: Actor, id: string): Promise<Delivery> {
  const inv = await loadInvoice(tx, actor.tenant.id, id);
  if (inv.status !== "draft") throw new UserError(t("invoices.onlyDraft"));
  const today = todayIn(actor.tenant.settings.timezone);
  // The invoice email is today's message: reminders start from tomorrow.
  const plan = reminderPlan(inv.dueDate, addDays(today, 1), actor.tenant.settings.reminders);
  await tx
    .update(invoices)
    .set({ status: "sent", reminderCount: plan.count, nextReminderOn: plan.next })
    .where(eq(invoices.id, id));
  const delivery = await deliverInvoiceTx(tx, actor, { ...inv, status: "sent" }, "new");
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

/** Sends an unpaid invoice to the client again (as a reminder of what is owed). */
export async function resendInvoice(database: Database, ctx: TenantContext, id: string): Promise<Delivery> {
  return database.transaction(async (tx) => {
    const inv = await loadInvoice(tx, ctx.tenant.id, id);
    if ((inv.status !== "sent" && inv.status !== "partially_paid") || invoiceBalance(inv) <= 0n)
      throw new UserError(t("invoices.notPayable"));
    const delivery = await deliverInvoiceTx(tx, actorOf(ctx), inv, "reminder");
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "invoice.resend",
      entityType: "invoice",
      entityId: id,
      data: { delivery },
    });
    return delivery;
  });
}

type ReminderSettings = TenantContext["tenant"]["settings"]["reminders"];

/** Reminder days relative to the due date, in order: -3 (before), then 1, 7, 14 after. */
export function reminderSteps(settings: ReminderSettings): number[] {
  if (!settings.enabled) return [];
  const after = [...new Set(settings.daysAfter)].filter((d) => d > 0).sort((a, b) => a - b);
  return [...(settings.daysBefore > 0 ? [-settings.daysBefore] : []), ...after];
}

/**
 * How many reminder days are already behind `today` (skipped, never sent in a
 * burst) and the day the next one is due, or null when none is left.
 */
export function reminderPlan(
  dueDate: string,
  today: string,
  settings: ReminderSettings,
): { count: number; next: string | null } {
  const days = reminderSteps(settings).map((step) => addDays(dueDate, step));
  const count = days.filter((d) => d < today).length;
  return { count, next: days[count] ?? null };
}

/**
 * Sends the payment reminders due by `today` for one business and plans the next
 * ones. Idempotent: an invoice gets at most one reminder per run day, only while unpaid.
 */
export async function runReminders(
  database: Database,
  tenant: TenantContext["tenant"],
  today: string,
): Promise<number> {
  const due = await database
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenant.id),
        inArray(invoices.status, ["sent", "partially_paid"]),
        lte(invoices.nextReminderOn, today),
      ),
    );
  let sent = 0;
  for (const { id } of due) {
    sent += await database.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenant.id)))
        .for("update");
      if (!inv?.nextReminderOn || inv.nextReminderOn > today) return 0;
      const open = (inv.status === "sent" || inv.status === "partially_paid") && invoiceBalance(inv) > 0n;
      // Everything up to today is now done; the next reminder is the first day after it.
      const plan = reminderPlan(inv.dueDate, addDays(today, 1), tenant.settings.reminders);
      await tx
        .update(invoices)
        .set({ reminderCount: plan.count, nextReminderOn: open ? plan.next : null })
        .where(eq(invoices.id, inv.id));
      if (!open || !tenant.settings.reminders.enabled) return 0;
      const delivery = await deliverInvoiceTx(tx, { tenant, userId: null }, inv, "reminder");
      await audit(tx, {
        tenantId: tenant.id,
        actorUserId: null,
        action: "invoice.remind",
        entityType: "invoice",
        entityId: inv.id,
        data: { delivery, reminder: plan.count },
      });
      return 1;
    });
  }
  return sent;
}

/** After the reminder settings change: re-plan reminders for every unpaid invoice. */
export async function replanReminders(database: DbOrTx, tenant: TenantContext["tenant"], today: string) {
  const open = await database
    .select({ id: invoices.id, dueDate: invoices.dueDate, nextReminderOn: invoices.nextReminderOn })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenant.id), inArray(invoices.status, ["sent", "partially_paid"])));
  for (const inv of open) {
    // A reminder still waiting for today keeps today; otherwise today's (if any) already
    // went out, so the plan starts tomorrow and saving settings never repeats it.
    const pendingToday = inv.nextReminderOn !== null && inv.nextReminderOn <= today;
    const plan = reminderPlan(
      inv.dueDate,
      pendingToday ? today : addDays(today, 1),
      tenant.settings.reminders,
    );
    await database
      .update(invoices)
      .set({ reminderCount: plan.count, nextReminderOn: plan.next })
      .where(eq(invoices.id, inv.id));
  }
}

export async function sendInvoice(database: Database, ctx: TenantContext, id: string): Promise<Delivery> {
  return database.transaction((tx) => sendInvoiceTx(tx, actorOf(ctx), id));
}

export async function voidInvoice(database: Database, ctx: TenantContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const inv = await loadInvoice(tx, ctx.tenant.id, id);
    if (inv.status === "void") return;
    if (inv.paidMinor > 0n) throw new UserError(t("invoices.hasPayments"));
    // A sent invoice counts in that period's tax report; a closed period must not change.
    if (inv.status !== "draft") await assertOpenDate(tx, ctx.tenant.id, inv.issueDate);
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
  /** Base-currency units per 1 invoice-currency unit; needed when the invoice isn't in the base currency. */
  fxRate?: string;
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
    // Money not received yet can't be recorded: statements and balances would disagree.
    if (input.date > todayIn(ctx.tenant.settings.timezone))
      throw new UserError(t("invoices.paymentInFuture"));
    const balance = invoiceBalance(inv);
    if (input.amountMinor <= 0n || input.amountMinor > balance) {
      throw new UserError(
        t("invoices.overpay", { balance: formatMoney(balance, inv.currency, ctx.tenant.settings.locale) }),
      );
    }
    const [account] = await tx
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), eq(accounts.tenantId, ctx.tenant.id)));
    if (!account) throw new UserError(t("finance.accountMissing"));
    if (account.currency !== inv.currency) {
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
    const paid = inv.paidMinor + input.amountMinor;
    // The GST inside this payment: the invoice's tax pro rata, allocated on the running total so
    // the parts of several payments add up exactly to the invoice's tax.
    const taxMinor =
      allocateShare(inv.taxMinor, paid, inv.totalMinor) -
      allocateShare(inv.taxMinor, inv.paidMinor, inv.totalMinor);
    const transactionId = await insertTransaction(tx, ctx, {
      kind: "income",
      accountId: input.accountId,
      categoryId,
      date: input.date,
      description: `${t("invoices.payment")} ${inv.number}`,
      amountMinor: input.amountMinor,
      taxMinor: taxMinor > 0n ? taxMinor : 0n,
      fxRate: input.fxRate,
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
    await tx
      .update(invoices)
      .set({ paidMinor: paid, status: settledStatus({ ...inv, paidMinor: paid }) })
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

/**
 * Writes off what's left unpaid (a short payment, a bad debt). The invoice counts
 * as settled; nothing goes in the ledger because the money never arrived.
 */
export async function writeOffBalance(
  database: Database,
  ctx: TenantContext,
  id: string,
  reason: string,
): Promise<bigint> {
  return database.transaction(async (tx) => {
    const inv = await loadInvoice(tx, ctx.tenant.id, id);
    if (inv.status !== "sent" && inv.status !== "partially_paid")
      throw new UserError(t("invoices.notPayable"));
    const balance = invoiceBalance(inv);
    if (balance <= 0n) throw new UserError(t("invoices.notPayable"));
    const writtenOffMinor = inv.writtenOffMinor + balance;
    await tx
      .update(invoices)
      .set({
        writtenOffMinor,
        writtenOffDate: todayIn(ctx.tenant.settings.timezone),
        status: settledStatus({ ...inv, writtenOffMinor }),
      })
      .where(eq(invoices.id, inv.id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "invoice.writeOff",
      entityType: "invoice",
      entityId: inv.id,
      data: { amount: balance, reason },
    });
    await markChanged(tx, ctx.tenant.id, "invoice", inv.id);
    return balance;
  });
}

export type InvoiceFilter = {
  status?: InvoiceStatus | "overdue";
  clientId?: string;
  /** Words to find in the invoice number or client name. */
  q?: string;
  /** Needed for status "overdue". */
  today?: string;
  /** Client portal: no drafts. */
  portal?: boolean;
};

function invoiceWhere(tenantId: string, filter: InvoiceFilter): SQL | undefined {
  const overdue = filter.status === "overdue" && filter.today;
  return and(
    eq(invoices.tenantId, tenantId),
    filter.clientId ? eq(invoices.clientId, filter.clientId) : undefined,
    filter.portal ? notInArray(invoices.status, ["draft"]) : undefined,
    overdue
      ? and(inArray(invoices.status, ["sent", "partially_paid"]), sql`${invoices.dueDate} < ${filter.today}`)
      : filter.status && filter.status !== "overdue"
        ? eq(invoices.status, filter.status)
        : undefined,
    matchesSearch(filter.q, [invoices.number, clients.name]),
  );
}

async function invoiceRows(database: DbOrTx, where: SQL | undefined, limit: number, offset = 0) {
  return database
    .select({ invoice: invoices, clientName: clients.name })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(where)
    .orderBy(desc(invoices.issueDate), desc(invoices.number), desc(invoices.id))
    .limit(limit)
    .offset(offset);
}

/** Up to `limit` invoices, newest first (dashboards, previews). Lists use pageInvoices. */
export async function listInvoices(
  database: DbOrTx,
  tenantId: string,
  filter: InvoiceFilter & { limit?: number } = {},
) {
  return invoiceRows(database, invoiceWhere(tenantId, filter), Math.min(filter.limit ?? 500, 2000));
}

/** Number of invoices that match a filter. */
export async function countInvoices(database: DbOrTx, tenantId: string, filter: InvoiceFilter = {}) {
  const [row] = await database
    .select({ n: count() })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(invoiceWhere(tenantId, filter));
  return row?.n ?? 0;
}

/** One page of invoices and the number that match. */
export async function pageInvoices(
  database: DbOrTx,
  tenantId: string,
  filter: InvoiceFilter,
  page: PageRequest,
) {
  const where = invoiceWhere(tenantId, filter);
  return paginate(
    page,
    () => countInvoices(database, tenantId, filter),
    (limit, offset) => invoiceRows(database, where, limit, offset),
  );
}

/** The currency of one of the tenant's invoices (null if it isn't theirs). */
export async function invoiceCurrency(
  database: DbOrTx,
  tenantId: string,
  id: string,
): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await database
    .select({ currency: invoices.currency })
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
  return row?.currency ?? null;
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

/**
 * Money owed by clients now and the overdue part, in the base currency. Invoices
 * in other currencies are listed per currency in `foreign` (they can't be added
 * to base amounts without a rate).
 */
export async function receivables(database: DbOrTx, tenantId: string, today: string, baseCurrency: string) {
  const owed = sql`(${invoices.totalMinor} - ${invoices.paidMinor} - ${invoices.writtenOffMinor})`;
  const rows = await database
    .select({
      currency: invoices.currency,
      total: sql<string>`coalesce(sum(${owed}), 0)`,
      overdue: sql<string>`coalesce(sum(case when ${invoices.dueDate} < ${today} then ${owed} else 0 end), 0)`,
    })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.status, ["sent", "partially_paid"])))
    .groupBy(invoices.currency);
  const base = rows.find((r) => r.currency === baseCurrency);
  return {
    totalMinor: BigInt(base?.total ?? "0"),
    overdueMinor: BigInt(base?.overdue ?? "0"),
    foreign: rows
      .filter((r) => r.currency !== baseCurrency && BigInt(r.total) > 0n)
      .map((r) => ({ currency: r.currency, totalMinor: BigInt(r.total), overdueMinor: BigInt(r.overdue) })),
  };
}

/**
 * GST for a BAS on the cash basis (what most small businesses use): money
 * actually received and paid in the range, base currency, reversals netted.
 * - G1 total sales: income received, GST included
 * - 1A GST on sales: the GST inside that income
 * - 1B GST on purchases: GST inside expenses (claimable)
 * - accrual: GST on invoices issued in the range, for businesses that report that way
 */
export async function gstSummary(database: DbOrTx, tenantId: string, from: string, to: string) {
  const signedBase = (column: typeof transactions.baseAmountMinor) =>
    sql`case when ${transactions.reversesId} is null then ${column} else -${column} end`;
  const sumOf = (kind: "income" | "expense", column: typeof transactions.baseAmountMinor) =>
    sql<string>`coalesce(sum(case when ${transactions.kind} = ${kind} then ${signedBase(column)} else 0 end), 0)`;
  const [cash] = await database
    .select({
      sales: sumOf("income", transactions.baseAmountMinor),
      salesTax: sumOf("income", transactions.baseTaxMinor),
      purchases: sumOf("expense", transactions.baseAmountMinor),
      purchaseTax: sumOf("expense", transactions.baseTaxMinor),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        gte(transactions.date, from),
        lte(transactions.date, to),
        inArray(transactions.kind, ["income", "expense"]),
      ),
    );
  const [accrual] = await database
    .select({ tax: sql<string>`coalesce(sum(${invoices.taxMinor}), 0)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        gte(invoices.issueDate, from),
        lte(invoices.issueDate, to),
        notInArray(invoices.status, ["draft", "void"]),
      ),
    );
  const salesTaxMinor = BigInt(cash?.salesTax ?? "0");
  const purchaseTaxMinor = BigInt(cash?.purchaseTax ?? "0");
  return {
    /** G1 */
    salesMinor: BigInt(cash?.sales ?? "0"),
    /** 1A */
    salesTaxMinor,
    purchasesMinor: BigInt(cash?.purchases ?? "0"),
    /** 1B */
    purchaseTaxMinor,
    /** 1A − 1B: positive means owed to the tax office. */
    netTaxMinor: salesTaxMinor - purchaseTaxMinor,
    /** GST on invoices issued in the range (accrual view). */
    accrualTaxMinor: BigInt(accrual?.tax ?? "0"),
  };
}

/* ─── Recurring ────────────────────────────────────────────────── */

export async function listRecurring(database: DbOrTx, tenantId: string) {
  return database
    .select({ r: recurringInvoices, clientName: clients.name })
    .from(recurringInvoices)
    .innerJoin(clients, eq(clients.id, recurringInvoices.clientId))
    .where(eq(recurringInvoices.tenantId, tenantId))
    .orderBy(asc(recurringInvoices.nextRunDate), asc(recurringInvoices.id));
}

/** One page of schedules (next run first); `q` finds words in the schedule or client name. */
export async function pageRecurring(
  database: DbOrTx,
  tenantId: string,
  filter: { q?: string },
  page: PageRequest,
) {
  const where = and(
    eq(recurringInvoices.tenantId, tenantId),
    matchesSearch(filter.q, [recurringInvoices.name, clients.name]),
  );
  return paginate(
    page,
    async () => {
      const [row] = await database
        .select({ n: count() })
        .from(recurringInvoices)
        .innerJoin(clients, eq(clients.id, recurringInvoices.clientId))
        .where(where);
      return row?.n ?? 0;
    },
    (limit, offset) =>
      database
        .select({ r: recurringInvoices, clientName: clients.name })
        .from(recurringInvoices)
        .innerJoin(clients, eq(clients.id, recurringInvoices.clientId))
        .where(where)
        .orderBy(asc(recurringInvoices.nextRunDate), asc(recurringInvoices.id))
        .limit(limit)
        .offset(offset),
  );
}

/** Active schedules (the stat above the list; the list itself is paged). */
export async function activeRecurringCount(database: DbOrTx, tenantId: string) {
  const [row] = await database
    .select({ n: count() })
    .from(recurringInvoices)
    .where(and(eq(recurringInvoices.tenantId, tenantId), eq(recurringInvoices.active, true)));
  return row?.n ?? 0;
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
      .values({
        tenantId: ctx.tenant.id,
        currency: ctx.tenant.settings.currency,
        ...input,
        anchorDay: Number(input.nextRunDate.slice(8, 10)),
      })
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

/** First run on or after `today`, stepping by the schedule's interval from `next`. */
export function nextRunFrom(next: string, intervalMonths: number, anchorDay: number, today: string): string {
  let run = next;
  for (let i = 0; run < today && i < 1200; i++) {
    run = addMonthsAnchored(run, Math.max(1, intervalMonths), anchorDay);
  }
  return run;
}

export async function setRecurringActive(
  database: Database,
  ctx: TenantContext,
  id: string,
  active: boolean,
  today?: string,
) {
  await database.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(recurringInvoices)
      .where(and(eq(recurringInvoices.id, id), eq(recurringInvoices.tenantId, ctx.tenant.id)))
      .for("update");
    if (!current) throw new UserError(t("invoices.recurringMissing"));
    // Resuming bills from the next date on: the paused months aren't invoiced in a burst.
    const nextRunDate =
      active && today
        ? nextRunFrom(
            current.nextRunDate,
            current.intervalMonths,
            current.anchorDay ?? Number(current.nextRunDate.slice(8, 10)),
            today,
          )
        : current.nextRunDate;
    const [row] = await tx
      .update(recurringInvoices)
      .set({ active, nextRunDate })
      .where(eq(recurringInvoices.id, id))
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
      .set({ ...input, anchorDay: Number(input.nextRunDate.slice(8, 10)) })
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

/** Monthly recurring revenue from active schedules (base currency only, without GST). */
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
  // Add the exact monthly parts and round once, so a quarterly $100 isn't cut three times.
  const scale = 1_000_000n;
  const scaled = rows.reduce((acc, r) => {
    const net = computeTotals(r.items, ctx.tenant.settings.tax.pricesIncludeTax).subtotalMinor;
    return acc + (net * scale) / BigInt(Math.max(1, r.intervalMonths));
  }, 0n);
  return (scaled + scale / 2n) / scale;
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
      const anchor = r.anchorDay ?? Number(r.nextRunDate.slice(8, 10));
      const [fresh] = await tx
        .update(recurringInvoices)
        .set({ nextRunDate: addMonthsAnchored(r.nextRunDate, r.intervalMonths, anchor) })
        .where(and(eq(recurringInvoices.id, r.id), eq(recurringInvoices.nextRunDate, r.nextRunDate)))
        .returning({ id: recurringInvoices.id });
      if (!fresh) return;
      const actor: Actor = { tenant, userId: null };
      // A run that was missed until its period got closed is issued today instead of failing forever.
      const issueDate = (await isClosedDate(tx, tenant.id, r.nextRunDate)) ? today : r.nextRunDate;
      const id = await insertInvoice(tx, actor, {
        clientId: r.clientId,
        issueDate,
        dueDate: addDays(issueDate, tenant.settings.paymentTermsDays),
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
