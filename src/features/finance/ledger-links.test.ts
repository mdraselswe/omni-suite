// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@/features/clients";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

/**
 * Money records that point at each other: invoice payments, capital and their ledger
 * rows; proposals and the invoice made from them; recurring schedules.
 */

let database: Database;
let ctx: TenantContext;
let bank: string;
let usd: string;
let clientId: string;

const item = { description: "Website", quantity: "1", unitPriceMinor: "100000", taxRateBp: 0 };

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  const { createAccount } = await import("./service");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "links"));
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
    email: "billing@acme.test",
    phone: "",
    website: "",
    address: "",
    notes: "",
    status: "active",
    custom: {},
  });
});

async function sentInvoice(): Promise<string> {
  const { createInvoice, sendInvoice } = await import("@/features/invoices");
  const id = await createInvoice(database, ctx, {
    clientId,
    issueDate: "2026-07-01",
    dueDate: "2026-07-15",
    items: [item],
    notes: "",
    custom: {},
  });
  await sendInvoice(database, ctx, id);
  return id;
}

describe("ledger links", () => {
  it("reversing an invoice payment makes the invoice owing again, once", async () => {
    const { recordPayment, getInvoice } = await import("@/features/invoices");
    const { reverseTransaction } = await import("./service");
    const { invoicePayments } = await import("@/server/db/schema");
    const id = await sentInvoice();
    await recordPayment(database, ctx, id, {
      amountMinor: 100000n,
      date: "2026-07-02",
      accountId: bank,
      method: "bank",
      categoryId: null,
    });
    expect((await getInvoice(database, ctx.tenant.id, id))?.invoice.status).toBe("paid");

    const [payment] = await database.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, id));
    if (!payment) throw new Error("no payment");
    await reverseTransaction(database, ctx, payment.transactionId, "2026-07-03", "wrong client");

    const after = await getInvoice(database, ctx.tenant.id, id);
    expect(after?.invoice.paidMinor).toBe(0n);
    expect(after?.invoice.status).toBe("sent");
    const [marked] = await database.select().from(invoicePayments).where(eq(invoicePayments.id, payment.id));
    expect(marked?.reversedAt).toBeInstanceOf(Date);
    await expect(
      reverseTransaction(database, ctx, payment.transactionId, "2026-07-03", "again"),
    ).rejects.toThrow();
  });

  it("refuses an invoice payment into an account in another currency", async () => {
    const { recordPayment } = await import("@/features/invoices");
    const id = await sentInvoice();
    await expect(
      recordPayment(database, ctx, id, {
        amountMinor: 1000n,
        date: "2026-07-02",
        accountId: usd,
        method: "bank",
        categoryId: null,
      }),
    ).rejects.toThrow(/currency/i);
  });

  it("needs an exchange rate for a foreign-currency transaction", async () => {
    const { createTransaction } = await import("./service");
    const base = {
      kind: "expense" as const,
      accountId: usd,
      date: "2026-07-05",
      description: "Tool",
      amountMinor: 2000n,
    };
    await expect(createTransaction(database, ctx, base)).rejects.toThrow(/exchange rate/i);
    await expect(createTransaction(database, ctx, { ...base, fxRate: "1.5" })).resolves.toBeTypeOf("string");
  });

  it("reversing a capital contribution takes it off the partner's capital", async () => {
    const { createPartner, recordCapital, listPartners } = await import("@/features/partners");
    const { reverseTransaction } = await import("./service");
    const { transactions } = await import("@/server/db/schema");
    const partnerId = await createPartner(database, ctx, {
      name: "Pat",
      email: "",
      joinedOn: "2026-01-01",
      membershipId: null,
    });
    await recordCapital(database, ctx, {
      partnerId,
      date: "2026-07-01",
      kind: "cash",
      amountMinor: 50000n,
      description: "",
      accountId: bank,
    });
    const [tx] = await database
      .select()
      .from(transactions)
      .where(and(eq(transactions.tenantId, ctx.tenant.id), eq(transactions.partnerId, partnerId)));
    if (!tx) throw new Error("no capital row");
    await reverseTransaction(database, ctx, tx.id, "2026-07-02", "");
    const pat = (await listPartners(database, ctx.tenant.id, "2026-07-03")).find((p) => p.id === partnerId);
    expect(pat?.capitalMinor).toBe(0n);
  });

  it("links a partner only to an active team member, once", async () => {
    const { createPartner } = await import("@/features/partners");
    await expect(
      createPartner(database, ctx, {
        name: "Ghost",
        email: "",
        joinedOn: "2026-01-01",
        membershipId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow();
    await createPartner(database, ctx, {
      name: "Owner",
      email: "",
      joinedOn: "2026-01-01",
      membershipId: ctx.membership.id,
    });
    await expect(
      createPartner(database, ctx, {
        name: "Owner again",
        email: "",
        joinedOn: "2026-01-01",
        membershipId: ctx.membership.id,
      }),
    ).rejects.toThrow(/already linked/i);
  });
});

describe("proposals", () => {
  const input = () => ({
    clientId,
    title: "Redesign",
    intro: "",
    terms: "",
    items: [item],
    validUntil: null,
  });

  it("turns an accepted proposal into one invoice only", async () => {
    const { createProposal, sendProposal, respondToProposal, invoiceFromProposal, invoiceForProposal } =
      await import("@/features/proposals");
    const id = await createProposal(database, ctx, input());
    // No portal users: the client's email address gets it.
    expect(await sendProposal(database, ctx, id)).toBe("email");
    await respondToProposal(database, ctx, id, {
      accept: true,
      name: "Ann",
      ip: "1.1.1.1",
      today: "2026-07-01",
    });
    const invoiceId = await invoiceFromProposal(database, ctx, id, "2026-07-01");
    expect((await invoiceForProposal(database, ctx.tenant.id, id))?.id).toBe(invoiceId);
    await expect(invoiceFromProposal(database, ctx, id, "2026-07-01")).rejects.toThrow(/already/i);
  });

  it("goes back to draft and deletes only drafts", async () => {
    const { createProposal, sendProposal, reopenProposal, deleteProposal, getProposal } =
      await import("@/features/proposals");
    const id = await createProposal(database, ctx, input());
    await sendProposal(database, ctx, id);
    await expect(deleteProposal(database, ctx, id)).rejects.toThrow();
    await reopenProposal(database, ctx, id);
    expect((await getProposal(database, ctx.tenant.id, id))?.proposal.status).toBe("draft");
    await deleteProposal(database, ctx, id);
    expect(await getProposal(database, ctx.tenant.id, id)).toBeNull();
  });
});

describe("recurring schedules", () => {
  it("can be edited and deleted", async () => {
    const { createRecurring, updateRecurring, deleteRecurring, listRecurring } =
      await import("@/features/invoices");
    await createRecurring(database, ctx, {
      clientId,
      name: "Hosting",
      intervalMonths: 1,
      nextRunDate: "2026-08-01",
      items: [item],
      autoSend: false,
    });
    const [row] = await listRecurring(database, ctx.tenant.id);
    if (!row) throw new Error("no schedule");
    await updateRecurring(database, ctx, row.r.id, {
      clientId,
      name: "Hosting (yearly)",
      intervalMonths: 12,
      nextRunDate: "2026-09-01",
      items: [item],
      autoSend: true,
    });
    const [changed] = await listRecurring(database, ctx.tenant.id);
    expect(changed?.r).toMatchObject({ name: "Hosting (yearly)", intervalMonths: 12, autoSend: true });
    await deleteRecurring(database, ctx, row.r.id);
    expect(await listRecurring(database, ctx.tenant.id)).toHaveLength(0);
  });
});
