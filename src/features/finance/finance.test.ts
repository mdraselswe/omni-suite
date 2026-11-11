// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import { setupTenant } from "@/server/testing/db";
import type { TenantContext } from "@/server/tenancy/context";
import {
  closePeriod,
  convert,
  createAccount,
  createTransaction,
  listAccounts,
  listCategories,
  monthlyTotals,
  profitAndLoss,
  reverseTransaction,
} from "./service";

let database: Database;
let ctx: TenantContext;
let bank: string;
let cash: string;

beforeAll(async () => {
  const { createTestDb } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "fin"));
  bank = await createAccount(database, ctx, {
    name: "Bank",
    type: "bank",
    currency: "AUD",
    openingBalanceMinor: 100000n,
  });
  const accounts = await listAccounts(database, ctx.tenant.id);
  cash = accounts.find((a) => a.name === "Cash")?.id ?? "";
});

describe("finance ledger", () => {
  it("tracks balances across income, expense, transfer and reversal", async () => {
    const cats = await listCategories(database, ctx.tenant.id);
    const services = cats.find((c) => c.kind === "income")?.id ?? null;
    const software = cats.find((c) => c.kind === "expense")?.id ?? null;
    await createTransaction(database, ctx, {
      kind: "income",
      accountId: bank,
      categoryId: services,
      date: "2026-07-05",
      description: "Website",
      amountMinor: 500000n,
    });
    const exp = await createTransaction(database, ctx, {
      kind: "expense",
      accountId: bank,
      categoryId: software,
      date: "2026-07-06",
      description: "Hosting",
      amountMinor: 20000n,
    });
    await createTransaction(database, ctx, {
      kind: "transfer",
      accountId: bank,
      toAccountId: cash,
      date: "2026-07-07",
      description: "Petty cash",
      amountMinor: 30000n,
    });

    let balances = await listAccounts(database, ctx.tenant.id);
    expect(balances.find((a) => a.id === bank)?.balanceMinor).toBe(100000n + 500000n - 20000n - 30000n);
    expect(balances.find((a) => a.id === cash)?.balanceMinor).toBe(30000n);

    await reverseTransaction(database, ctx, exp, "2026-07-08", "duplicate");
    balances = await listAccounts(database, ctx.tenant.id);
    expect(balances.find((a) => a.id === bank)?.balanceMinor).toBe(100000n + 500000n - 30000n);
    await expect(reverseTransaction(database, ctx, exp, "2026-07-08", "")).rejects.toThrow();

    const pnl = await profitAndLoss(database, ctx.tenant.id, "2026-07-01", "2026-07-31");
    expect(pnl.incomeMinor).toBe(500000n);
    expect(pnl.expenseMinor).toBe(0n);
    const months = await monthlyTotals(database, ctx.tenant.id, "2026-01-01", "2026-12-31");
    expect(months).toEqual([{ month: "2026-07", incomeMinor: 500000n, expenseMinor: 0n }]);
  });

  it("refuses entries in a closed period", async () => {
    await closePeriod(database, ctx, { startDate: "2026-06-01", endDate: "2026-06-30" });
    await expect(
      createTransaction(database, ctx, {
        kind: "income",
        accountId: bank,
        date: "2026-06-15",
        description: "Late",
        amountMinor: 100n,
      }),
    ).rejects.toThrow(/closed/i);
  });

  it("converts foreign amounts with half-up rounding", () => {
    expect(convert(10000n, "1.52345678")).toBe(15235n);
    expect(convert(333n, "0.5")).toBe(167n);
  });
});
