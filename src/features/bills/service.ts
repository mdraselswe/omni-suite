import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableName,
  isNotNull,
  isNull,
  sql,
  type Column,
  type SQL,
  type Table,
} from "drizzle-orm";
import { serverEnv } from "@/config/env";
import { t } from "@/i18n";
import { today as todayIn } from "@/lib/dates";
import { isSupportedCurrency } from "@/lib/intl-options";
import { allocateShare, formatMoney } from "@/lib/money";
import { paginate, type PageRequest } from "@/lib/pagination";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { accounts, billPayments, bills, categories, transactions } from "@/server/db/schema";
import { matchesSearch } from "@/server/search";
import { removeFile, storeFile } from "@/server/storage";
import type { TenantContext } from "@/server/tenancy/context";
import { insertTransaction, reverseTransactionTx } from "@/features/finance";
import { formatBytes, storageQuota, storageUsed } from "@/features/files";
import { billBalance, type BillFilterStatus } from "./status";

export * from "./status";

/* ─── Derived amounts ──────────────────────────────────────────── */

/**
 * A column with its table name. Drizzle leaves the table off columns in the select list of a
 * one-table query, which would make the correlated subquery below ambiguous there.
 */
const q = (table: Table, column: Column) =>
  sql`${sql.identifier(getTableName(table))}.${sql.identifier(column.name)}`;

/**
 * What has been paid on a bill: its payments whose ledger row is still live. A row
 * reversed from the bill page or from the ledger stops counting, so the bill reopens.
 */
const paidSql = sql<string>`(select coalesce(sum(${q(billPayments, billPayments.amountMinor)}), 0) from ${billPayments}
  inner join ${transactions} on ${q(transactions, transactions.id)} = ${q(billPayments, billPayments.transactionId)}
  where ${q(billPayments, billPayments.billId)} = ${q(bills, bills.id)}
  and ${q(billPayments, billPayments.tenantId)} = ${q(bills, bills.tenantId)}
  and ${q(transactions, transactions.reversedAt)} is null)`;

/** Unpaid and not void. */
const isOpen = sql`(${bills.voidedAt} is null and ${bills.totalMinor} > ${paidSql})`;

/** Live payments of one bill: amount paid and the tax inside them (bill currency). */
async function livePaid(tx: DbOrTx, tenantId: string, billId: string) {
  const [row] = await tx
    .select({
      paid: sql<string>`coalesce(sum(${billPayments.amountMinor}), 0)`,
      tax: sql<string>`coalesce(sum(${transactions.taxMinor}), 0)`,
    })
    .from(billPayments)
    .innerJoin(transactions, eq(transactions.id, billPayments.transactionId))
    .where(
      and(
        eq(billPayments.tenantId, tenantId),
        eq(billPayments.billId, billId),
        isNull(transactions.reversedAt),
      ),
    );
  return { paidMinor: BigInt(row?.paid ?? "0"), taxMinor: BigInt(row?.tax ?? "0") };
}

/** The bill row, locked for the rest of the transaction (payments and edits take turns). */
async function lockBill(tx: DbOrTx, tenantId: string, id: string) {
  const [row] = await tx
    .select()
    .from(bills)
    .where(and(eq(bills.id, id), eq(bills.tenantId, tenantId)))
    .for("update");
  if (!row) throw new UserError(t("bills.missing"));
  return row;
}

/* ─── Attachments ──────────────────────────────────────────────── */

/**
 * Server Actions accept bodies up to 4 MB (next.config.ts), so a bill's copy stays
 * under 3 MB, or the upload limit when that is lower.
 */
const ATTACHMENT_CAP_MB = 3;
const ATTACHMENT_TYPES = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;

export function attachmentMaxMb(): number {
  return Math.min(serverEnv().MAX_UPLOAD_MB, ATTACHMENT_CAP_MB);
}

type Attachment = { fileKey: string; fileName: string; fileMime: string; fileSize: number };

