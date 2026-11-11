import "server-only";
import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { t } from "@/i18n";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { accounts, categories, periods, transactions } from "@/server/db/schema";
import type { TenantContext } from "@/server/tenancy/context";

export type TxKind = (typeof transactions.$inferSelect)["kind"];
export const TX_KINDS: readonly TxKind[] = ["income", "expense", "transfer", "capital_in", "drawing"];

/** +amount for a normal row, −amount for a reversal row (ledger stays append-only). */
const signed = (column: SQL | typeof transactions.amountMinor) =>
  sql`case when ${transactions.reversesId} is null then ${column} else -${column} end`;

/* ─── Accounts & categories ────────────────────────────────────── */

export async function listAccounts(database: DbOrTx, tenantId: string, includeArchived = false) {
  const inflow = sql<string>`coalesce(sum(case
      when ${transactions.kind} in ('income','capital_in') and ${transactions.accountId} = ${accounts.id} then ${signed(transactions.amountMinor)}
      when ${transactions.kind} = 'transfer' and ${transactions.toAccountId} = ${accounts.id} then ${signed(transactions.amountMinor)}
      else 0 end), 0)`;
  const outflow = sql<string>`coalesce(sum(case
      when ${transactions.kind} in ('expense','drawing','transfer') and ${transactions.accountId} = ${accounts.id} then ${signed(transactions.amountMinor)}
      else 0 end), 0)`;
  const rows = await database
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currency: accounts.currency,
      openingBalanceMinor: accounts.openingBalanceMinor,
      archived: accounts.archived,
      inflow,
      outflow,
    })
    .from(accounts)
    .leftJoin(
      transactions,
      and(
        eq(transactions.tenantId, accounts.tenantId),
        or(eq(transactions.accountId, accounts.id), eq(transactions.toAccountId, accounts.id)),
      ),
    )
    .where(and(eq(accounts.tenantId, tenantId), includeArchived ? undefined : eq(accounts.archived, false)))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    currency: r.currency,
    archived: r.archived,
    openingBalanceMinor: r.openingBalanceMinor,
    balanceMinor: r.openingBalanceMinor + BigInt(r.inflow) - BigInt(r.outflow),
  }));
}

export type AccountWithBalance = Awaited<ReturnType<typeof listAccounts>>[number];

export async function createAccount(
  database: Database,
  ctx: TenantContext,
  input: {
    name: string;
    type: "bank" | "cash" | "wallet" | "card";
    currency: string;
    openingBalanceMinor: bigint;
  },
): Promise<string> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .insert(accounts)
      .values({ tenantId: ctx.tenant.id, ...input })
      .returning({ id: accounts.id });
    if (!row) throw new Error("Account insert failed");
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "account.create",
      entityType: "account",
      entityId: row.id,
      data: input,
    });
    await markChanged(tx, ctx.tenant.id, "account", row.id);
    return row.id;
  });
}

export async function updateAccount(
  database: Database,
  ctx: TenantContext,
  id: string,
  input: { name: string; archived: boolean },
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx
      .update(accounts)
      .set(input)
      .where(and(eq(accounts.id, id), eq(accounts.tenantId, ctx.tenant.id)));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "account.update",
      entityType: "account",
      entityId: id,
      data: input,
    });
    await markChanged(tx, ctx.tenant.id, "account", id);
  });
}

export async function listCategories(database: DbOrTx, tenantId: string, includeArchived = false) {
  return database
    .select()
    .from(categories)
    .where(
      and(eq(categories.tenantId, tenantId), includeArchived ? undefined : eq(categories.archived, false)),
    )
    .orderBy(asc(categories.kind), asc(categories.name));
}

export async function createCategory(
  database: Database,
  ctx: TenantContext,
  input: { kind: "income" | "expense"; name: string },
): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .insert(categories)
      .values({ tenantId: ctx.tenant.id, ...input })
      .returning({ id: categories.id });
    if (row) await markChanged(tx, ctx.tenant.id, "category", row.id);
  });
}

export async function setCategoryArchived(
  database: Database,
  ctx: TenantContext,
  id: string,
  archived: boolean,
): Promise<void> {
  await database
    .update(categories)
    .set({ archived })
    .where(and(eq(categories.id, id), eq(categories.tenantId, ctx.tenant.id)));
}

/* ─── Periods ──────────────────────────────────────────────────── */

export async function listPeriods(database: DbOrTx, tenantId: string) {
  return database
    .select()
    .from(periods)
    .where(eq(periods.tenantId, tenantId))
    .orderBy(desc(periods.startDate));
}

/** Throws if `date` falls inside a closed period. */
export async function assertOpenDate(database: DbOrTx, tenantId: string, date: string): Promise<void> {
  const closed = await database
    .select({ id: periods.id })
    .from(periods)
    .where(
      and(
        eq(periods.tenantId, tenantId),
        lte(periods.startDate, date),
        gte(periods.endDate, date),
        sql`${periods.closedAt} is not null`,
      ),
    )
    .limit(1);
  if (closed.length > 0) throw new UserError(t("finance.periodClosed", { date }));
}

