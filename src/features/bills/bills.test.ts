// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, today } from "@/lib/dates";
import { parsePage } from "@/lib/pagination";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";
import type { BillInput } from "./service";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));
// Keep attachments off the disk: the service only needs a key back.
vi.mock("@/server/storage", () => ({
  storeFile: vi.fn(async (tenantId: string) => `${tenantId}/${crypto.randomUUID()}`),
  removeFile: vi.fn(async () => undefined),
  loadFile: vi.fn(async () => Buffer.from("")),
}));

let database: Database;
let ctx: TenantContext;
let other: TenantContext;
let aud: string;
let bdt: string;
let software: string;
let salaries: string;
let income: string;

const page = parsePage({});

function bill(overrides: Partial<BillInput> = {}): BillInput {
  return {
    supplier: "Canva",
    reference: "INV-77",
    issueDate: "2026-03-01",
    dueDate: "2026-03-15",
    currency: "AUD",
    totalMinor: 110000n,
    taxMinor: 10000n,
    categoryId: software,
    notes: "",
    ...overrides,
  };
}

async function balanceOf(accountId: string) {
  const { listAccounts } = await import("@/features/finance");
  const all = await listAccounts(database, ctx.tenant.id);
  return all.find((a) => a.id === accountId)?.balanceMinor;
}

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  const { createAccount, createCategory, listCategories } = await import("@/features/finance");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "bil"));
  ({ ctx: other } = await setupTenant(database, "bil-other"));
  aud = await createAccount(database, ctx, {
    name: "AUD bank",
    type: "bank",
    currency: "AUD",
    openingBalanceMinor: 1_000_000n,
  });
  bdt = await createAccount(database, ctx, {
    name: "Dhaka bank",
    type: "bank",
    currency: "BDT",
    openingBalanceMinor: 100_000_000n,
  });
  await createCategory(database, ctx, { kind: "expense", name: "Software" });
  await createCategory(database, ctx, { kind: "expense", name: "Salaries" });
  const cats = await listCategories(database, ctx.tenant.id);
  const find = (name: string) => {
    const c = cats.find((x) => x.name === name);
    if (!c) throw new Error(`no category ${name}`);
    return c;
  };
  software = find("Software").id;
  salaries = find("Salaries").id;
  const inc = cats.find((c) => c.kind === "income");
  if (!inc) throw new Error("no income category");
  income = inc.id;
});

