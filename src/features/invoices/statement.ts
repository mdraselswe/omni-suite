import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import { addDays, daysBetween } from "@/lib/dates";
import type { DbOrTx } from "@/server/db";
import { clients, invoiceAdjustments, invoicePayments, invoices } from "@/server/db/schema";

/** How late an unpaid balance is, in the usual 30-day steps. */
export const AGE_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];
export type AgeAmounts = Record<AgeBucket, bigint>;

/** The bucket for a balance due on `dueDate`, seen on `today`. */
export function ageBucket(dueDate: string, today: string): AgeBucket {
  const late = daysBetween(dueDate, today);
  if (late <= 0) return "current";
  if (late <= 30) return "d1_30";
  if (late <= 60) return "d31_60";
  if (late <= 90) return "d61_90";
  return "d90";
}

export type AgedRow = {
  clientId: string;
  clientName: string;
  currency: string;
  buckets: AgeAmounts;
  totalMinor: bigint;
};

/**
 * What each client owes on sent invoices, by how late it is. One row per client
 * and currency (amounts in different currencies are never added together).
 * The bucket edges match `ageBucket`: due today is current, 30 days late is 1–30.
 */
export async function agedReceivables(database: DbOrTx, tenantId: string, today: string): Promise<AgedRow[]> {
  const owed = sql`(${invoices.totalMinor} - ${invoices.paidMinor} - ${invoices.writtenOffMinor} - ${invoices.creditedMinor})`;
  /** Sum of what's owed on invoices due on or after `from` and before `to`. */
  const dueIn = (from: string | null, to: string | null) => {
    const after = from === null ? sql`true` : sql`${invoices.dueDate} >= ${from}`;
    const before = to === null ? sql`true` : sql`${invoices.dueDate} < ${to}`;
    return sql<string>`coalesce(sum(case when ${after} and ${before} then ${owed} else 0 end), 0)`;
  };
  const rows = await database
    .select({
      clientId: invoices.clientId,
      clientName: clients.name,
      currency: invoices.currency,
      current: dueIn(today, null),
      d1_30: dueIn(addDays(today, -30), today),
      d31_60: dueIn(addDays(today, -60), addDays(today, -30)),
      d61_90: dueIn(addDays(today, -90), addDays(today, -60)),
      d90: dueIn(null, addDays(today, -90)),
      total: sql<string>`coalesce(sum(${owed}), 0)`,
    })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.status, ["sent", "partially_paid"])))
    .groupBy(invoices.clientId, clients.name, invoices.currency)
    .having(sql`sum(${owed}) > 0`)
    .orderBy(desc(sql`sum(${owed})`), asc(clients.name));
  return rows.map((r) => ({
    clientId: r.clientId,
    clientName: r.clientName,
    currency: r.currency,
    buckets: {
      current: BigInt(r.current),
      d1_30: BigInt(r.d1_30),
      d31_60: BigInt(r.d31_60),
      d61_90: BigInt(r.d61_90),
      d90: BigInt(r.d90),
    },
    totalMinor: BigInt(r.total),
  }));
}

/** Aged rows added up by currency (the totals line under each table). */
export function agedTotals(rows: readonly AgedRow[]): Map<string, AgeAmounts & { totalMinor: bigint }> {
  const out = new Map<string, AgeAmounts & { totalMinor: bigint }>();
  for (const row of rows) {
    const sum = out.get(row.currency) ?? {
      current: 0n,
      d1_30: 0n,
      d31_60: 0n,
      d61_90: 0n,
      d90: 0n,
      totalMinor: 0n,
    };
    for (const bucket of AGE_BUCKETS) sum[bucket] += row.buckets[bucket];
    sum.totalMinor += row.totalMinor;
    out.set(row.currency, sum);
  }
  return out;
}

export type StatementEntry = {
  date: string;
  kind: "invoice" | "payment" | "refund" | "creditNote" | "writeOff";
  invoiceId: string;
  /** The invoice's number. */
  number: string;
  /** A credit note's own number (credit notes and their refunds). */
  reference: string | null;
  /** Positive raises what the client owes; payments, credits and write-offs are negative. */
  amountMinor: bigint;
  balanceMinor: bigint;
};

export type Statement = {
  currency: string;
  openingMinor: bigint;
  invoicedMinor: bigint;
  /** Received, less anything refunded. */
  paidMinor: bigint;
  /** Credit notes and write-offs: no longer owed, without money coming in. */
  creditedMinor: bigint;
  closingMinor: bigint;
  entries: StatementEntry[];
};

const KIND_ORDER = { invoice: 0, creditNote: 1, refund: 2, payment: 3, writeOff: 4 } as const;

