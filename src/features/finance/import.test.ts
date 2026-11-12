// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";
import { parseCsv } from "@/server/export";
import type { TenantContext } from "@/server/tenancy/context";
import type { BankImportOptions } from "./import";
import type * as Service from "./service";

/** Lets one test make the Nth ledger insert fail, to prove the import rolls back. */
const failure = vi.hoisted(() => ({ at: 0, calls: 0 }));

vi.mock("./service", async (importOriginal) => {
  const real = await importOriginal<typeof Service>();
  return {
    ...real,
    insertTransaction: async (...args: Parameters<typeof real.insertTransaction>) => {
      failure.calls++;
      if (failure.at > 0 && failure.calls === failure.at) throw new Error("Simulated database failure");
      return real.insertTransaction(...args);
    },
  };
});

let database: Database;
let ctx: TenantContext;
let otherCtx: TenantContext;
let bank: string;
let card: string;
let usd: string;
let otherBank: string;
let accountant: { ctx: TenantContext };
let manager: { ctx: TenantContext };

beforeAll(async () => {
  const { createTestDb, setupTenant, addMember } = await import("@/server/testing/db");
  const { createAccount } = await import("./service");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "bimp"));
  ({ ctx: otherCtx } = await setupTenant(database, "bimp-other"));
  accountant = await addMember(database, "bimp", "accountant", "Ada Accountant");
  manager = await addMember(database, "bimp", "manager", "Max Manager");
  const account = (name: string, currency = "AUD", c = ctx) =>
    createAccount(database, c, { name, type: "bank", currency, openingBalanceMinor: 100000n });
  bank = await account("Bank");
  card = await account("Card");
  usd = await account("USD account", "USD");
  otherBank = await account("Other bank", "AUD", otherCtx);
});

const opts = (over: Partial<BankImportOptions> = {}): BankImportOptions => ({
  accountId: bank,
  dateFormat: "dmy",
  ...over,
});

async function plan(csv: string, options: BankImportOptions = opts(), c: TenantContext = ctx) {
  const { planBankImport } = await import("./import");
  return planBankImport(database, c, parseCsv(csv), options);
}

async function balanceOf(accountId: string, tenantId = ctx.tenant.id) {
  const { listAccounts } = await import("./service");
  return (await listAccounts(database, tenantId)).find((a) => a.id === accountId)?.balanceMinor;
}