describe("bills", () => {
  it("records a bill, checks its fields and keeps an attached copy", async () => {
    const { createBill, getBill, supplierNames, billAttachment } = await import("./service");
    await expect(createBill(database, ctx, bill({ dueDate: "2026-02-01" }))).rejects.toThrow(/due date/i);
    await expect(createBill(database, ctx, bill({ taxMinor: 200000n }))).rejects.toThrow(/tax/i);
    await expect(createBill(database, ctx, bill({ categoryId: income }))).rejects.toThrow(
      /expense category/i,
    );
    await expect(createBill(database, ctx, bill({ supplier: "  " }))).rejects.toThrow(/supplier/i);
    await expect(
      createBill(database, ctx, bill(), new File(["x"], "bill.exe", { type: "application/x-msdownload" })),
    ).rejects.toThrow(/PDF/);

    const id = await createBill(
      database,
      ctx,
      bill(),
      new File(["%PDF-1.4"], "canva.pdf", { type: "application/pdf" }),
    );
    const row = await getBill(database, ctx.tenant.id, id);
    expect(row?.bill.supplier).toBe("Canva");
    expect(row?.bill.paidMinor).toBe(0n);
    expect(row?.bill.fileName).toBe("canva.pdf");
    expect(await billAttachment(database, ctx.tenant.id, id)).toMatchObject({ name: "canva.pdf" });
    expect(await supplierNames(database, ctx.tenant.id)).toContain("Canva");
  });

  it("takes part and full payments as expenses carrying the bill's tax share", async () => {
    const { createBill, getBill, payBill, billStatus, billBalance } = await import("./service");
    const { transactions } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const id = await createBill(database, ctx, bill({ supplier: "Figma" }));
    const before = await balanceOf(aud);

    await payBill(database, ctx, id, { amountMinor: 33000n, date: "2026-03-10", accountId: aud });
    let row = await getBill(database, ctx.tenant.id, id);
    if (!row) throw new Error("missing");
    expect(billStatus(row.bill)).toBe("partially_paid");
    expect(billBalance(row.bill)).toBe(77000n);
    expect(row.payments[0]?.taxMinor).toBe(3000n);

    // Overpaying and paying in the future are refused.
    await expect(
      payBill(database, ctx, id, { amountMinor: 77001n, date: "2026-03-11", accountId: aud }),
    ).rejects.toThrow(/balance/);
    const tomorrow = addDays(today(ctx.tenant.settings.timezone), 1);
    await expect(
      payBill(database, ctx, id, { amountMinor: 100n, date: tomorrow, accountId: aud }),
    ).rejects.toThrow(/future/);
    // The paying account must be in the bill's currency.
    await expect(
      payBill(database, ctx, id, { amountMinor: 100n, date: "2026-03-11", accountId: bdt, fxRate: "0.0135" }),
    ).rejects.toThrow(/AUD/);

    await payBill(database, ctx, id, { amountMinor: 77000n, date: "2026-03-12", accountId: aud });
    row = await getBill(database, ctx.tenant.id, id);
    if (!row) throw new Error("missing");
    expect(billStatus(row.bill)).toBe("paid");
    expect(row.payments.map((p) => p.taxMinor)).toEqual([3000n, 7000n]);
    await expect(
      payBill(database, ctx, id, { amountMinor: 1n, date: "2026-03-12", accountId: aud }),
    ).rejects.toThrow(/Nothing is owed/);

    const ledger = await database
      .select()
      .from(transactions)
      .where(eq(transactions.id, row.payments[1]?.transactionId ?? ""));
    expect(ledger[0]).toMatchObject({
      kind: "expense",
      categoryId: software,
      amountMinor: 77000n,
      taxMinor: 7000n,
    });
    expect(await balanceOf(aud)).toBe((before ?? 0n) - 110000n);
  });

  it("pays a foreign-currency bill from an account in that currency at the given rate", async () => {
    const { createBill, getBill, payBill, billStatus } = await import("./service");
    const { transactions } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const id = await createBill(
      database,
      ctx,
      bill({
        supplier: "Dhaka team",
        reference: "Salaries March",
        currency: "BDT",
        totalMinor: 5_000_000n,
        taxMinor: 0n,
        categoryId: salaries,
      }),
    );
    // A foreign amount needs a rate to reach the reports in the base currency.
    await expect(
      payBill(database, ctx, id, { amountMinor: 2_000_000n, date: "2026-03-20", accountId: bdt }),
    ).rejects.toThrow();
    await payBill(database, ctx, id, {
      amountMinor: 2_000_000n,
      date: "2026-03-20",
      accountId: bdt,
      fxRate: "0.0135",
    });
    const row = await getBill(database, ctx.tenant.id, id);
    if (!row) throw new Error("missing");
    expect(billStatus(row.bill)).toBe("partially_paid");
    const [tx] = await database
      .select()
      .from(transactions)
      .where(eq(transactions.id, row.payments[0]?.transactionId ?? ""));
    expect(tx).toMatchObject({
      currency: "BDT",
      amountMinor: 2_000_000n,
      baseAmountMinor: 27000n,
      categoryId: salaries,
    });
  });

  it("undoing a payment reverses its ledger entry, reopens the bill and restores the balance", async () => {
    const { createBill, getBill, payBill, undoBillPayment, billStatus } = await import("./service");
    const { reverseTransaction } = await import("@/features/finance");
    const id = await createBill(
      database,
      ctx,
      bill({ supplier: "Adobe", totalMinor: 55000n, taxMinor: 5000n }),
    );
    const before = await balanceOf(aud);
    await payBill(database, ctx, id, { amountMinor: 55000n, date: "2026-04-02", accountId: aud });
    expect(await balanceOf(aud)).toBe((before ?? 0n) - 55000n);
    let row = await getBill(database, ctx.tenant.id, id);
    const first = row?.payments[0];
    if (!row || !first) throw new Error("missing");
    expect(billStatus(row.bill)).toBe("paid");

    const now = today(ctx.tenant.settings.timezone);
    await undoBillPayment(database, ctx, id, first.id, now, "wrong card");
    row = await getBill(database, ctx.tenant.id, id);
    if (!row) throw new Error("missing");
    expect(billStatus(row.bill)).toBe("open");
    expect(row.payments[0]?.reversedAt).not.toBeNull();
    expect(await balanceOf(aud)).toBe(before);
    await expect(undoBillPayment(database, ctx, id, first.id, now, "")).rejects.toThrow(/already reversed/);

    // Paying again after an undo still adds up to exactly the bill's tax.
    await payBill(database, ctx, id, { amountMinor: 20000n, date: "2026-04-03", accountId: aud });
    await payBill(database, ctx, id, { amountMinor: 35000n, date: "2026-04-04", accountId: aud });
    row = await getBill(database, ctx.tenant.id, id);
    if (!row) throw new Error("missing");
    const liveTax = row.payments.filter((p) => !p.reversedAt).reduce((a, p) => a + p.taxMinor, 0n);
    expect(liveTax).toBe(5000n);
    expect(billStatus(row.bill)).toBe("paid");

    // Reversing the entry from the ledger reopens the bill too.
    const last = row.payments.at(-1);
    if (!last) throw new Error("missing");
    await reverseTransaction(database, ctx, last.transactionId, now, "");
    row = await getBill(database, ctx.tenant.id, id);
    if (!row) throw new Error("missing");
    expect(billStatus(row.bill)).toBe("partially_paid");
    expect(row.bill.paidMinor).toBe(20000n);
  });

  it("edits and voids only bills without live payments", async () => {
    const { createBill, getBill, payBill, undoBillPayment, updateBill, voidBill, billStatus } =
      await import("./service");
    const id = await createBill(database, ctx, bill({ supplier: "Hosting" }));
    await updateBill(
      database,
      ctx,
      id,
      bill({ supplier: "Hosting Co", totalMinor: 22000n, taxMinor: 2000n }),
    );
    expect((await getBill(database, ctx.tenant.id, id))?.bill).toMatchObject({
      supplier: "Hosting Co",
      totalMinor: 22000n,
    });

    await payBill(database, ctx, id, { amountMinor: 10000n, date: "2026-05-01", accountId: aud });
    await expect(updateBill(database, ctx, id, bill())).rejects.toThrow(/unpaid/);
    await expect(voidBill(database, ctx, id)).rejects.toThrow(/payments/);

    const paymentId = (await getBill(database, ctx.tenant.id, id))?.payments[0]?.id ?? "";
    await undoBillPayment(database, ctx, id, paymentId, today(ctx.tenant.settings.timezone), "");
    await voidBill(database, ctx, id);
    const row = await getBill(database, ctx.tenant.id, id);
    if (!row) throw new Error("missing");
    expect(billStatus(row.bill)).toBe("void");
    await expect(voidBill(database, ctx, id)).rejects.toThrow(/already void/);
    await expect(
      payBill(database, ctx, id, { amountMinor: 100n, date: "2026-05-02", accountId: aud }),
    ).rejects.toThrow(/Nothing is owed/);
    await expect(updateBill(database, ctx, id, bill())).rejects.toThrow(/unpaid/);
  });

  it("refuses payments dated in a closed period", async () => {
    const { createBill, payBill } = await import("./service");
    const { closePeriod } = await import("@/features/finance");
    const id = await createBill(
      database,
      ctx,
      bill({ supplier: "Accountant", issueDate: "2025-12-01", dueDate: "2025-12-31" }),
    );
    await closePeriod(database, ctx, { startDate: "2025-12-01", endDate: "2025-12-31" });
    await expect(
      payBill(database, ctx, id, { amountMinor: 1000n, date: "2025-12-20", accountId: aud }),
    ).rejects.toThrow(/closed/);
    await payBill(database, ctx, id, { amountMinor: 1000n, date: "2026-01-05", accountId: aud });
  });

  it("keeps each business's bills to itself", async () => {
    const { createBill, getBill, pageBills, payBill, voidBill, updateBill, billAttachment, payables } =
      await import("./service");
    const id = await createBill(database, ctx, bill({ supplier: "Private supplier" }));
    expect(await getBill(database, other.tenant.id, id)).toBeNull();
    expect(await billAttachment(database, other.tenant.id, id)).toBeNull();
    const found = await pageBills(database, other.tenant.id, {}, page);
    expect(found.total).toBe(0);
    expect((await payables(database, other.tenant.id, "2026-12-31", "AUD")).byCurrency).toEqual([]);
    await expect(voidBill(database, other, id)).rejects.toThrow(/not found/);
    await expect(updateBill(database, other, id, bill({ categoryId: null }))).rejects.toThrow(/not found/);
    await expect(
      payBill(database, other, id, { amountMinor: 100n, date: "2026-05-02", accountId: aud }),
    ).rejects.toThrow(/not found/);
  });

  it("lists, filters and totals what is owed per currency", async () => {
    const { pageBills, payables, billBalance } = await import("./service");
    const now = "2026-06-01";
    const owed = await payables(database, ctx.tenant.id, now, "AUD");
    const all = await pageBills(database, ctx.tenant.id, { today: now }, parsePage({ size: "100" }));
    // Same figures as adding up the balances in the list.
    const sumIn = (currency: string) =>
      all.rows.filter((r) => r.bill.currency === currency).reduce((a, r) => a + billBalance(r.bill), 0n);
    expect(owed.byCurrency.map((p) => p.currency)).toEqual(["AUD", "BDT"]);
    expect(owed.base.owedMinor).toBe(sumIn("AUD"));
    expect(owed.byCurrency[1]?.owedMinor).toBe(3_000_000n);
    expect(owed.base.overdueMinor).toBe(owed.base.owedMinor);

    const open = await pageBills(database, ctx.tenant.id, { status: "open", today: now }, page);
    expect(open.rows.every((r) => billBalance(r.bill) > 0n)).toBe(true);
    const overdue = await pageBills(database, ctx.tenant.id, { status: "overdue", today: now }, page);
    expect(overdue.total).toBe(open.total);
    const notYet = await pageBills(database, ctx.tenant.id, { status: "overdue", today: "2025-01-01" }, page);
    expect(notYet.total).toBe(0);
    const paid = await pageBills(database, ctx.tenant.id, { status: "paid", today: now }, page);
    expect(paid.rows.map((r) => r.bill.supplier)).toContain("Figma");
    const voided = await pageBills(database, ctx.tenant.id, { status: "void", today: now }, page);
    expect(voided.rows.map((r) => r.bill.supplier)).toEqual(["Hosting Co"]);
    const search = await pageBills(database, ctx.tenant.id, { q: "salaries march" }, page);
    expect(search.rows.map((r) => r.bill.supplier)).toEqual(["Dhaka team"]);
  });

  it("counts bill payments in profit and the GST report", async () => {
    const { profitAndLoss } = await import("@/features/finance");
    const { gstSummary } = await import("@/features/invoices");
    // March: Figma 1,100 (100 GST) and the Dhaka salaries part payment (270 AUD, no GST).
    const pnl = await profitAndLoss(database, ctx.tenant.id, "2026-03-01", "2026-03-31");
    expect(pnl.expenseMinor).toBe(100000n + 27000n);
    expect(pnl.lines.find((l) => l.categoryId === software)?.totalMinor).toBe(100000n);
    expect(pnl.lines.find((l) => l.categoryId === salaries)?.totalMinor).toBe(27000n);
    const gst = await gstSummary(database, ctx.tenant.id, "2026-03-01", "2026-03-31");
    expect(gst.purchaseTaxMinor).toBe(10000n);
    expect(gst.purchasesMinor).toBe(110000n + 27000n);
  });
});
