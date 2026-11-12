import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { t } from "@/i18n";
import { today as todayIn } from "@/lib/dates";
import { formatDocNumber } from "@/lib/line-items";
import { allocateShare, formatMoney } from "@/lib/money";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import {
  accounts,
  categories,
  invoiceAdjustments,
  invoicePayments,
  invoices,
  transactions,
} from "@/server/db/schema";
import { nextCounter } from "@/server/shared";
import type { TenantContext } from "@/server/tenancy/context";
import { assertOpenDate, insertTransaction } from "@/features/finance";
import { actorOf, deliverInvoiceTx, invoiceBalance, loadInvoice, settledStatus } from "./service";

export type CreditNoteInput = {
  /** Amount credited, tax included, in the invoice's currency. */
  amountMinor: bigint;
  date: string;
  reason: string;
  /**
   * Where a refund is paid from. Needed when the credit is more than what is still
   * owed: that part was already paid and goes back to the client.
   */
  refundAccountId?: string | null;
  /** Base-currency units per invoice-currency unit, for a refund in another currency. */
  fxRate?: string;
};

/** The most a credit note can take off: what was billed and not already written off or credited. */
export function creditable(inv: {
  totalMinor: bigint;
  writtenOffMinor: bigint;
  creditedMinor: bigint;
}): bigint {
  const left = inv.totalMinor - inv.writtenOffMinor - inv.creditedMinor;
  return left > 0n ? left : 0n;
}

/** How a credit splits: first off what is still owed, the rest refunded (it was paid). */
export function creditSplit(
  inv: Parameters<typeof invoiceBalance>[0],
  amountMinor: bigint,
): { applied: bigint; refund: bigint } {
  const balance = invoiceBalance(inv);
  const applied = amountMinor < balance ? amountMinor : balance;
  return { applied, refund: amountMinor - applied };
}

/**
 * Issues a credit note against a sent or paid invoice (a correction: a discount
 * after the fact, work not delivered, a price mistake). It takes the amount off
 * what is owed; any part the client already paid is refunded from the chosen
 * account, which lowers income and GST collected in the ledger. Numbered CN-0001.
 */
export async function issueCreditNote(
  database: Database,
  ctx: TenantContext,
  invoiceId: string,
  input: CreditNoteInput,
): Promise<{ id: string; number: string; refundedMinor: bigint }> {
  const settings = ctx.tenant.settings;
  const reason = input.reason.trim();
  if (!reason) throw new UserError(t("credit.reasonRequired"));
  if (input.date > todayIn(settings.timezone)) throw new UserError(t("credit.future"));
  return database.transaction(async (tx) => {
    const inv = await loadInvoice(tx, ctx.tenant.id, invoiceId);
    if (inv.status === "draft" || inv.status === "void") throw new UserError(t("credit.notCreditable"));
    const max = creditable(inv);
    if (input.amountMinor <= 0n || input.amountMinor > max) {
      throw new UserError(t("credit.tooMuch", { max: formatMoney(max, inv.currency, settings.locale) }));
    }
    // The credit note changes GST for its period: a closed period stays as reported.
    await assertOpenDate(tx, ctx.tenant.id, input.date);

    const { refund } = creditSplit(inv, input.amountMinor);
    const number = formatDocNumber(
      settings.creditNotePrefix,
      await nextCounter(tx, ctx.tenant.id, "credit_note"),
    );
    let paidMinor = inv.paidMinor;
    let refundPaymentId: string | null = null;
    if (refund > 0n) {
      if (!input.refundAccountId) throw new UserError(t("credit.refundAccount"));
      const [account] = await tx
        .select({ currency: accounts.currency })
        .from(accounts)
        .where(and(eq(accounts.id, input.refundAccountId), eq(accounts.tenantId, ctx.tenant.id)));
      if (!account) throw new UserError(t("finance.accountMissing"));
      if (account.currency !== inv.currency) {
        throw new UserError(t("invoices.accountCurrency", { currency: inv.currency }));
      }
      paidMinor = inv.paidMinor - refund;
      // The GST inside the refund, allocated on the running paid total like payments are,
      // so payments and refunds of one invoice always add up to its tax exactly.
      const taxMinor =
        allocateShare(inv.taxMinor, inv.paidMinor, inv.totalMinor) -
        allocateShare(inv.taxMinor, paidMinor, inv.totalMinor);
      const transactionId = await insertTransaction(tx, ctx, {
        kind: "income",
        refund: true,
        accountId: input.refundAccountId,
        categoryId: await incomeCategory(tx, ctx.tenant.id, inv.id),
        date: input.date,
        description: t("credit.refundLine", { number, invoice: inv.number }),
        amountMinor: refund,
        taxMinor: taxMinor > 0n ? taxMinor : 0n,
        fxRate: input.fxRate,
        clientId: inv.clientId,
        invoiceId: inv.id,
      });
      const [payment] = await tx
        .insert(invoicePayments)
        .values({
          tenantId: ctx.tenant.id,
          invoiceId: inv.id,
          transactionId,
          amountMinor: -refund,
          date: input.date,
          method: "refund",
        })
        .returning({ id: invoicePayments.id });
      refundPaymentId = payment?.id ?? null;
    }

    const creditedMinor = inv.creditedMinor + input.amountMinor;
    const [row] = await tx
      .insert(invoiceAdjustments)
      .values({
        tenantId: ctx.tenant.id,
        invoiceId: inv.id,
        kind: "credit_note",
        number,
        date: input.date,
        amountMinor: input.amountMinor,
        taxMinor: allocateShare(inv.taxMinor, input.amountMinor, inv.totalMinor),
        refundedMinor: refund,
        refundPaymentId,
        reason: reason.slice(0, 500),
        createdBy: ctx.user.id,
      })
      .returning({ id: invoiceAdjustments.id });
    if (!row) throw new Error("Credit note insert failed");
    const updated = {
      ...inv,
      paidMinor,
      creditedMinor,
      status: settledStatus({ ...inv, paidMinor, creditedMinor }),
    };
    await tx
      .update(invoices)
      .set({ paidMinor, creditedMinor, status: updated.status })
      .where(eq(invoices.id, inv.id));
    await deliverInvoiceTx(tx, actorOf(ctx), updated, "credit", {
      number,
      amountMinor: input.amountMinor,
      refundMinor: refund,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "invoice.creditNote",
      entityType: "invoice",
      entityId: inv.id,
      data: { number, amount: input.amountMinor, refund, reason },
    });
    await markChanged(tx, ctx.tenant.id, "invoice", inv.id);
    return { id: row.id, number, refundedMinor: refund };
  });
}