export async function closePeriod(
  database: Database,
  ctx: TenantContext,
  input: { startDate: string; endDate: string },
): Promise<void> {
  if (input.endDate < input.startDate) throw new UserError(t("finance.periodRange"));
  await database.transaction(async (tx) => {
    await tx.insert(periods).values({
      tenantId: ctx.tenant.id,
      startDate: input.startDate,
      endDate: input.endDate,
      closedAt: new Date(),
      closedBy: ctx.user.id,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "period.close",
      entityType: "period",
      data: input,
    });
  });
}

export async function reopenPeriod(database: Database, ctx: TenantContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .delete(periods)
      .where(and(eq(periods.id, id), eq(periods.tenantId, ctx.tenant.id)))
      .returning();
    if (!row) return;
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "period.reopen",
      entityType: "period",
      data: { startDate: row.startDate, endDate: row.endDate },
    });
  });
}

/* ─── Transactions ─────────────────────────────────────────────── */

export type NewTransaction = {
  kind: TxKind;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  date: string;
  description: string;
  amountMinor: bigint;
  /** Units of base currency per 1 unit of the account currency. Default 1. */
  fxRate?: string;
  partnerId?: string | null;
  clientId?: string | null;
  invoiceId?: string | null;
};

/** Inserts a ledger row inside an existing transaction (used by invoices and partners too). */
/** Who writes a record: a signed-in member, or the system (webhook, job) with no user. */
export type Writer = { tenant: TenantContext["tenant"]; user: { id: string } | null };

export async function insertTransaction(tx: DbOrTx, ctx: Writer, input: NewTransaction): Promise<string> {
  if (input.amountMinor <= 0n) throw new UserError(t("form.amount"));
  await assertOpenDate(tx, ctx.tenant.id, input.date);
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.tenantId, ctx.tenant.id)));
  if (!account) throw new UserError(t("finance.accountMissing"));
  if (input.kind === "transfer") {
    if (!input.toAccountId || input.toAccountId === input.accountId)
      throw new UserError(t("finance.transferTarget"));
    const [to] = await tx
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, input.toAccountId), eq(accounts.tenantId, ctx.tenant.id)));
    if (!to) throw new UserError(t("finance.transferTarget"));
    if (to.currency !== account.currency) throw new UserError(t("finance.transferCurrency"));
  }
  if (input.categoryId) {
    const [cat] = await tx
      .select({ kind: categories.kind })
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.tenantId, ctx.tenant.id)));
    if (!cat || cat.kind !== input.kind) throw new UserError(t("finance.categoryKind"));
  }
  const base = ctx.tenant.settings.currency;
  const fxRate = account.currency === base ? "1" : (input.fxRate ?? "1");
  const baseAmountMinor = convert(input.amountMinor, fxRate);
  const [row] = await tx
    .insert(transactions)
    .values({
      tenantId: ctx.tenant.id,
      kind: input.kind,
      accountId: input.accountId,
      toAccountId: input.kind === "transfer" ? (input.toAccountId ?? null) : null,
      categoryId: input.kind === "income" || input.kind === "expense" ? (input.categoryId ?? null) : null,
      date: input.date,
      description: input.description,
      amountMinor: input.amountMinor,
      currency: account.currency,
      baseAmountMinor,
      fxRate,
      partnerId: input.partnerId ?? null,
      clientId: input.clientId ?? null,
      invoiceId: input.invoiceId ?? null,
      createdBy: ctx.user?.id ?? null,
    })
    .returning({ id: transactions.id });
  if (!row) throw new Error("Transaction insert failed");
  await audit(tx, {
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user?.id ?? null,
    action: `transaction.${input.kind}`,
    entityType: "transaction",
    entityId: row.id,
    data: input,
  });
  await markChanged(tx, ctx.tenant.id, "transaction", row.id);
  return row.id;
}

/** amount × rate (rate as a decimal string, up to 8 places), rounded half up. */
export function convert(amountMinor: bigint, rate: string): bigint {
  const [whole = "0", frac = ""] = rate.split(".");
  const scaled = BigInt(whole + frac.padEnd(8, "0").slice(0, 8));
  return (amountMinor * scaled + 50_000_000n) / 100_000_000n;
}

export async function createTransaction(
  database: Database,
  ctx: TenantContext,
  input: NewTransaction,
): Promise<string> {
  return database.transaction((tx) => insertTransaction(tx, ctx, input));
}

/**
 * Cancels a transaction by adding a reversal row dated `date` (normally today).
 * The original stays for the audit trail.
 */
