// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@/features/clients";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

/**
 * The money rules the reports depend on: GST is never profit, part payments
 * carry their share of GST, foreign invoices need a rate, write-offs settle an
 * invoice, capital always belongs to a partner, and closed periods stay closed.
 */
let database: Database;
let ctx: TenantContext;
let bank: string;
let usd: string;
let clientId: string;

const gstItem = (dollars: number) => ({
  description: "Work",
  quantity: "1",
  unitPriceMinor: String(dollars * 100),
  taxRateBp: 1000,
});

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  const { createAccount } = await import("./service");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "rules"));
  bank = await createAccount(database, ctx, {
    name: "Bank",
    type: "bank",
    currency: "AUD",
    openingBalanceMinor: 0n,
  });
  usd = await createAccount(database, ctx, {
    name: "USD",
    type: "bank",
    currency: "USD",
    openingBalanceMinor: 0n,
  });
  clientId = await createClient(database, ctx, {
    name: "Acme",
    email: "",
    phone: "",
    website: "",
    address: "",
    notes: "",
    status: "active",
    custom: {},
  });
});

async function sentInvoice(dollars: number, issueDate: string, currency?: string) {
  const { createInvoice, sendInvoice } = await import("@/features/invoices");
  const id = await createInvoice(database, ctx, {
    clientId,
    issueDate,
    dueDate: issueDate,
    items: [gstItem(dollars)],
    notes: "",
    custom: {},
    currency,
  });
  await sendInvoice(database, ctx, id);
  return id;
}

describe("GST in the ledger", () => {
  it("splits GST across part payments exactly and keeps it out of profit", async () => {
    const { recordPayment } = await import("@/features/invoices");
    const { profitAndLoss, monthlyTotals } = await import("./service");
    const { gstSummary } = await import("@/features/invoices");
    // $1,000 + 10% GST = $1,100; paid in three uneven parts.
    const id = await sentInvoice(1000, "2026-01-05");
    for (const [amount, date] of [
      [33_333n, "2026-01-10"],
      [33_333n, "2026-01-11"],
      [43_334n, "2026-01-12"],
    ] as const) {
      await recordPayment(database, ctx, id, {
        amountMinor: amount,
        date,
        accountId: bank,
        method: "",
        categoryId: null,
      });
    }
    const pnl = await profitAndLoss(database, ctx.tenant.id, "2026-01-01", "2026-01-31");
    // Income is the $1,000 earned, not the $1,100 received.
    expect(pnl.incomeMinor).toBe(100_000n);
    const [month] = await monthlyTotals(database, ctx.tenant.id, "2026-01-01", "2026-01-31");
    expect(month?.incomeMinor).toBe(100_000n);
    const bas = await gstSummary(database, ctx.tenant.id, "2026-01-01", "2026-01-31");
    expect(bas.salesMinor).toBe(110_000n);
    expect(bas.salesTaxMinor).toBe(10_000n);
    expect(bas.accrualTaxMinor).toBe(10_000n);
  });

  it("claims GST on expenses (1B) and nets it against sales (1A)", async () => {
    const { createTransaction, profitAndLoss } = await import("./service");
    const { gstSummary } = await import("@/features/invoices");
    await createTransaction(database, ctx, {
      kind: "expense",
      accountId: bank,
      date: "2026-01-20",
      description: "Laptop",
      amountMinor: 22_000n,
      taxMinor: 2_000n,
    });
    await expect(
      createTransaction(database, ctx, {
        kind: "expense",
        accountId: bank,
        date: "2026-01-20",
        description: "Too much tax",
        amountMinor: 1_000n,
        taxMinor: 2_000n,
      }),
    ).rejects.toThrow();
    const pnl = await profitAndLoss(database, ctx.tenant.id, "2026-01-01", "2026-01-31");
    expect(pnl.expenseMinor).toBe(20_000n);
    const bas = await gstSummary(database, ctx.tenant.id, "2026-01-01", "2026-01-31");
    expect(bas.purchaseTaxMinor).toBe(2_000n);
    expect(bas.netTaxMinor).toBe(8_000n);
  });

  it("nets the GST back out when a payment is reversed", async () => {
    const { recordPayment, getInvoice, gstSummary } = await import("@/features/invoices");
    const { reverseTransaction } = await import("./service");
    const id = await sentInvoice(100, "2026-02-01");
    await recordPayment(database, ctx, id, {
      amountMinor: 11_000n,
      date: "2026-02-02",
      accountId: bank,
      method: "",
      categoryId: null,
    });
    const paid = await getInvoice(database, ctx.tenant.id, id);
    const txId = paid?.payments[0]?.transactionId ?? "";
    await reverseTransaction(database, ctx, txId, "2026-02-03", "bounced");
    const bas = await gstSummary(database, ctx.tenant.id, "2026-02-01", "2026-02-28");
    expect(bas.salesTaxMinor).toBe(0n);
    expect(bas.salesMinor).toBe(0n);
    const after = await getInvoice(database, ctx.tenant.id, id);
    expect(after?.invoice).toMatchObject({ paidMinor: 0n, status: "sent" });
  });
});

