import "server-only";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { limits } from "@/config";
import { t, type MessageKey } from "@/i18n";
import {
  cellOf,
  countRows,
  matchColumns,
  normaliseText,
  parseImportDate,
  rowStatus,
  type DateFormat,
  type ImportCounts,
  type ImportPreview,
  type ImportRowView,
} from "@/lib/csv-import";
import { formatMoney, parseMoney } from "@/lib/money";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { accounts, transactions } from "@/server/db/schema";
import { parseCsv } from "@/server/export";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { insertTransaction, isClosedDate, listCategories, type NewTransaction } from "./service";

/**
 * Bank statement CSV import into one account. Columns are found by name (case,
 * spaces and punctuation ignored). The amount is either one signed column
 * (money in positive, money out negative) or separate money-in / money-out columns.
 */
export const BANK_COLUMNS = {
  date: ["date", "transaction date", "posted date", "posting date", "booking date", "value date"],
  description: ["description", "details", "transaction details", "narrative", "particulars", "memo", "payee"],
  amount: ["amount", "signed amount", "transaction amount", "net amount", "value"],
  moneyIn: ["money in", "in", "paid in", "credit", "credits", "credit amount", "deposit", "deposits"],
  moneyOut: ["money out", "out", "paid out", "debit", "debits", "debit amount", "withdrawal", "withdrawals"],
  reference: ["reference", "ref", "reference number", "transaction id", "cheque number", "check number"],
  category: ["category", "category name"],
  tax: ["tax", "tax amount", "gst", "gst amount", "vat", "vat amount"],
} as const;

type BankColumn = keyof typeof BANK_COLUMNS;

const COLUMN_LABEL: Record<BankColumn, MessageKey> = {
  date: "form.date.label",
  description: "form.description",
  amount: "finance.amount",
  moneyIn: "imports.bank.moneyIn",
  moneyOut: "imports.bank.moneyOut",
  reference: "imports.bank.reference",
  category: "finance.category",
  tax: "imports.bank.tax",
};

/** Same limit as the transaction form. */
const DESCRIPTION_MAX = 300;

/** The sample file offered in the dialog: header plus three rows (signed amounts). */
export const BANK_SAMPLE: readonly (readonly string[])[] = [
  ["date", "description", "amount", "reference", "category", "tax"],
  ["2026-11-03", "Payment from Citizen Bakery", "1,650.00", "INV-0042", "Sales", "150.00"],
  ["2026-11-04", "Adobe subscription", "-89.99", "", "Software", "8.18"],
  ["2026-11-05", "Bank fee", "(5.00)", "", "", ""],
];

export type BankImportOptions = {
  accountId: string;
  dateFormat: DateFormat;
  /** Units of base currency per 1 account-currency unit; needed when the account is in another currency. */
  fxRate?: string;
};

export type PlannedTransaction = ImportRowView & { tx: NewTransaction | null };

export type BankImportPlan = {
  account: { id: string; name: string; currency: string };
  rows: PlannedTransaction[];
  columns: { field: string; header: string }[];
  ignored: string[];
};

/** The CSV rows of an uploaded file (first row is the header), refusing empty and oversized files. */
export async function readImportRows(formData: FormData): Promise<Record<string, string>[]> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UserError(t("files.empty"));
  const rows = parseCsv(await file.text());
  if (rows.length === 0) throw new UserError(t("imports.noRows"));
  if (rows.length > limits.imports.maxRows)
    throw new UserError(t("imports.tooMany", { count: rows.length, max: limits.imports.maxRows }));
  return rows;
}

const abs = (v: bigint) => (v < 0n ? -v : v);

/** Duplicate key: day, signed amount as the account sees it, and the description (case and spaces ignored). */
const txKey = (date: string, signedMinor: bigint, description: string) =>
  `${date}|${signedMinor}|${normaliseText(description)}`;

/** What a description becomes in the ledger: the reference, if any, goes in brackets after it. */
export function ledgerDescription(description: string, reference: string): string {
  const text = reference ? (description ? `${description} (${reference})` : reference) : description;
  return text.slice(0, DESCRIPTION_MAX);
}

/**
 * Keys of the live (not reversed) ledger rows of `accountId` between two days,
 * each with the signed amount the account saw: money in positive, money out negative.
 */
