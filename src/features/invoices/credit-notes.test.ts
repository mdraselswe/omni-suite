// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@/features/clients";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

let database: Database;
let ctx: TenantContext;
let bank: string;
let today: string;

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  const { createAccount } = await import("@/features/finance");
  const dates = await import("@/lib/dates");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "cred"));
  today = dates.today(ctx.tenant.settings.timezone);
  bank = await createAccount(database, ctx, {
    name: "Bank",
    type: "bank",
    currency: ctx.tenant.settings.currency,
    openingBalanceMinor: 0n,
  });
});

const newClient = (name: string) =>
  createClient(database, ctx, {
    name,
    email: "",
    phone: "",
    website: "",
    address: "",
    notes: "",
    status: "active",
    custom: {},
  });

/** A sent invoice of 1,100.00: 1,000.00 + 10% GST (100.00). */
async function taxedInvoice(name: string) {
  const { createInvoice, sendInvoice } = await import("./service");
  const id = await createInvoice(database, ctx, {
    clientId: await newClient(name),
    issueDate: "2026-07-01",
    dueDate: "2026-07-15",
    items: [{ description: "Website", quantity: "1", unitPriceMinor: "100000", taxRateBp: 1000 }],
    notes: "",
    custom: {},
  });
  await sendInvoice(database, ctx, id);
  return id;
}

const pay = async (id: string, amountMinor: bigint, date = "2026-07-10") => {
  const { recordPayment } = await import("./service");
  await recordPayment(database, ctx, id, {
    amountMinor,
    date,
    accountId: bank,
    method: "",
    categoryId: null,
  });
};

const invoice = async (id: string) => {
  const { getInvoice } = await import("./service");
  const row = await getInvoice(database, ctx.tenant.id, id);
  if (!row) throw new Error("missing invoice");
  return row.invoice;
};

const bankBalance = async () => {
  const { listAccounts } = await import("@/features/finance");
  return (await listAccounts(database, ctx.tenant.id)).find((a) => a.id === bank)?.balanceMinor;
};