/** Checks and stores an attached bill copy; the caller removes it again if the write fails. */
async function storeAttachment(database: DbOrTx, tenantId: string, file: File): Promise<Attachment> {
  const max = attachmentMaxMb();
  if (file.size === 0) throw new UserError(t("bills.fileEmpty"));
  if (file.size > max * 1024 * 1024) throw new UserError(t("bills.fileTooLarge", { mb: max }));
  if (!ATTACHMENT_TYPES.test(file.type)) throw new UserError(t("bills.fileType"));
  // Counts towards the business's storage quota, with the files it keeps.
  const [row] = await database
    .select({ bytes: sql<string>`coalesce(sum(${bills.fileSize}), 0)::bigint` })
    .from(bills)
    .where(eq(bills.tenantId, tenantId));
  const used = (await storageUsed(database, tenantId)) + Number(row?.bytes ?? 0);
  const quota = storageQuota();
  if (used + file.size > quota) {
    throw new UserError(t("security.storageFull", { limit: formatBytes(quota), used: formatBytes(used) }));
  }
  const fileKey = await storeFile(tenantId, new Uint8Array(await file.arrayBuffer()));
  return { fileKey, fileName: file.name.slice(0, 200) || "bill", fileMime: file.type, fileSize: file.size };
}

/** The attached copy of a bill (for the download route), or null. */
export async function billAttachment(database: DbOrTx, tenantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await database
    .select({ key: bills.fileKey, name: bills.fileName, mime: bills.fileMime })
    .from(bills)
    .where(and(eq(bills.id, id), eq(bills.tenantId, tenantId)));
  if (!row?.key) return null;
  return { key: row.key, name: row.name ?? "bill", mime: row.mime ?? "application/octet-stream" };
}

/* ─── Create, edit, void ───────────────────────────────────────── */

export type BillInput = {
  supplier: string;
  reference: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  totalMinor: bigint;
  taxMinor: bigint;
  categoryId: string | null;
  notes: string;
};

async function assertBillInput(tx: DbOrTx, tenantId: string, input: BillInput): Promise<void> {
  if (!input.supplier.trim()) throw new UserError(t("bills.supplierRequired"));
  if (!isSupportedCurrency(input.currency)) throw new UserError(t("locale.badCurrency"));
  if (input.totalMinor <= 0n) throw new UserError(t("form.amount"));
  if (input.taxMinor < 0n || input.taxMinor > input.totalMinor) throw new UserError(t("bills.taxTooBig"));
  if (input.dueDate < input.issueDate) throw new UserError(t("bills.dueBeforeIssue"));
  if (input.categoryId) {
    const [cat] = await tx
      .select({ kind: categories.kind })
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.tenantId, tenantId)));
    if (!cat || cat.kind !== "expense") throw new UserError(t("bills.categoryKind"));
  }
}

export async function createBill(
  database: Database,
  ctx: TenantContext,
  input: BillInput,
  file: File | null = null,
): Promise<string> {
  await assertBillInput(database, ctx.tenant.id, input);
  const attachment = file ? await storeAttachment(database, ctx.tenant.id, file) : null;
  try {
    return await database.transaction(async (tx) => {
      const [row] = await tx
        .insert(bills)
        .values({ tenantId: ctx.tenant.id, ...input, ...attachment, createdBy: ctx.user.id })
        .returning({ id: bills.id });
      if (!row) throw new Error("Bill insert failed");
      await audit(tx, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        action: "bill.create",
        entityType: "bill",
        entityId: row.id,
        data: { ...input, file: attachment?.fileName ?? null },
      });
      await markChanged(tx, ctx.tenant.id, "bill", row.id);
      return row.id;
    });
  } catch (error) {
    if (attachment) await removeFile(attachment.fileKey);
    throw error;
  }
}