async function existingKeys(database: DbOrTx, tenantId: string, accountId: string, from: string, to: string) {
  const rows = await database
    .select({
      kind: transactions.kind,
      accountId: transactions.accountId,
      date: transactions.date,
      description: transactions.description,
      amountMinor: transactions.amountMinor,
      toAmountMinor: transactions.toAmountMinor,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        or(eq(transactions.accountId, accountId), eq(transactions.toAccountId, accountId)),
        gte(transactions.date, from),
        lte(transactions.date, to),
        isNull(transactions.reversesId),
        isNull(transactions.reversedAt),
      ),
    );
  const keys = new Set<string>();
  for (const r of rows) {
    const incoming = r.accountId !== accountId; // the receiving side of a transfer
    const signedMinor = incoming
      ? (r.toAmountMinor ?? r.amountMinor)
      : r.kind === "income" || r.kind === "capital_in"
        ? r.amountMinor
        : -r.amountMinor;
    keys.add(txKey(r.date, signedMinor, r.description));
  }
  return keys;
}

/**
 * Checks every row without writing anything: the preview and the import share it.
 * Positive amounts become income, negative ones expenses. A row is a duplicate when
 * the account already has a live entry with the same day, amount and description
 * (reference included), or an earlier row in the file has.
 */
export async function planBankImport(
  database: DbOrTx,
  ctx: TenantContext,
  rows: readonly Record<string, string>[],
  options: BankImportOptions,
): Promise<BankImportPlan> {
  const tenantId = ctx.tenant.id;
  const base = ctx.tenant.settings.currency;
  const locale = ctx.tenant.settings.locale;
  const [account] = await database
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(
      and(eq(accounts.id, options.accountId), eq(accounts.tenantId, tenantId), eq(accounts.archived, false)),
    );
  if (!account) throw new UserError(t("finance.accountMissing"));
  const fxRate = account.currency === base ? undefined : options.fxRate;
  if (account.currency !== base && !(fxRate && /^\d+(\.\d{1,8})?$/.test(fxRate) && Number(fxRate) > 0))
    throw new UserError(t("finance.fxRequired"));

  const headers = Object.keys(rows[0] ?? {});
  const col = matchColumns(headers, BANK_COLUMNS);
  if (!col.date) throw new UserError(t("imports.bank.noDate"));
  // A signed amount column wins; otherwise money in / money out.
  if (col.amount) {
    delete col.moneyIn;
    delete col.moneyOut;
  } else if (!col.moneyIn && !col.moneyOut) throw new UserError(t("imports.bank.noAmount"));

  const categories = await listCategories(database, tenantId);
  const categoryId = (kind: "income" | "expense", name: string) =>
    categories.find((c) => c.kind === kind && normaliseText(c.name) === name)?.id;

  const money = (text: string) => (text ? parseMoney(text, account.currency) : 0n);
  const closed = new Map<string, boolean>();
  const seen = new Map<string, number>();

  type Draft = {
    n: number;
    errors: string[];
    warnings: string[];
    date: string | null;
    dateText: string;
    signedMinor: bigint | null;
    taxMinor: bigint;
    description: string;
    categoryId: string | null;
    categoryName: string;
  };

  const drafts: Draft[] = rows.map((row, i) => {
    const get = (c: BankColumn) => cellOf(row, col[c]);
    const errors: string[] = [];
    const warnings: string[] = [];
    const dateText = get("date");
    const date = parseImportDate(dateText, options.dateFormat);
    if (!date)
      errors.push(dateText ? t("imports.badDate", { value: dateText }) : t("imports.bank.dateMissing"));

    let signedMinor: bigint | null = null;
    if (col.amount) {
      const text = get("amount");
      signedMinor = text ? parseMoney(text, account.currency) : null;
      if (signedMinor === null)
        errors.push(text ? t("imports.badAmount", { value: text }) : t("imports.bank.zeroAmount"));
    } else {
      const inText = get("moneyIn");
      const outText = get("moneyOut");
      const moneyIn = money(inText);
      const moneyOut = money(outText);
      if (moneyIn === null) errors.push(t("imports.badAmount", { value: inText }));
      if (moneyOut === null) errors.push(t("imports.badAmount", { value: outText }));
      if (moneyIn !== null && moneyOut !== null) {
        // Some banks show money out as a negative number in its own column: the column gives the direction.
        if (moneyIn !== 0n && moneyOut !== 0n) errors.push(t("imports.bank.bothInAndOut"));
        else signedMinor = abs(moneyIn) - abs(moneyOut);
      }
    }
    if (signedMinor === 0n) errors.push(t("imports.bank.zeroAmount"));

    const taxText = get("tax");
    const taxParsed = money(taxText);
    const taxMinor = taxParsed === null ? 0n : abs(taxParsed);
    if (taxParsed === null) errors.push(t("imports.badAmount", { value: taxText }));
    else if (signedMinor !== null && signedMinor !== 0n && taxMinor > abs(signedMinor))
      errors.push(t("imports.bank.taxTooBig"));

    const description = ledgerDescription(get("description"), get("reference"));

    let category: string | null = null;
    const categoryName = get("category");
    if (categoryName && signedMinor !== null && signedMinor !== 0n) {
      const kind = signedMinor > 0n ? "income" : "expense";
      const name = normaliseText(categoryName);
      category = categoryId(kind, name) ?? null;
      if (!category) {
        const other = categoryId(kind === "income" ? "expense" : "income", name);
        warnings.push(
          t(other ? `imports.bank.categoryOtherKind.${kind}` : "imports.bank.unknownCategory", {
            value: categoryName,
          }),
        );
      }
    }
    return {
      n: i + 1,
      errors,
      warnings,
      date,
      dateText,
      signedMinor,
      taxMinor,
      description,
      categoryId: category,
      categoryName: category ? categoryName : "",
    };
  });

  // Closed periods and existing entries, looked up once for the file's date range.
  const dates = drafts.flatMap((d) => (d.date ? [d.date] : [])).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const existing =
    first && last ? await existingKeys(database, tenantId, account.id, first, last) : new Set<string>();
  for (const day of new Set(dates)) closed.set(day, await isClosedDate(database, tenantId, day));

  const planned = drafts.map((d): PlannedTransaction => {
    const { errors, warnings } = d;
    if (d.date && closed.get(d.date)) errors.push(t("finance.periodClosed", { date: d.date }));
    let duplicate = false;
    if (errors.length === 0 && d.date && d.signedMinor !== null) {
      const key = txKey(d.date, d.signedMinor, d.description);
      const earlier = seen.get(key);
      if (existing.has(key)) {
        duplicate = true;
        warnings.length = 0;
        warnings.push(t("imports.bank.exists", { account: account.name }));
      } else if (earlier !== undefined) {
        duplicate = true;
        warnings.length = 0;
        warnings.push(t("imports.duplicateInFile", { row: earlier }));
      } else {
        seen.set(key, d.n);
      }
    }
    const status = rowStatus({ errors: errors.length, duplicate, warnings: warnings.length });
    const ready = status === "ready" || status === "warning";
    return {
      row: d.n,
      status,
      messages: [...errors, ...warnings],
      cells: [
        d.date ?? d.dateText,
        d.description,
        d.signedMinor !== null ? formatMoney(d.signedMinor, account.currency, locale) : "",
        d.categoryName || t("finance.uncategorised"),
        d.taxMinor > 0n ? formatMoney(d.taxMinor, account.currency, locale) : "",
      ],
      tx:
        ready && d.date && d.signedMinor
          ? {
              kind: d.signedMinor > 0n ? "income" : "expense",
              accountId: account.id,
              categoryId: d.categoryId,
              date: d.date,
              description: d.description,
              amountMinor: abs(d.signedMinor),
              taxMinor: d.taxMinor,
              fxRate,
            }
          : null,
    };
  });

  const columns = (Object.keys(BANK_COLUMNS) as BankColumn[]).flatMap((c) => {
    const header = col[c];
    return header === undefined ? [] : [{ field: t(COLUMN_LABEL[c]), header }];
  });
  const used = new Set(columns.map((c) => c.header));
  return { account, rows: planned, columns, ignored: headers.filter((h) => !used.has(h)) };
}