/** The income category of the invoice's own payments, else the first income category. */
async function incomeCategory(tx: DbOrTx, tenantId: string, invoiceId: string): Promise<string | null> {
  const [paid] = await tx
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        eq(transactions.invoiceId, invoiceId),
        eq(transactions.kind, "income"),
        isNull(transactions.reversesId),
      ),
    )
    .orderBy(desc(transactions.createdAt))
    .limit(1);
  if (paid?.categoryId) return paid.categoryId;
  const [cat] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(eq(categories.tenantId, tenantId), eq(categories.kind, "income"), eq(categories.archived, false)),
    )
    .orderBy(asc(categories.createdAt))
    .limit(1);
  return cat?.id ?? null;
}

/**
 * Takes back a credit note issued by mistake: the amount is owed again. Only while
 * nothing was refunded (money paid out can't be un-paid) and its period is open.
 */
export async function voidCreditNote(database: Database, ctx: TenantContext, adjustmentId: string) {
  await database.transaction(async (tx) => {
    const [note] = await tx
      .select()
      .from(invoiceAdjustments)
      .where(
        and(
          eq(invoiceAdjustments.id, adjustmentId),
          eq(invoiceAdjustments.tenantId, ctx.tenant.id),
          eq(invoiceAdjustments.kind, "credit_note"),
        ),
      )
      .for("update");
    if (!note || note.voidedAt) throw new UserError(t("credit.missing"));
    if (note.refundedMinor > 0n) throw new UserError(t("credit.refundedFinal"));
    await assertOpenDate(tx, ctx.tenant.id, note.date);
    const inv = await loadInvoice(tx, ctx.tenant.id, note.invoiceId);
    const creditedMinor = inv.creditedMinor - note.amountMinor;
    await tx
      .update(invoices)
      .set({ creditedMinor, status: settledStatus({ ...inv, creditedMinor }) })
      .where(eq(invoices.id, inv.id));
    await tx
      .update(invoiceAdjustments)
      .set({ voidedAt: new Date() })
      .where(eq(invoiceAdjustments.id, note.id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "invoice.creditNote.void",
      entityType: "invoice",
      entityId: inv.id,
      data: { number: note.number, amount: note.amountMinor },
    });
    await markChanged(tx, ctx.tenant.id, "invoice", inv.id);
  });
}

/** Write-offs and credit notes of one invoice, oldest first (voided ones included, marked). */
export async function invoiceAdjustmentsOf(database: DbOrTx, tenantId: string, invoiceId: string) {
  return database
    .select()
    .from(invoiceAdjustments)
    .where(and(eq(invoiceAdjustments.tenantId, tenantId), eq(invoiceAdjustments.invoiceId, invoiceId)))
    .orderBy(asc(invoiceAdjustments.date), asc(invoiceAdjustments.createdAt));
}

/** One credit note with its invoice, for the printable credit note. */
export async function getCreditNote(database: DbOrTx, tenantId: string, adjustmentId: string) {
  const [note] = await database
    .select()
    .from(invoiceAdjustments)
    .where(
      and(
        eq(invoiceAdjustments.id, adjustmentId),
        eq(invoiceAdjustments.tenantId, tenantId),
        eq(invoiceAdjustments.kind, "credit_note"),
      ),
    );
  return note ?? null;
}