describe("invoices", () => {
  it("refuses invoices with a zero or negative total", async () => {
    const { createInvoice } = await import("@/features/invoices");
    await expect(
      createInvoice(database, ctx, {
        clientId,
        issueDate: "2026-03-01",
        dueDate: "2026-03-01",
        items: [{ ...gstItem(10), unitPriceMinor: "-1000" }],
        notes: "",
        custom: {},
      }),
    ).rejects.toThrow();
  });

  it("writes off a short payment and settles the invoice", async () => {
    const { recordPayment, writeOffBalance, getInvoice, invoiceBalance, receivables } =
      await import("@/features/invoices");
    const id = await sentInvoice(100, "2026-03-02");
    await recordPayment(database, ctx, id, {
      amountMinor: 10_900n,
      date: "2026-03-03",
      accountId: bank,
      method: "",
      categoryId: null,
    });
    const before = await receivables(database, ctx.tenant.id, "2026-03-04", "AUD");
    expect(await writeOffBalance(database, ctx, id, "bank fee")).toBe(100n);
    const row = await getInvoice(database, ctx.tenant.id, id);
    expect(row?.invoice).toMatchObject({ status: "paid", writtenOffMinor: 100n });
    if (row) expect(invoiceBalance(row.invoice)).toBe(0n);
    const after = await receivables(database, ctx.tenant.id, "2026-03-04", "AUD");
    expect(before.totalMinor - after.totalMinor).toBe(100n);
    await expect(writeOffBalance(database, ctx, id, "")).rejects.toThrow();
  });

  it("pays a USD invoice into a USD account with a rate, and keeps USD out of AUD totals", async () => {
    const { recordPayment, receivables, getInvoice } = await import("@/features/invoices");
    const { profitAndLoss } = await import("./service");
    const id = await sentInvoice(200, "2026-04-01", "USD");
    const owed = await receivables(database, ctx.tenant.id, "2026-04-02", "AUD");
    // Due on the issue date, so already overdue the next day.
    expect(owed.foreign).toContainEqual({ currency: "USD", totalMinor: 22_000n, overdueMinor: 22_000n });
    // No rate: refused (counting USD 1:1 as AUD would be wrong).
    await expect(
      recordPayment(database, ctx, id, {
        amountMinor: 22_000n,
        date: "2026-04-02",
        accountId: usd,
        method: "",
        categoryId: null,
      }),
    ).rejects.toThrow();
    // Wrong currency account: refused.
    await expect(
      recordPayment(database, ctx, id, {
        amountMinor: 22_000n,
        date: "2026-04-02",
        accountId: bank,
        method: "",
        categoryId: null,
        fxRate: "1.5",
      }),
    ).rejects.toThrow();
    await recordPayment(database, ctx, id, {
      amountMinor: 22_000n,
      date: "2026-04-02",
      accountId: usd,
      method: "",
      categoryId: null,
      fxRate: "1.5",
    });
    expect((await getInvoice(database, ctx.tenant.id, id))?.invoice.status).toBe("paid");
    // US$200 earned at 1.5 = A$300 income; the GST part stays out.
    const pnl = await profitAndLoss(database, ctx.tenant.id, "2026-04-01", "2026-04-30");
    expect(pnl.incomeMinor).toBe(30_000n);
  });

  it("counts MRR without GST and rounds once", async () => {
    const { createRecurring, monthlyRecurring } = await import("@/features/invoices");
    const fresh = await (await import("@/server/testing/db")).setupTenant(database, "mrr");
    const c = await createClient(database, fresh.ctx, {
      name: "Retainer",
      email: "",
      phone: "",
      website: "",
      address: "",
      notes: "",
      status: "active",
      custom: {},
    });
    for (const intervalMonths of [3, 3, 3]) {
      await createRecurring(database, fresh.ctx, {
        clientId: c,
        name: "Quarterly",
        intervalMonths,
        nextRunDate: "2026-12-01",
        items: [gstItem(100)],
        autoSend: false,
      });
    }
    // 3 × $100 a quarter = $100 a month (not 3 × $33.33, and not $110 with GST).
    expect(await monthlyRecurring(database, fresh.ctx)).toBe(10_000n);
  });

  it("keeps month-end schedules on the last day and resumes without a burst", async () => {
    const { nextRunFrom } = await import("@/features/invoices");
    const { addMonthsAnchored } = await import("@/lib/dates");
    expect(addMonthsAnchored("2026-01-31", 1, 31)).toBe("2026-02-28");
    expect(addMonthsAnchored("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(nextRunFrom("2026-01-31", 1, 31, "2026-05-10")).toBe("2026-05-31");
    expect(nextRunFrom("2026-06-15", 1, 15, "2026-05-10")).toBe("2026-06-15");
  });
});

describe("partners' money", () => {
  it("needs a partner for capital and drawings, and records capital for them", async () => {
    const { createTransaction } = await import("./service");
    const { createPartner, capitalHistory } = await import("@/features/partners");
    await expect(
      createTransaction(database, ctx, {
        kind: "capital_in",
        accountId: bank,
        date: "2026-05-01",
        description: "Money in",
        amountMinor: 50_000n,
      }),
    ).rejects.toThrow();
    const partnerId = await createPartner(database, ctx, {
      name: "Sam",
      email: "",
      joinedOn: "2026-01-01",
      membershipId: null,
    });
    await createTransaction(database, ctx, {
      kind: "capital_in",
      accountId: bank,
      date: "2026-05-01",
      description: "Money in",
      amountMinor: 50_000n,
      partnerId,
    });
    const capital = await capitalHistory(database, ctx.tenant.id, partnerId);
    expect(capital.map((c) => c.c.amountMinor)).toEqual([50_000n]);
  });

  it("closed periods block invoices, capital and voids dated inside them", async () => {
    const { closePeriod } = await import("./service");
    const { createInvoice } = await import("@/features/invoices");
    await closePeriod(database, ctx, { startDate: "2025-07-01", endDate: "2025-12-31" });
    await expect(
      createInvoice(database, ctx, {
        clientId,
        issueDate: "2025-10-01",
        dueDate: "2025-10-15",
        items: [gstItem(10)],
        notes: "",
        custom: {},
      }),
    ).rejects.toThrow(/closed/);
  });
});

describe("cash and runway", () => {
  it("adds foreign accounts at today's rate, or lists them when there's no rate", async () => {
    const { cashPosition } = await import("./service");
    const withRate = await cashPosition(database, ctx.tenant.id, "AUD", async () => "1.5");
    const noRate = await cashPosition(database, ctx.tenant.id, "AUD", async () => null);
    expect(noRate.unconverted).toEqual([{ currency: "USD", minor: 22_000n }]);
    expect(withRate.totalMinor - noRate.totalMinor).toBe(33_000n);
  });

  it("averages spend over the months that have entries", async () => {
    const { runway } = await import("./service");
    expect(runway(60_000n, [{ expenseMinor: 20_000n }])).toMatchObject({ avgSpendMinor: 20_000n, runway: 3 });
    expect(runway(60_000n, [])).toMatchObject({ runway: null, months: 0 });
  });
});

describe("after the cash checks", () => {
  it("moves money between currencies with both sides as the bank did them", async () => {
    const { createTransaction, listAccounts } = await import("./service");
    const before = await listAccounts(database, ctx.tenant.id);
    const transfer = {
      kind: "transfer" as const,
      accountId: bank,
      toAccountId: usd,
      date: "2026-06-01",
      description: "Top up USD",
      amountMinor: 15_000n,
    };
    await expect(createTransaction(database, ctx, transfer)).rejects.toThrow();
    await createTransaction(database, ctx, { ...transfer, toAmountMinor: 9_800n });
    const after = await listAccounts(database, ctx.tenant.id);
    const change = (id: string) =>
      (after.find((a) => a.id === id)?.balanceMinor ?? 0n) -
      (before.find((a) => a.id === id)?.balanceMinor ?? 0n);
    expect(change(bank)).toBe(-15_000n);
    expect(change(usd)).toBe(9_800n);
  });

  it("won't reverse money that bought ownership units", async () => {
    const partners = await import("@/features/partners");
    const { reverseTransaction } = await import("./service");
    const ana = await partners.createPartner(database, ctx, {
      name: "Ana",
      email: "",
      joinedOn: "2026-01-01",
      membershipId: null,
    });
    const ben = await partners.createPartner(database, ctx, {
      name: "Ben",
      email: "",
      joinedOn: "2026-01-01",
      membershipId: null,
    });
    await partners.setInitialOwnership(database, ctx, {
      date: "2026-01-01",
      shares: [{ partnerId: ana, basisPoints: 10000 }],
      note: "",
    });
    await partners.recordInvestment(database, ctx, {
      partnerId: ben,
      date: "2026-06-10",
      preMoneyMinor: 1_000_000n,
      investmentMinor: 100_000n,
      accountId: bank,
      note: "",
    });
    const [capital] = await partners.capitalHistory(database, ctx.tenant.id, ben);
    expect(capital?.c.ownershipEventId).toBeTruthy();
    await expect(
      reverseTransaction(database, ctx, capital?.c.transactionId ?? "", "2026-06-11", "oops"),
    ).rejects.toThrow(/ownership/);
  });
});

describe("receipts on ledger rows", () => {
  it("lists a row's receipts, and only one person's when asked", async () => {
    const { createTransaction, receiptsFor } = await import("./service");
    const { files } = await import("@/server/db/schema");
    const tx = await createTransaction(database, ctx, {
      kind: "expense",
      accountId: bank,
      date: "2026-09-10",
      amountMinor: 11_000n,
      taxMinor: 1_000n,
      description: "Printer ink",
    });
    await database.insert(files).values([
      {
        tenantId: ctx.tenant.id,
        entityType: "transaction",
        entityId: tx,
        name: "ink.pdf",
        mime: "application/pdf",
        size: 10,
        storageKey: "k1",
        uploadedBy: ctx.user.id,
      },
      {
        tenantId: ctx.tenant.id,
        entityType: "transaction",
        entityId: tx,
        name: "ink-2.pdf",
        mime: "application/pdf",
        size: 10,
        storageKey: "k2",
        uploadedBy: null,
      },
    ]);
    expect((await receiptsFor(database, ctx.tenant.id, [tx])).get(tx)?.map((r) => r.name)).toEqual([
      "ink.pdf",
      "ink-2.pdf",
    ]);
    expect((await receiptsFor(database, ctx.tenant.id, [tx], ctx.user.id)).get(tx)).toHaveLength(1);
    expect((await receiptsFor(database, ctx.tenant.id, [])).size).toBe(0);
  });
});