/** The plan as the dialog shows it. */
export function bankPreview(plan: BankImportPlan): ImportPreview {
  return {
    ok: true,
    rows: plan.rows.map((r) => ({ row: r.row, status: r.status, cells: r.cells, messages: r.messages })),
    counts: countRows(plan.rows),
    columns: plan.columns,
    ignored: plan.ignored,
  };
}

/**
 * Imports the rows that passed into the chosen account, all in one database
 * transaction (a failure leaves nothing behind). Each row goes through
 * `insertTransaction`, so closed periods, tax, exchange rate, audit and backup
 * sync work exactly like the transaction form; one more audit entry records the counts.
 */
export async function importBankTransactions(
  database: Database,
  ctx: TenantContext,
  rows: readonly Record<string, string>[],
  options: BankImportOptions,
): Promise<ImportCounts & { imported: number }> {
  requirePermission(ctx, "finance.write");
  return database.transaction(async (tx) => {
    const plan = await planBankImport(tx, ctx, rows, options);
    let imported = 0;
    for (const r of plan.rows) {
      if (!r.tx) continue;
      await insertTransaction(tx, ctx, r.tx);
      imported++;
    }
    const counts = { ...countRows(plan.rows), imported };
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "transaction.import",
      entityType: "account",
      entityId: plan.account.id,
      data: counts,
    });
    return counts;
  });
}