/** Edits a bill nothing has been paid on yet. `file` replaces the copy; `removeFile` drops it. */
export async function updateBill(
  database: Database,
  ctx: TenantContext,
  id: string,
  input: BillInput,
  options: { file?: File | null; removeFile?: boolean } = {},
): Promise<void> {
  await assertBillInput(database, ctx.tenant.id, input);
  const attachment = options.file ? await storeAttachment(database, ctx.tenant.id, options.file) : null;
  let oldKey: string | null = null;
  try {
    await database.transaction(async (tx) => {
      const bill = await lockBill(tx, ctx.tenant.id, id);
      if (bill.voidedAt) throw new UserError(t("bills.notEditable"));
      if ((await livePaid(tx, ctx.tenant.id, id)).paidMinor > 0n) throw new UserError(t("bills.notEditable"));
      const dropFile = attachment !== null || options.removeFile === true;
      oldKey = dropFile ? bill.fileKey : null;
      await tx
        .update(bills)
        .set({
          ...input,
          ...(attachment ??
            (options.removeFile ? { fileKey: null, fileName: null, fileMime: null, fileSize: null } : {})),
        })
        .where(eq(bills.id, id));
      await audit(tx, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        action: "bill.update",
        entityType: "bill",
        entityId: id,
        data: { ...input, file: attachment?.fileName ?? (options.removeFile ? null : bill.fileName) },
      });
      await markChanged(tx, ctx.tenant.id, "bill", id);
    });
  } catch (error) {
    if (attachment) await removeFile(attachment.fileKey);
    throw error;
  }
  if (oldKey) await removeFile(oldKey);
}

/** Cancels a bill that has no live payments (undo them first). Kept for the record. */
export async function voidBill(database: Database, ctx: TenantContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const bill = await lockBill(tx, ctx.tenant.id, id);
    if (bill.voidedAt) throw new UserError(t("bills.alreadyVoid"));
    if ((await livePaid(tx, ctx.tenant.id, id)).paidMinor > 0n)
      throw new UserError(t("bills.voidHasPayments"));
    await tx.update(bills).set({ voidedAt: new Date() }).where(eq(bills.id, id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "bill.void",
      entityType: "bill",
      entityId: id,
    });
    await markChanged(tx, ctx.tenant.id, "bill", id);
  });
}

/* ─── Payments ─────────────────────────────────────────────────── */

export type BillPaymentInput = {
  amountMinor: bigint;
  date: string;
  accountId: string;
  /** Base-currency units per 1 unit of the bill's currency; needed when that isn't the base currency. */
  fxRate?: string;
};

/**
 * Pays all or part of a bill: one expense row in the ledger, in the bill's category,
 * carrying the part of the bill's GST this payment covers. So profit, the GST report
 * and the account balance follow without anything else to update.
 */
export async function payBill(
  database: Database,
  ctx: TenantContext,
  id: string,
  input: BillPaymentInput,
): Promise<string> {
  return database.transaction(async (tx) => {
    const bill = await lockBill(tx, ctx.tenant.id, id);
    if (bill.voidedAt) throw new UserError(t("bills.notPayable"));
    // Money not paid yet can't be recorded: balances and the GST report would be wrong.
    if (input.date > todayIn(ctx.tenant.settings.timezone)) throw new UserError(t("bills.paymentInFuture"));
    const live = await livePaid(tx, ctx.tenant.id, id);
    const balance = bill.totalMinor - live.paidMinor;
    if (balance <= 0n) throw new UserError(t("bills.notPayable"));
    if (input.amountMinor <= 0n || input.amountMinor > balance) {
      throw new UserError(
        t("bills.overpay", { balance: formatMoney(balance, bill.currency, ctx.tenant.settings.locale) }),
      );
    }
    const [account] = await tx
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), eq(accounts.tenantId, ctx.tenant.id)));
    if (!account) throw new UserError(t("finance.accountMissing"));
    if (account.currency !== bill.currency) {
      throw new UserError(t("bills.accountCurrency", { currency: bill.currency }));
    }
    // The bill's GST pro rata, on the running total of live payments: the parts add up to
    // exactly the bill's tax once it is paid, even after a payment was undone.
    const share =
      allocateShare(bill.taxMinor, live.paidMinor + input.amountMinor, bill.totalMinor) - live.taxMinor;
    const taxMinor = share < 0n ? 0n : share > input.amountMinor ? input.amountMinor : share;
    const transactionId = await insertTransaction(tx, ctx, {
      kind: "expense",
      accountId: input.accountId,
      categoryId: bill.categoryId,
      date: input.date,
      description: bill.reference
        ? t("bills.paymentDescRef", { supplier: bill.supplier, reference: bill.reference })
        : t("bills.paymentDesc", { supplier: bill.supplier }),
      amountMinor: input.amountMinor,
      taxMinor,
      fxRate: input.fxRate,
    });
    const [payment] = await tx
      .insert(billPayments)
      .values({
        tenantId: ctx.tenant.id,
        billId: id,
        transactionId,
        amountMinor: input.amountMinor,
        date: input.date,
        createdBy: ctx.user.id,
      })
      .returning({ id: billPayments.id });
    if (!payment) throw new Error("Bill payment insert failed");
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "bill.payment",
      entityType: "bill",
      entityId: id,
      data: { amount: input.amountMinor, tax: taxMinor, transactionId },
    });
    await markChanged(tx, ctx.tenant.id, "bill", id);
    return payment.id;
  });
}