export async function reverseTransactionTx(
  tx: DbOrTx,
  ctx: TenantContext,
  id: string,
  date: string,
  reason: string,
): Promise<string> {
  const [orig] = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.tenantId, ctx.tenant.id)));
  if (!orig) throw new UserError(t("finance.txMissing"));
  if (orig.reversesId || orig.reversedAt) throw new UserError(t("finance.alreadyReversed"));
  await assertOpenDate(tx, ctx.tenant.id, date);
  const [row] = await tx
    .insert(transactions)
    .values({
      ...orig,
      id: undefined,
      createdAt: undefined,
      date,
      description: `${t("finance.reversalOf")}: ${orig.description}${reason ? ` (${reason})` : ""}`,
      reversesId: orig.id,
      reversedAt: null,
      createdBy: ctx.user.id,
    })
    .returning({ id: transactions.id });
  if (!row) throw new Error("Reversal insert failed");
  await tx.update(transactions).set({ reversedAt: new Date() }).where(eq(transactions.id, orig.id));
  await audit(tx, {
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: "transaction.reverse",
    entityType: "transaction",
    entityId: orig.id,
    data: { reason, reversalId: row.id },
  });
  await markChanged(tx, ctx.tenant.id, "transaction", orig.id);
  await markChanged(tx, ctx.tenant.id, "transaction", row.id);
  return row.id;
}

export async function reverseTransaction(
  database: Database,
  ctx: TenantContext,
  id: string,
  date: string,
  reason: string,
): Promise<string> {
  return database.transaction((tx) => reverseTransactionTx(tx, ctx, id, date, reason));
}

export type TxFilter = {
  from?: string;
  to?: string;
  accountId?: string;
  kind?: TxKind;
  categoryId?: string;
  q?: string;
  partnerId?: string;
  limit?: number;
  offset?: number;
};

export async function listTransactions(database: DbOrTx, tenantId: string, f: TxFilter = {}) {
  const where = and(
    eq(transactions.tenantId, tenantId),
    f.from ? gte(transactions.date, f.from) : undefined,
    f.to ? lte(transactions.date, f.to) : undefined,
    f.accountId
      ? or(eq(transactions.accountId, f.accountId), eq(transactions.toAccountId, f.accountId))
      : undefined,
    f.kind ? eq(transactions.kind, f.kind) : undefined,
    f.categoryId ? eq(transactions.categoryId, f.categoryId) : undefined,
    f.partnerId ? eq(transactions.partnerId, f.partnerId) : undefined,
    f.q ? ilike(transactions.description, `%${f.q.replace(/[%_]/g, "")}%`) : undefined,
  );
  return database
    .select({
      tx: transactions,
      accountName: accounts.name,
      categoryName: categories.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(f.limit ?? 100)
    .offset(f.offset ?? 0);
}

/* ─── Reports ──────────────────────────────────────────────────── */

/** Income and expense totals (base currency) for a date range. Reversals net out. */
export async function profitAndLoss(database: DbOrTx, tenantId: string, from: string, to: string) {
  const rows = await database
    .select({
      kind: transactions.kind,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      total: sql<string>`coalesce(sum(${signed(transactions.baseAmountMinor)}), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        gte(transactions.date, from),
        lte(transactions.date, to),
        sql`${transactions.kind} in ('income','expense')`,
      ),
    )
    .groupBy(transactions.kind, transactions.categoryId, categories.name);
  const lines = rows.map((r) => ({
    kind: r.kind as "income" | "expense",
    categoryId: r.categoryId,
    categoryName: r.categoryName ?? t("finance.uncategorised"),
    totalMinor: BigInt(r.total),
  }));
  const incomeMinor = lines.filter((l) => l.kind === "income").reduce((a, l) => a + l.totalMinor, 0n);
  const expenseMinor = lines.filter((l) => l.kind === "expense").reduce((a, l) => a + l.totalMinor, 0n);
  return { incomeMinor, expenseMinor, profitMinor: incomeMinor - expenseMinor, lines };
}

/** Income and expense per month (base currency), oldest first. */
export async function monthlyTotals(database: DbOrTx, tenantId: string, from: string, to: string) {
  const month = sql<string>`to_char(${transactions.date}::date, 'YYYY-MM')`;
  const rows = await database
    .select({
      month,
      kind: transactions.kind,
      total: sql<string>`coalesce(sum(${signed(transactions.baseAmountMinor)}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        gte(transactions.date, from),
        lte(transactions.date, to),
        sql`${transactions.kind} in ('income','expense')`,
      ),
    )
    .groupBy(month, transactions.kind)
    .orderBy(month);
  const byMonth = new Map<string, { month: string; incomeMinor: bigint; expenseMinor: bigint }>();
  for (const r of rows) {
    const entry = byMonth.get(r.month) ?? { month: r.month, incomeMinor: 0n, expenseMinor: 0n };
    if (r.kind === "income") entry.incomeMinor += BigInt(r.total);
    else entry.expenseMinor += BigInt(r.total);
    byMonth.set(r.month, entry);
  }
  return [...byMonth.values()];
}

/** Sum of base-currency amounts of one kind in a range (e.g. capital_in for a partner). */
export async function totalOfKind(
  database: DbOrTx,
  tenantId: string,
  kind: TxKind,
  range: { from?: string; to?: string; partnerId?: string } = {},
): Promise<bigint> {
  const [row] = await database
    .select({ total: sql<string>`coalesce(sum(${signed(transactions.baseAmountMinor)}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        eq(transactions.kind, kind),
        range.from ? gte(transactions.date, range.from) : undefined,
        range.to ? lte(transactions.date, range.to) : undefined,
        range.partnerId ? eq(transactions.partnerId, range.partnerId) : undefined,
      ),
    );
  return BigInt(row?.total ?? "0");
}