describe("credit notes", () => {
  it("takes an unpaid amount off what is owed, numbered, with no ledger entry", async () => {
    const { issueCreditNote } = await import("./credit-notes");
    const { invoiceBalance } = await import("./service");
    const id = await taxedInvoice("Unpaid Co");
    const before = await bankBalance();
    const note = await issueCreditNote(database, ctx, id, {
      amountMinor: 22_000n,
      date: today,
      reason: "Fewer pages than quoted",
    });
    expect(note).toMatchObject({ number: "CN-0001", refundedMinor: 0n });
    const inv = await invoice(id);
    expect(inv).toMatchObject({ creditedMinor: 22_000n, status: "sent" });
    expect(invoiceBalance(inv)).toBe(88_000n);
    expect(await bankBalance()).toBe(before);
    // Crediting the rest settles the invoice.
    await issueCreditNote(database, ctx, id, {
      amountMinor: 88_000n,
      date: today,
      reason: "Project cancelled",
    });
    expect((await invoice(id)).status).toBe("paid");
    await expect(
      issueCreditNote(database, ctx, id, { amountMinor: 1n, date: today, reason: "More" }),
    ).rejects.toThrow("Credit between");
  });

  it("refunds the paid part through the ledger: income, GST and the bank go down", async () => {
    const { issueCreditNote } = await import("./credit-notes");
    const { invoiceBalance, gstSummary } = await import("./service");
    const { profitAndLoss } = await import("@/features/finance");
    const id = await taxedInvoice("Paid Co");
    await pay(id, 60_000n);
    const range = ["2000-01-01", "2100-01-01"] as const;
    const pnlBefore = await profitAndLoss(database, ctx.tenant.id, ...range);
    const gstBefore = await gstSummary(database, ctx.tenant.id, ...range);
    const bankBefore = await bankBalance();

    // Owed 500.00; credit 550.00: 500.00 comes off the balance, 50.00 is refunded.
    await expect(
      issueCreditNote(database, ctx, id, { amountMinor: 55_000n, date: today, reason: "Discount" }),
    ).rejects.toThrow("account");
    const note = await issueCreditNote(database, ctx, id, {
      amountMinor: 55_000n,
      date: today,
      reason: "Discount",
      refundAccountId: bank,
    });
    expect(note.refundedMinor).toBe(5_000n);
    const inv = await invoice(id);
    expect(inv).toMatchObject({ paidMinor: 55_000n, creditedMinor: 55_000n, status: "paid" });
    expect(invoiceBalance(inv)).toBe(0n);
    expect(await bankBalance()).toBe((bankBefore ?? 0n) - 5_000n);

    const pnl = await profitAndLoss(database, ctx.tenant.id, ...range);
    const gst = await gstSummary(database, ctx.tenant.id, ...range);
    // 50.00 refunded = 45.45 income + 4.55 GST (the invoice's tax pro rata, on the running total).
    expect(pnlBefore.incomeMinor - pnl.incomeMinor).toBe(4_545n);
    expect(gstBefore.salesTaxMinor - gst.salesTaxMinor).toBe(455n);
    // Accrual view: GST on the credit note (550.00 → 50.00) comes off.
    expect(gstBefore.accrualTaxMinor - gst.accrualTaxMinor).toBe(5_000n);
  });

  it("shows credit notes and refunds on the client statement, each on its own day", async () => {
    const { issueCreditNote } = await import("./credit-notes");
    const { clientStatement } = await import("./statement");
    const id = await taxedInvoice("Statement Co");
    await pay(id, 110_000n);
    await issueCreditNote(database, ctx, id, {
      amountMinor: 11_000n,
      date: today,
      reason: "Late delivery",
      refundAccountId: bank,
    });
    const inv = await invoice(id);
    const [st] = await clientStatement(database, ctx.tenant.id, inv.clientId, {
      from: "2026-01-01",
      to: today,
    });
    expect(st?.entries.map((e) => [e.kind, e.amountMinor])).toEqual([
      ["invoice", 110_000n],
      ["payment", -110_000n],
      ["creditNote", -11_000n],
      ["refund", 11_000n],
    ]);
    expect(st).toMatchObject({
      invoicedMinor: 110_000n,
      paidMinor: 99_000n,
      creditedMinor: 11_000n,
      closingMinor: 0n,
    });
    expect(st?.entries.find((e) => e.kind === "refund")?.reference).toMatch(/^CN-/);
  });

  it("voids only credit notes without a refund, and protects the refund in the ledger", async () => {
    const { issueCreditNote, voidCreditNote, invoiceAdjustmentsOf } = await import("./credit-notes");
    const { voidInvoice } = await import("./service");
    const { reverseTransaction } = await import("@/features/finance");
    const { invoicePayments } = await import("@/server/db/schema");
    const { eq, lt, and } = await import("drizzle-orm");

    const id = await taxedInvoice("Void Co");
    await issueCreditNote(database, ctx, id, { amountMinor: 10_000n, date: today, reason: "Typo" });
    await expect(voidInvoice(database, ctx, id)).rejects.toThrow("credit notes");
    const [note] = await invoiceAdjustmentsOf(database, ctx.tenant.id, id);
    await voidCreditNote(database, ctx, note?.id ?? "");
    expect((await invoice(id)).creditedMinor).toBe(0n);
    await expect(voidCreditNote(database, ctx, note?.id ?? "")).rejects.toThrow("already void");

    await pay(id, 110_000n);
    await issueCreditNote(database, ctx, id, {
      amountMinor: 10_000n,
      date: today,
      reason: "Refund",
      refundAccountId: bank,
    });
    const refunded = (await invoiceAdjustmentsOf(database, ctx.tenant.id, id)).find(
      (a) => a.refundedMinor > 0n,
    );
    await expect(voidCreditNote(database, ctx, refunded?.id ?? "")).rejects.toThrow("refunded");
    const [refundPayment] = await database
      .select()
      .from(invoicePayments)
      .where(and(eq(invoicePayments.invoiceId, id), lt(invoicePayments.amountMinor, 0n)));
    await expect(
      reverseTransaction(database, ctx, refundPayment?.transactionId ?? "", today, "oops"),
    ).rejects.toThrow("credit note");
  });

  it("dates each write-off on its own day", async () => {
    const { writeOffBalance } = await import("./service");
    const { invoiceAdjustments } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const id = await taxedInvoice("Write-off Co");
    await pay(id, 100_000n);
    await writeOffBalance(database, ctx, id, "Short payment");
    // An earlier write-off moved to another day stays there when a new one is added.
    await database
      .update(invoiceAdjustments)
      .set({ date: "2026-07-20" })
      .where(eq(invoiceAdjustments.invoiceId, id));
    const { reverseTransaction } = await import("@/features/finance");
    const { getInvoice } = await import("./service");
    const payment = (await getInvoice(database, ctx.tenant.id, id))?.payments[0];
    await reverseTransaction(database, ctx, payment?.transactionId ?? "", today, "Bounced");
    await writeOffBalance(database, ctx, id, "Gave up");
    const rows = await database.select().from(invoiceAdjustments).where(eq(invoiceAdjustments.invoiceId, id));
    expect(rows.map((r) => [r.date, r.amountMinor]).sort()).toEqual([
      ["2026-07-20", 10_000n],
      [today, 100_000n],
    ]);
    expect((await invoice(id)).writtenOffMinor).toBe(110_000n);
  });
});
