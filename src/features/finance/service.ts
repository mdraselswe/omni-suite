import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { t } from "@/i18n";
import { convertMinor } from "@/lib/fx";
import { paginate, type PageRequest } from "@/lib/pagination";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import {
  accounts,
  capitalContributions,
  categories,
  clients,
  files,
  invoicePayments,
  invoices,
  partners,
  periods,
  transactions,
} from "@/server/db/schema";
import { matchesSearch } from "@/server/search";
import type { TenantContext } from "@/server/tenancy/context";

export type TxKind = (typeof transactions.$inferSelect)["kind"];
export const TX_KINDS: readonly TxKind[] = ["income", "expense", "transfer", "capital_in", "drawing"];

/** +amount for a normal row, −amount for a reversal row (ledger stays append-only). */
const signed = (column: SQL | typeof transactions.amountMinor) =>
  sql`case when ${transactions.reversesId} is null then ${column} else -${column} end`;

/** Base amount without the tax inside it: what counts towards profit. */
const netBase = sql`(${transactions.baseAmountMinor} - ${transactions.baseTaxMinor})`;

/* ─── Accounts & categories ────────────────────────────────────── */

export async function listAccounts(database: DbOrTx, tenantId: string, includeArchived = false) {
  const inflow = sql<string>`coalesce(sum(case
      when ${transactions.kind} in ('income','capital_in') and ${transactions.accountId} = ${accounts.id} then ${signed(transactions.amountMinor)}
      when ${transactions.kind} = 'transfer' and ${transactions.toAccountId} = ${accounts.id} then ${signed(sql`coalesce(${transactions.toAmountMinor}, ${transactions.amountMinor})`)}
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

/** Base-currency units per 1 `foreign` unit today, or null when no rate is available. */
export type RateLookup = (foreign: string, base: string) => Promise<string | null>;

/**
 * Money held across all active accounts in the base currency. Accounts in other
 * currencies are converted at today's rate when `rate` gives one; otherwise they
 * are listed in `unconverted` and left out of the total (never counted 1:1).
 */
export async function cashPosition(database: DbOrTx, tenantId: string, base: string, rate: RateLookup) {
  const all = await listAccounts(database, tenantId);
  const byCurrency = new Map<string, bigint>();
  for (const a of all) byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0n) + a.balanceMinor);
  let totalMinor = byCurrency.get(base) ?? 0n;
  const converted: { currency: string; minor: bigint; baseMinor: bigint }[] = [];
  const unconverted: { currency: string; minor: bigint }[] = [];
  for (const [currency, minor] of byCurrency) {
    if (currency === base || minor === 0n) continue;
    const r = await rate(currency, base);
    if (r) {
      const baseMinor = convertMinor(minor, r, currency, base);
      totalMinor += baseMinor;
      converted.push({ currency, minor, baseMinor });
    } else {
      unconverted.push({ currency, minor });
    }
  }
  return { totalMinor, baseOnlyMinor: byCurrency.get(base) ?? 0n, converted, unconverted, accounts: all };
}

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
  await database.transaction(async (tx) => {
    const [row] = await tx
      .update(categories)
      .set({ archived })
      .where(and(eq(categories.id, id), eq(categories.tenantId, ctx.tenant.id)))
      .returning({ id: categories.id });
    if (!row) throw new UserError(t("finance.categoryMissing"));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: archived ? "category.archive" : "category.restore",
      entityType: "category",
      entityId: id,
      data: { archived },
    });
    await markChanged(tx, ctx.tenant.id, "category", id);
  });
}

export async function renameCategory(
  database: Database,
  ctx: TenantContext,
  id: string,
  name: string,
): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .update(categories)
      .set({ name })
      .where(and(eq(categories.id, id), eq(categories.tenantId, ctx.tenant.id)))
      .returning({ id: categories.id });
    if (!row) throw new UserError(t("finance.categoryMissing"));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "category.rename",
      entityType: "category",
      entityId: id,
      data: { name },
    });
    await markChanged(tx, ctx.tenant.id, "category", id);
  });
}

/** The currency of one of the tenant's accounts (null if it isn't theirs). */
export async function accountCurrency(
  database: DbOrTx,
  tenantId: string,
  id: string,
): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await database
    .select({ currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)));
  return row?.currency ?? null;
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
  if (await isClosedDate(database, tenantId, date)) throw new UserError(t("finance.periodClosed", { date }));
}

/** True when `date` falls inside a closed period. */
export async function isClosedDate(database: DbOrTx, tenantId: string, date: string): Promise<boolean> {
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
  return closed.length > 0;
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
  /** Tax inside `amountMinor` (account currency); income and expense only. */
  taxMinor?: bigint;
  /** Transfer to an account in another currency: the amount that arrived there. */
  toAmountMinor?: bigint;
};

/** Inserts a ledger row inside an existing transaction (used by invoices and partners too). */
/** Who writes a record: a signed-in member, or the system (webhook, job) with no user. */
export type Writer = { tenant: TenantContext["tenant"]; user: { id: string } | null };

export async function insertTransaction(tx: DbOrTx, ctx: Writer, input: NewTransaction): Promise<string> {
  if (input.amountMinor <= 0n) throw new UserError(t("form.amount"));
  let sameCurrencyTransfer = true;
  const taxMinor = input.taxMinor ?? 0n;
  if (taxMinor < 0n || taxMinor > input.amountMinor) throw new UserError(t("finance.taxTooBig"));
  if (taxMinor > 0n && input.kind !== "income" && input.kind !== "expense")
    throw new UserError(t("finance.taxTooBig"));
  // Capital and drawings belong to a partner: their account, profit share and statement depend on it.
  if ((input.kind === "capital_in" || input.kind === "drawing") && !input.partnerId)
    throw new UserError(t("finance.partnerRequired"));
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
    // Between currencies the bank converts: both sides are recorded as they happened.
    if (to.currency !== account.currency && !(input.toAmountMinor && input.toAmountMinor > 0n))
      throw new UserError(t("finance.transferCurrency"));
    sameCurrencyTransfer = to.currency === account.currency;
  }
  if (input.categoryId) {
    const [cat] = await tx
      .select({ kind: categories.kind })
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.tenantId, ctx.tenant.id)));
    if (!cat || cat.kind !== input.kind) throw new UserError(t("finance.categoryKind"));
  }
  if (input.partnerId) {
    const [p] = await tx
      .select({ id: partners.id })
      .from(partners)
      .where(and(eq(partners.id, input.partnerId), eq(partners.tenantId, ctx.tenant.id)));
    if (!p) throw new UserError(t("finance.partnerMissing"));
  }
  if (input.clientId) {
    const [c] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, input.clientId), eq(clients.tenantId, ctx.tenant.id)));
    if (!c) throw new UserError(t("finance.clientMissing"));
  }
  const base = ctx.tenant.settings.currency;
  // A foreign-currency amount needs its own rate; counting it 1:1 would skew reports and profit shares.
  if (account.currency !== base && !(input.fxRate && Number(input.fxRate) > 0)) {
    throw new UserError(t("finance.fxRequired"));
  }
  const fxRate = account.currency === base ? "1" : (input.fxRate ?? "1");
  // Scales between currencies with different decimals too (JPY 0, AUD 2, KWD 3).
  const baseAmountMinor = convertMinor(input.amountMinor, fxRate, account.currency, base);
  const baseTaxMinor = taxMinor > 0n ? convertMinor(taxMinor, fxRate, account.currency, base) : 0n;
  const [row] = await tx
    .insert(transactions)
    .values({
      tenantId: ctx.tenant.id,
      kind: input.kind,
      accountId: input.accountId,
      toAccountId: input.kind === "transfer" ? (input.toAccountId ?? null) : null,
      toAmountMinor:
        input.kind === "transfer" && !sameCurrencyTransfer ? (input.toAmountMinor ?? null) : null,
      categoryId: input.kind === "income" || input.kind === "expense" ? (input.categoryId ?? null) : null,
      date: input.date,
      description: input.description,
      amountMinor: input.amountMinor,
      currency: account.currency,
      baseAmountMinor,
      taxMinor,
      baseTaxMinor,
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

/**
 * Records a ledger row typed in by a member. Capital paid in also gets a capital
 * contribution, so the partner's capital, statement and profit share see it.
 */
export async function createTransaction(
  database: Database,
  ctx: TenantContext,
  input: NewTransaction,
): Promise<string> {
  return database.transaction(async (tx) => {
    const id = await insertTransaction(tx, ctx, input);
    if (input.kind === "capital_in" && input.partnerId) {
      const [row] = await tx
        .select({ baseAmountMinor: transactions.baseAmountMinor })
        .from(transactions)
        .where(eq(transactions.id, id));
      const [contribution] = await tx
        .insert(capitalContributions)
        .values({
          tenantId: ctx.tenant.id,
          partnerId: input.partnerId,
          date: input.date,
          kind: "cash",
          amountMinor: row?.baseAmountMinor ?? input.amountMinor,
          description: input.description,
          transactionId: id,
          createdBy: ctx.user.id,
        })
        .returning({ id: capitalContributions.id });
      if (contribution) await markChanged(tx, ctx.tenant.id, "capital", contribution.id);
    }
    return id;
  });
}

/**
 * Cancels a transaction by adding a reversal row dated `date` (normally today).
 * The original stays for the audit trail.
 */
export async function reverseTransactionTx(
  tx: DbOrTx,
  ctx: Writer,
  id: string,
  date: string,
  reason: string,
): Promise<string> {
  const [orig] = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.tenantId, ctx.tenant.id)))
    // Two people reversing at once must not negate the row twice.
    .for("update");
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
      createdBy: ctx.user?.id ?? null,
    })
    .returning({ id: transactions.id });
  if (!row) throw new Error("Reversal insert failed");
  await tx.update(transactions).set({ reversedAt: new Date() }).where(eq(transactions.id, orig.id));
  await undoLinkedRecords(tx, ctx, orig, row.id, date);
  await audit(tx, {
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user?.id ?? null,
    action: "transaction.reverse",
    entityType: "transaction",
    entityId: orig.id,
    data: { reason, reversalId: row.id },
  });
  await markChanged(tx, ctx.tenant.id, "transaction", orig.id);
  await markChanged(tx, ctx.tenant.id, "transaction", row.id);
  return row.id;
}

/**
 * Keeps the records a ledger row came from in step with its reversal: an invoice
 * payment stops counting as paid, and a capital contribution gets an opposite entry.
 */
async function undoLinkedRecords(
  tx: DbOrTx,
  ctx: Writer,
  orig: typeof transactions.$inferSelect,
  reversalId: string,
  date: string,
): Promise<void> {
  if (orig.invoiceId) {
    const [payment] = await tx
      .select()
      .from(invoicePayments)
      .where(
        and(
          eq(invoicePayments.tenantId, ctx.tenant.id),
          eq(invoicePayments.transactionId, orig.id),
          isNull(invoicePayments.reversedAt),
        ),
      );
    const [inv] = payment
      ? await tx
          .select()
          .from(invoices)
          .where(and(eq(invoices.id, payment.invoiceId), eq(invoices.tenantId, ctx.tenant.id)))
          .for("update")
      : [];
    if (payment && inv) {
      await tx
        .update(invoicePayments)
        .set({ reversedAt: new Date() })
        .where(eq(invoicePayments.id, payment.id));
      const paid = inv.paidMinor > payment.amountMinor ? inv.paidMinor - payment.amountMinor : 0n;
      const status =
        inv.status === "void"
          ? "void"
          : paid <= 0n
            ? "sent"
            : paid >= inv.totalMinor
              ? "paid"
              : "partially_paid";
      await tx.update(invoices).set({ paidMinor: paid, status }).where(eq(invoices.id, inv.id));
      await audit(tx, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user?.id ?? null,
        action: "invoice.payment.reverse",
        entityType: "invoice",
        entityId: inv.id,
        data: { amount: payment.amountMinor, transactionId: orig.id },
      });
      await markChanged(tx, ctx.tenant.id, "invoice", inv.id);
    }
  }
  if (orig.kind === "capital_in") {
    const contributions = await tx
      .select()
      .from(capitalContributions)
      .where(
        and(
          eq(capitalContributions.tenantId, ctx.tenant.id),
          eq(capitalContributions.transactionId, orig.id),
        ),
      );
    // Units bought with this money stay issued; undoing that is an ownership adjustment, not a reversal.
    if (contributions.some((c) => c.ownershipEventId)) throw new UserError(t("finance.capitalHasUnits"));
    for (const c of contributions) {
      await tx.insert(capitalContributions).values({
        tenantId: ctx.tenant.id,
        partnerId: c.partnerId,
        date,
        kind: c.kind,
        amountMinor: -c.amountMinor,
        description: `${t("finance.reversalOf")}: ${c.description}`,
        transactionId: reversalId,
        createdBy: ctx.user?.id ?? null,
      });
      await markChanged(tx, ctx.tenant.id, "capital", c.id);
    }
  }
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
  /** Words to find in the description or category name. */
  q?: string;
  partnerId?: string;
};

/** One page of the ledger (newest first) and the number of entries that match. */
export async function pageTransactions(database: DbOrTx, tenantId: string, f: TxFilter, page: PageRequest) {
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
    matchesSearch(f.q, [transactions.description, categories.name]),
  );
  return paginate(
    page,
    async () => {
      const [row] = await database
        .select({ n: count() })
        .from(transactions)
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .where(where);
      return row?.n ?? 0;
    },
    (limit, offset) =>
      database
        .select({
          tx: transactions,
          accountName: accounts.name,
          categoryName: categories.name,
        })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .where(where)
        .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
        .limit(limit)
        .offset(offset),
  );
}

/* ─── Reports ──────────────────────────────────────────────────── */

/**
 * Average monthly spend over the months that have entries (a business two months
 * old divides by two, not three) and how many months `cashMinor` lasts at that rate.
 */
export function runway(cashMinor: bigint, months: readonly { expenseMinor: bigint }[]) {
  const counted = months.length;
  if (counted === 0) return { avgSpendMinor: 0n, months: 0, runway: null };
  const total = months.reduce((a, m) => a + m.expenseMinor, 0n);
  const avgSpendMinor = (total + BigInt(counted) / 2n) / BigInt(counted);
  return {
    avgSpendMinor,
    months: counted,
    runway: avgSpendMinor > 0n ? Number((cashMinor * 10n) / avgSpendMinor) / 10 : null,
  };
}

/** Income and expense totals (base currency, without GST) for a date range. Reversals net out. */
export async function profitAndLoss(database: DbOrTx, tenantId: string, from: string, to: string) {
  const rows = await database
    .select({
      kind: transactions.kind,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      total: sql<string>`coalesce(sum(${signed(netBase)}), 0)`,
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

/** Income and expense per month (base currency, without GST), oldest first. */
export async function monthlyTotals(database: DbOrTx, tenantId: string, from: string, to: string) {
  const month = sql<string>`to_char(${transactions.date}::date, 'YYYY-MM')`;
  const rows = await database
    .select({
      month,
      kind: transactions.kind,
      total: sql<string>`coalesce(sum(${signed(netBase)}), 0)`,
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

/**
 * Receipts attached to ledger rows, by transaction id. `uploaderId` limits them to
 * one person's uploads (members whose file access is "own" or "assigned").
 */
export async function receiptsFor(
  database: DbOrTx,
  tenantId: string,
  transactionIds: readonly string[],
  uploaderId?: string,
): Promise<Map<string, { id: string; name: string }[]>> {
  const out = new Map<string, { id: string; name: string }[]>();
  if (transactionIds.length === 0) return out;
  const rows = await database
    .select({ id: files.id, name: files.name, entityId: files.entityId })
    .from(files)
    .where(
      and(
        eq(files.tenantId, tenantId),
        eq(files.entityType, "transaction"),
        inArray(files.entityId, [...transactionIds]),
        uploaderId ? eq(files.uploadedBy, uploaderId) : undefined,
      ),
    )
    .orderBy(asc(files.createdAt));
  for (const row of rows) {
    if (!row.entityId) continue;
    const list = out.get(row.entityId) ?? [];
    list.push({ id: row.id, name: row.name });
    out.set(row.entityId, list);
  }
  return out;
}