/**
 * Undoes a payment by reversing its ledger row (dated `date`, normally today, so a
 * closed period stays untouched). The bill reopens by the amount.
 */
export async function undoBillPayment(
  database: Database,
  ctx: TenantContext,
  billId: string,
  paymentId: string,
  date: string,
  reason: string,
): Promise<void> {
  await database.transaction(async (tx) => {
    await lockBill(tx, ctx.tenant.id, billId);
    const [payment] = await tx
      .select({ transactionId: billPayments.transactionId, amountMinor: billPayments.amountMinor })
      .from(billPayments)
      .where(
        and(
          eq(billPayments.id, paymentId),
          eq(billPayments.billId, billId),
          eq(billPayments.tenantId, ctx.tenant.id),
        ),
      );
    if (!payment) throw new UserError(t("bills.paymentMissing"));
    await reverseTransactionTx(tx, ctx, payment.transactionId, date, reason || t("bills.undoReason"));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "bill.payment.undo",
      entityType: "bill",
      entityId: billId,
      data: { amount: payment.amountMinor, transactionId: payment.transactionId, reason },
    });
    await markChanged(tx, ctx.tenant.id, "bill", billId);
  });
}

/* ─── Reads ────────────────────────────────────────────────────── */

export type BillFilter = {
  status?: BillFilterStatus;
  /** Words to find in the supplier, reference or notes. */
  q?: string;
  /** Needed for status "overdue". */
  today?: string;
};

function billWhere(tenantId: string, filter: BillFilter): SQL | undefined {
  const status =
    filter.status === "open"
      ? isOpen
      : filter.status === "overdue"
        ? and(isOpen, sql`${bills.dueDate} < ${filter.today ?? "0000-01-01"}`)
        : filter.status === "paid"
          ? and(isNull(bills.voidedAt), sql`${bills.totalMinor} <= ${paidSql}`)
          : filter.status === "void"
            ? isNotNull(bills.voidedAt)
            : undefined;
  return and(
    eq(bills.tenantId, tenantId),
    status,
    matchesSearch(filter.q, [bills.supplier, bills.reference, bills.notes]),
  );
}

function withPaid<T extends { bill: typeof bills.$inferSelect; paid: string }>(row: T) {
  const paidMinor = BigInt(row.paid);
  return { ...row, bill: { ...row.bill, paidMinor } };
}

/** One page of bills (unpaid first, soonest due first) and the number that match. */
export async function pageBills(database: DbOrTx, tenantId: string, filter: BillFilter, page: PageRequest) {
  const where = billWhere(tenantId, filter);
  return paginate(
    page,
    async () => {
      const [row] = await database.select({ n: count() }).from(bills).where(where);
      return row?.n ?? 0;
    },
    async (limit, offset) => {
      const rows = await database
        .select({ bill: bills, paid: paidSql, categoryName: categories.name })
        .from(bills)
        .leftJoin(categories, eq(categories.id, bills.categoryId))
        .where(where)
        .orderBy(
          sql`case when ${isOpen} then 0 else 1 end`,
          sql`case when ${isOpen} then ${bills.dueDate} end asc`,
          desc(bills.issueDate),
          desc(bills.id),
        )
        .limit(limit)
        .offset(offset);
      return rows.map(withPaid);
    },
  );
}