describe("bank import plan", () => {
  it("parses signed amounts in every common shape into minor units", async () => {
    const result = await plan(
      [
        "date,description,amount",
        '2026-08-01,Client paid,"1,234.50"',
        "2026-08-02,Fee,-45.00",
        "2026-08-03,Refund out,(45.00)",
        "2026-08-04,Stripe,$99.90",
        "2026-08-05,Card,-$12",
        "2026-08-06,Rounded,0.005",
        "2026-08-07,Bad,12abc",
        "2026-08-08,Empty,",
        "2026-08-09,Zero,0.00",
      ].join("\n"),
    );
    expect(result.rows.slice(0, 6).map((r) => [r.tx?.kind, r.tx?.amountMinor])).toEqual([
      ["income", 123450n],
      ["expense", 4500n],
      ["expense", 4500n],
      ["income", 9990n],
      ["expense", 1200n],
      ["income", 1n],
    ]);
    expect(result.rows.slice(6).map((r) => r.status)).toEqual(["error", "error", "error"]);
  });

  it("reads separate money in / money out columns, including debits written as negatives", async () => {
    const result = await plan(
      [
        "Posted Date,Narrative,Credit,Debit",
        "01/09/2026,Deposit,500.00,",
        "02/09/2026,Rent,,1200.00",
        "03/09/2026,Card fee,,-3.50",
        "04/09/2026,Confused,10.00,5.00",
      ].join("\n"),
    );
    expect(result.columns.map((c) => c.header)).toEqual(["posted date", "narrative", "credit", "debit"]);
    expect(result.rows.slice(0, 3).map((r) => [r.tx?.date, r.tx?.kind, r.tx?.amountMinor])).toEqual([
      ["2026-09-01", "income", 50000n],
      ["2026-09-02", "expense", 120000n],
      ["2026-09-03", "expense", 350n],
    ]);
    expect(result.rows[3]?.status).toBe("error");
  });

  it("uses the chosen date format for slash dates, ISO always", async () => {
    const csv = "date,description,amount\n03/04/2026,A,1\n2026-04-05,B,1\n13/04/2026,C,1";
    const dmy = await plan(csv, opts({ dateFormat: "dmy" }));
    expect(dmy.rows.map((r) => r.tx?.date ?? null)).toEqual(["2026-04-03", "2026-04-05", "2026-04-13"]);
    const mdy = await plan(csv, opts({ dateFormat: "mdy" }));
    expect(mdy.rows.map((r) => r.tx?.date ?? null)).toEqual(["2026-03-04", "2026-04-05", null]);
    const ymd = await plan(csv, opts({ dateFormat: "ymd" }));
    expect(ymd.rows.map((r) => r.status)).toEqual(["error", "ready", "error"]);
  });

  it("keeps quoted descriptions with commas and adds the reference", async () => {
    const result = await plan(
      'date,description,amount,reference\n2026-08-10,"Smith, J ""Web"" work",250.00,INV-7\n',
    );
    expect(result.rows[0]?.tx?.description).toBe('Smith, J "Web" work (INV-7)');
  });

  it("matches categories by name and kind; others are uncategorised with a note", async () => {
    const result = await plan(
      [
        "date,description,amount,category,tax",
        "2026-08-11,Figma,-30.00,software & TOOLS,2.73",
        "2026-08-12,Job,100.00,Services,",
        "2026-08-13,Odd,100.00,Software & tools,",
        "2026-08-14,Mystery,-5.00,Snacks,",
        "2026-08-15,Too taxed,-5.00,,6.00",
      ].join("\n"),
    );
    const [figma, job, odd, mystery, taxed] = result.rows;
    expect(figma?.status).toBe("ready");
    expect(figma?.tx?.categoryId).toBeTruthy();
    expect(figma?.tx?.taxMinor).toBe(273n);
    expect(job?.tx?.categoryId).toBeTruthy();
    expect(odd?.status).toBe("warning");
    expect(odd?.tx?.categoryId).toBeNull();
    expect(mystery?.status).toBe("warning");
    expect(mystery?.tx?.categoryId).toBeNull();
    expect(taxed?.status).toBe("error");
  });

  it("refuses files without a date or amount column, unknown accounts and missing exchange rates", async () => {
    await expect(plan("description,amount\nA,1")).rejects.toThrow(/date/);
    await expect(plan("date,description\n2026-08-01,A")).rejects.toThrow(/amount/);
    await expect(plan("date,amount\n2026-08-01,1", opts({ accountId: otherBank }))).rejects.toThrow(
      /Account not found/,
    );
    await expect(plan("date,amount\n2026-08-01,1", opts({ accountId: usd }))).rejects.toThrow(
      /exchange rate/,
    );
    const converted = await plan("date,amount\n2026-08-01,10.00", opts({ accountId: usd, fxRate: "1.5" }));
    expect(converted.rows[0]?.tx?.fxRate).toBe("1.5");
  });
});