/**
 * A client's account for a date range, one statement per currency: what they
 * owed at the start, each invoice, payment, credit note, refund and write-off in
 * the range (each on its own day) with the running balance, and what they owe at
 * the end. Drafts and void invoices never count; a reversed payment and a voided
 * credit note count as never made.
 */
export async function clientStatement(
  database: DbOrTx,
  tenantId: string,
  clientId: string,
  range: { from: string; to: string },
  baseCurrency?: string,
): Promise<Statement[]> {
  const live = and(
    eq(invoices.tenantId, tenantId),
    eq(invoices.clientId, clientId),
    notInArray(invoices.status, ["draft", "void"]),
  );
  const [issued, paid, adjusted] = await Promise.all([
    database
      .select({
        id: invoices.id,
        number: invoices.number,
        currency: invoices.currency,
        issueDate: invoices.issueDate,
        totalMinor: invoices.totalMinor,
      })
      .from(invoices)
      .where(and(live, lte(invoices.issueDate, range.to))),
    database
      .select({
        id: invoicePayments.id,
        invoiceId: invoices.id,
        number: invoices.number,
        currency: invoices.currency,
        date: invoicePayments.date,
        amountMinor: invoicePayments.amountMinor,
      })
      .from(invoicePayments)
      .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
      .where(
        and(
          live,
          eq(invoicePayments.tenantId, tenantId),
          isNull(invoicePayments.reversedAt),
          lte(invoicePayments.date, range.to),
        ),
      ),
    database
      .select({
        invoiceId: invoices.id,
        number: invoices.number,
        currency: invoices.currency,
        kind: invoiceAdjustments.kind,
        reference: invoiceAdjustments.number,
        date: invoiceAdjustments.date,
        amountMinor: invoiceAdjustments.amountMinor,
        refundPaymentId: invoiceAdjustments.refundPaymentId,
      })
      .from(invoiceAdjustments)
      .innerJoin(invoices, eq(invoices.id, invoiceAdjustments.invoiceId))
      .where(
        and(
          live,
          eq(invoiceAdjustments.tenantId, tenantId),
          isNull(invoiceAdjustments.voidedAt),
          lte(invoiceAdjustments.date, range.to),
        ),
      ),
  ]);

  type Row = Omit<StatementEntry, "balanceMinor"> & { currency: string };
  const all: Row[] = [];
  const refundOf = new Map(
    adjusted.filter((a) => a.refundPaymentId).map((a) => [a.refundPaymentId, a.reference] as const),
  );
  for (const inv of issued) {
    all.push({
      date: inv.issueDate,
      kind: "invoice",
      invoiceId: inv.id,
      number: inv.number,
      reference: null,
      amountMinor: inv.totalMinor,
      currency: inv.currency,
    });
  }
  for (const a of adjusted) {
    all.push({
      date: a.date,
      kind: a.kind === "credit_note" ? "creditNote" : "writeOff",
      invoiceId: a.invoiceId,
      number: a.number,
      reference: a.reference,
      amountMinor: -a.amountMinor,
      currency: a.currency,
    });
  }
  for (const p of paid) {
    // A refund is a negative payment: it raises the balance back by what was paid out.
    all.push({
      date: p.date,
      kind: p.amountMinor < 0n ? "refund" : "payment",
      invoiceId: p.invoiceId,
      number: p.number,
      reference: refundOf.get(p.id) ?? null,
      amountMinor: -p.amountMinor,
      currency: p.currency,
    });
  }
  all.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  const byCurrency = new Map<string, Statement>();
  for (const { currency, ...entry } of all) {
    const st = byCurrency.get(currency) ?? {
      currency,
      openingMinor: 0n,
      invoicedMinor: 0n,
      paidMinor: 0n,
      creditedMinor: 0n,
      closingMinor: 0n,
      entries: [],
    };
    byCurrency.set(currency, st);
    st.closingMinor += entry.amountMinor;
    if (entry.date < range.from) {
      st.openingMinor += entry.amountMinor;
      continue;
    }
    if (entry.kind === "invoice") st.invoicedMinor += entry.amountMinor;
    if (entry.kind === "payment" || entry.kind === "refund") st.paidMinor -= entry.amountMinor;
    if (entry.kind === "creditNote" || entry.kind === "writeOff") st.creditedMinor -= entry.amountMinor;
    st.entries.push({ ...entry, balanceMinor: st.closingMinor });
  }
  return [...byCurrency.values()]
    .filter((s) => s.entries.length > 0 || s.openingMinor !== 0n)
    .sort((a, b) =>
      a.currency === baseCurrency
        ? -1
        : b.currency === baseCurrency
          ? 1
          : a.currency.localeCompare(b.currency),
    );
}