export type BillRow = Awaited<ReturnType<typeof pageBills>>["rows"][number];

export async function getBill(database: DbOrTx, tenantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await database
    .select({ bill: bills, paid: paidSql, categoryName: categories.name })
    .from(bills)
    .leftJoin(categories, eq(categories.id, bills.categoryId))
    .where(and(eq(bills.id, id), eq(bills.tenantId, tenantId)));
  if (!row) return null;
  const payments = await database
    .select({
      id: billPayments.id,
      date: billPayments.date,
      amountMinor: billPayments.amountMinor,
      transactionId: billPayments.transactionId,
      currency: transactions.currency,
      taxMinor: transactions.taxMinor,
      reversedAt: transactions.reversedAt,
      accountName: accounts.name,
    })
    .from(billPayments)
    .innerJoin(transactions, eq(transactions.id, billPayments.transactionId))
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(billPayments.tenantId, tenantId), eq(billPayments.billId, id)))
    .orderBy(asc(billPayments.date), asc(billPayments.createdAt));
  return { ...withPaid(row), payments };
}

/** The currency of one of the tenant's bills (null if it isn't theirs). */
export async function billCurrency(database: DbOrTx, tenantId: string, id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await database
    .select({ currency: bills.currency })
    .from(bills)
    .where(and(eq(bills.id, id), eq(bills.tenantId, tenantId)));
  return row?.currency ?? null;
}

/** Supplier names used before, for suggestions (most used first). */
export async function supplierNames(database: DbOrTx, tenantId: string, limit = 200): Promise<string[]> {
  const rows = await database
    .select({ supplier: bills.supplier })
    .from(bills)
    .where(eq(bills.tenantId, tenantId))
    .groupBy(bills.supplier)
    .orderBy(desc(count()), asc(bills.supplier))
    .limit(limit);
  return rows.map((r) => r.supplier);
}

export type Payable = {
  currency: string;
  owedMinor: bigint;
  overdueMinor: bigint;
  count: number;
  overdueCount: number;
};

/**
 * What the business owes on bills, per currency (amounts in different currencies
 * aren't added up without a rate), the base currency first. `overdue` is the part
 * past its due date. The bills page and the dashboard both read this.
 */
export async function payables(
  database: DbOrTx,
  tenantId: string,
  today: string,
  baseCurrency: string,
): Promise<{ base: Payable; byCurrency: Payable[] }> {
  const rows = await database
    .select({ currency: bills.currency, dueDate: bills.dueDate, total: bills.totalMinor, paid: paidSql })
    .from(bills)
    .where(and(eq(bills.tenantId, tenantId), isOpen));
  const by = new Map<string, Payable>();
  for (const r of rows) {
    const owed = billBalance({ totalMinor: r.total, paidMinor: BigInt(r.paid), voidedAt: null });
    if (owed <= 0n) continue;
    const p = by.get(r.currency) ?? {
      currency: r.currency,
      owedMinor: 0n,
      overdueMinor: 0n,
      count: 0,
      overdueCount: 0,
    };
    p.owedMinor += owed;
    p.count += 1;
    if (r.dueDate < today) {
      p.overdueMinor += owed;
      p.overdueCount += 1;
    }
    by.set(r.currency, p);
  }
  const empty: Payable = {
    currency: baseCurrency,
    owedMinor: 0n,
    overdueMinor: 0n,
    count: 0,
    overdueCount: 0,
  };
  const base = by.get(baseCurrency) ?? empty;
  const others = [...by.values()]
    .filter((p) => p.currency !== baseCurrency)
    .toSorted((a, b) => a.currency.localeCompare(b.currency));
  return { base, byCurrency: base.count > 0 ? [base, ...others] : others };
}
