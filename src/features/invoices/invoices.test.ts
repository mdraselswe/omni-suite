// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@/features/clients";
import { createAccount, listAccounts } from "@/features/finance";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

let database: Database;
let ctx: TenantContext;
let bank: string;
let clientId: string;

const item = { description: "Website", quantity: "2", unitPriceMinor: "50000", taxRateBp: 1000 };

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "inv"));
  bank = await createAccount(database, ctx, {
    name: "Bank",
    type: "bank",
    currency: "AUD",
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

describe("invoices", () => {
  it("numbers, totals, sends and takes part and full payments into the ledger", async () => {
    const { createInvoice, getInvoice, recordPayment, sendInvoice, displayStatus } =
      await import("./service");
    const id = await createInvoice(database, ctx, {
      clientId,
      issueDate: "2026-07-01",
      dueDate: "2026-07-15",
      items: [item],
      notes: "",
      custom: {},
    });
    const second = await createInvoice(database, ctx, {
      clientId,
      issueDate: "2026-07-02",
      dueDate: "2026-07-16",
      items: [item],
      notes: "",
      custom: {},
    });
    const a = await getInvoice(database, ctx.tenant.id, id);
    const b = await getInvoice(database, ctx.tenant.id, second);
    expect(a?.invoice.number).toBe("INV-0001");
    expect(b?.invoice.number).toBe("INV-0002");
    expect(a?.invoice.subtotalMinor).toBe(100000n);
    expect(a?.invoice.taxMinor).toBe(10000n);
    expect(a?.invoice.totalMinor).toBe(110000n);

    await expect(
      recordPayment(database, ctx, id, {
        amountMinor: 1000n,
        date: "2026-07-05",
        accountId: bank,
        method: "",
        categoryId: null,
      }),
    ).rejects.toThrow();
    await sendInvoice(database, ctx, id);
    expect(displayStatus({ status: "sent", dueDate: "2026-07-15" }, "2026-07-20")).toBe("overdue");

    await recordPayment(database, ctx, id, {
      amountMinor: 60000n,
      date: "2026-07-05",
      accountId: bank,
      method: "EFT",
      categoryId: null,
    });
    expect((await getInvoice(database, ctx.tenant.id, id))?.invoice.status).toBe("partially_paid");
    await expect(
      recordPayment(database, ctx, id, {
        amountMinor: 60000n,
        date: "2026-07-06",
        accountId: bank,
        method: "EFT",
        categoryId: null,
      }),
    ).rejects.toThrow(); // more than the balance
    await recordPayment(database, ctx, id, {
      amountMinor: 50000n,
      date: "2026-07-06",
      accountId: bank,
      method: "EFT",
      categoryId: null,
    });
    expect((await getInvoice(database, ctx.tenant.id, id))?.invoice.status).toBe("paid");

    const accounts = await listAccounts(database, ctx.tenant.id);
    expect(accounts.find((x) => x.id === bank)?.balanceMinor).toBe(110000n);
  });

  it("creates recurring invoices once per period, even when run twice", async () => {
    const { createRecurring, runRecurring, listInvoices } = await import("./service");
    await createRecurring(database, ctx, {
      clientId,
      name: "Retainer",
      intervalMonths: 1,
      nextRunDate: "2026-08-01",
      items: [item],
      autoSend: true,
    });
    const before = (await listInvoices(database, ctx.tenant.id)).length;
    expect(await runRecurring(database, ctx.tenant, "2026-08-01")).toBe(1);
    expect(await runRecurring(database, ctx.tenant, "2026-08-01")).toBe(0);
    const after = await listInvoices(database, ctx.tenant.id);
    expect(after.length).toBe(before + 1);
    expect(after.some((r) => r.invoice.issueDate === "2026-08-01" && r.invoice.status === "sent")).toBe(true);
  });

  it("turns an accepted proposal into a draft invoice", async () => {
    const { createProposal, sendProposal, respondToProposal, invoiceFromProposal } =
      await import("@/features/proposals");
    const { getInvoice } = await import("./service");
    const p = await createProposal(database, ctx, {
      clientId,
      title: "Site",
      intro: "",
      terms: "",
      items: [item],
      validUntil: "2026-12-31",
    });
    await expect(invoiceFromProposal(database, ctx, p, "2026-09-01")).rejects.toThrow();
    await sendProposal(database, ctx, p);
    await respondToProposal(database, ctx, p, { accept: true, name: "Client", ip: "", today: "2026-09-01" });
    const inv = await invoiceFromProposal(database, ctx, p, "2026-09-01");
    const row = await getInvoice(database, ctx.tenant.id, inv);
    expect(row?.invoice.status).toBe("draft");
    expect(row?.invoice.totalMinor).toBe(110000n);
  });
});