describe("importing bank transactions", () => {
  it("skips duplicates of existing entries and of earlier rows, and leaves reversed entries importable", async () => {
    const { createTransaction, reverseTransaction } = await import("./service");
    const { importBankTransactions } = await import("./import");
    await createTransaction(database, ctx, {
      kind: "expense",
      accountId: card,
      date: "2026-10-02",
      description: "Coffee  Shop",
      amountMinor: 450n,
    });
    const wrong = await createTransaction(database, ctx, {
      kind: "income",
      accountId: card,
      date: "2026-10-03",
      description: "Wrong entry",
      amountMinor: 1000n,
    });
    await reverseTransaction(database, ctx, wrong, "2026-10-04", "typo");
    // Same day, amount and description in another account: not a duplicate here.
    await createTransaction(database, ctx, {
      kind: "income",
      accountId: bank,
      date: "2026-10-05",
      description: "Elsewhere",
      amountMinor: 700n,
    });
    const csv = [
      "date,description,amount",
      "2026-10-02,coffee shop,-4.50", // already there
      "2026-10-03,Wrong entry,10.00", // the old one was reversed
      "2026-10-05,Elsewhere,7.00",
      "2026-10-06,Lunch,-20.00",
      "2026-10-06,Lunch,-20.00", // repeat of the row above
      "2026-10-06,Lunch,-21.00",
    ].join("\n");
    const preview = await plan(csv, opts({ accountId: card }));
    expect(preview.rows.map((r) => r.status)).toEqual([
      "duplicate",
      "ready",
      "ready",
      "ready",
      "duplicate",
      "ready",
    ]);
    expect(preview.rows[4]?.messages.join(" ")).toMatch(/row 4/);

    const before = await balanceOf(card);
    const counts = await importBankTransactions(database, ctx, parseCsv(csv), opts({ accountId: card }));
    expect(counts).toEqual({ total: 6, ready: 4, duplicates: 2, failed: 0, imported: 4 });
    expect(await balanceOf(card)).toBe((before ?? 0n) + 1000n + 700n - 2000n - 2100n);
    const again = await importBankTransactions(database, ctx, parseCsv(csv), opts({ accountId: card }));
    expect(again).toMatchObject({ imported: 0, duplicates: 6 });
  });

  it("refuses rows in a closed period and imports the rest", async () => {
    const { closePeriod } = await import("./service");
    const { importBankTransactions } = await import("./import");
    await closePeriod(database, ctx, { startDate: "2026-06-01", endDate: "2026-06-30" });
    const csv = "date,description,amount\n15/06/2026,Late,-10.00\n15/07/2026,On time,-10.00";
    const preview = await plan(csv);
    expect(preview.rows[0]?.status).toBe("error");
    expect(preview.rows[0]?.messages.join(" ")).toMatch(/closed/);
    const counts = await importBankTransactions(database, ctx, parseCsv(csv), opts());
    expect(counts).toMatchObject({ imported: 1, failed: 1 });
  });

  it("ends with opening balance + the imported rows, with tax and one audit entry", async () => {
    const { createAccount, listCategories } = await import("./service");
    const { importBankTransactions } = await import("./import");
    const fresh = await createAccount(database, ctx, {
      name: "Fresh",
      type: "bank",
      currency: "AUD",
      openingBalanceMinor: 25000n,
    });
    const csv = [
      "Date,Details,Money In,Money Out,Reference,Category,GST",
      '01/11/2026,Client A,"1,100.00",,R1,Services,100.00',
      "02/11/2026,Software,,55.00,,Software & tools,5.00",
      "03/11/2026,Bank fee,,2.50,,,",
      "04/11/2026,Client B,330.00,,R2,Unknown,",
    ].join("\n");
    const counts = await importBankTransactions(database, ctx, parseCsv(csv), opts({ accountId: fresh }));
    expect(counts.imported).toBe(4);
    expect(await balanceOf(fresh)).toBe(25000n + 110000n - 5500n - 250n + 33000n);

    const { transactions, auditLogs } = await import("@/server/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const rows = await database.select().from(transactions).where(eq(transactions.accountId, fresh));
    const clientA = rows.find((r) => r.description === "Client A (R1)");
    const services = (await listCategories(database, ctx.tenant.id)).find((c) => c.name === "Services");
    expect(clientA).toMatchObject({ kind: "income", amountMinor: 110000n, taxMinor: 10000n });
    expect(clientA?.categoryId).toBe(services?.id);
    expect(rows.find((r) => r.description === "Client B (R2)")?.categoryId).toBeNull();
    const audits = await database
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "transaction.import"), eq(auditLogs.entityId, fresh)));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.data).toMatchObject({ imported: 4 });
  });

  it("leaves nothing behind when the import fails part way", async () => {
    const { createAccount } = await import("./service");
    const { importBankTransactions } = await import("./import");
    const acct = await createAccount(database, ctx, {
      name: "Rollback",
      type: "bank",
      currency: "AUD",
      openingBalanceMinor: 0n,
    });
    failure.calls = 0;
    failure.at = 3;
    const csv = "date,description,amount\n2026-11-01,A,1\n2026-11-02,B,2\n2026-11-03,C,3\n2026-11-04,D,4";
    await expect(
      importBankTransactions(database, ctx, parseCsv(csv), opts({ accountId: acct })),
    ).rejects.toThrow(/Simulated/);
    failure.at = 0;
    const { transactions } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    expect(await database.select().from(transactions).where(eq(transactions.accountId, acct))).toHaveLength(
      0,
    );
    expect(await balanceOf(acct)).toBe(0n);
  });

  it("needs finance.write", async () => {
    const { importBankTransactions } = await import("./import");
    const csv = "date,amount\n2026-11-05,1";
    await expect(importBankTransactions(database, accountant.ctx, parseCsv(csv), opts())).rejects.toThrow(
      /finance.write/,
    );
    await expect(importBankTransactions(database, manager.ctx, parseCsv(csv), opts())).rejects.toThrow(
      /finance.write/,
    );
  });

  it("keeps tenants apart: no importing into another business's account, no cross-tenant duplicates", async () => {
    const { createTransaction } = await import("./service");
    const { importBankTransactions } = await import("./import");
    await expect(
      importBankTransactions(database, otherCtx, parseCsv("date,amount\n2026-11-05,1"), opts()),
    ).rejects.toThrow(/Account not found/);
    await createTransaction(database, ctx, {
      kind: "income",
      accountId: bank,
      date: "2026-11-06",
      description: "Shared",
      amountMinor: 500n,
    });
    const csv = "date,description,amount\n2026-11-06,Shared,5.00";
    const counts = await importBankTransactions(
      database,
      otherCtx,
      parseCsv(csv),
      opts({ accountId: otherBank }),
    );
    expect(counts.imported).toBe(1);
    expect(await balanceOf(otherBank, otherCtx.tenant.id)).toBe(100000n + 500n);
  });
});
