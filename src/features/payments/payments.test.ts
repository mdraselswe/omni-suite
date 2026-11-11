// @vitest-environment node
import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@/features/clients";
import { createAccount } from "@/features/finance";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

const WHSEC = "whsec_abcdefghijklmnop";
let database: Database;
let ctx: TenantContext;
let bank: string;
let invoiceId: string;

function signed(event: object) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", WHSEC).update(`${t}.${body}`).digest("hex");
  return { body, header: `t=${t},v1=${v1}` };
}

const paid = (id: string, amount: number, tenantId: string, invoice: string) => ({
  id: `evt_${id}`,
  type: "checkout.session.completed",
  data: {
    object: {
      id: `cs_${id}`,
      payment_status: "paid",
      amount_total: amount,
      currency: "aud",
      metadata: { tenantId, invoiceId: invoice },
    },
  },
});

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  const { createInvoice, sendInvoice } = await import("@/features/invoices");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "pay"));
  bank = await createAccount(database, ctx, {
    name: "Bank",
    type: "bank",
    currency: "AUD",
    openingBalanceMinor: 0n,
  });
  const clientId = await createClient(database, ctx, {
    name: "Acme",
    email: "billing@acme.example",
    phone: "",
    website: "",
    address: "",
    notes: "",
    status: "active",
    custom: {},
  });
  invoiceId = await createInvoice(database, ctx, {
    clientId,
    issueDate: "2026-07-01",
    dueDate: "2026-07-15",
    items: [{ description: "Website", quantity: "1", unitPriceMinor: "100000", taxRateBp: 1000 }],
    notes: "",
    custom: {},
  });
  await sendInvoice(database, ctx, invoiceId);
});

describe("online payments", () => {
  it("validates and stores the Stripe keys encrypted", async () => {
    const { saveStripeConnection, stripeConnection } = await import("./service");
    const check = vi.fn(async () => undefined);
    await expect(
      saveStripeConnection(
        database,
        ctx,
        { secretKey: "pk_test_nope", webhookSecret: WHSEC, accountId: bank, enabled: true },
        check,
      ),
    ).rejects.toThrow();
    await saveStripeConnection(
      database,
      ctx,
      { secretKey: "sk_test_1234567890abcdef", webhookSecret: WHSEC, accountId: bank, enabled: true },
      check,
    );
    expect(check).toHaveBeenCalledOnce();
    expect(await stripeConnection(database, ctx.tenant.id)).toMatchObject({ mode: "test", enabled: true });
    // Blank secrets keep the stored ones (and don't re-check the key).
    await saveStripeConnection(
      database,
      ctx,
      { secretKey: "", webhookSecret: "", accountId: bank, enabled: true },
      check,
    );
    expect(check).toHaveBeenCalledOnce();
  });

  it("records a paid checkout once, ignores bad signatures and logs overpayments", async () => {
    const { handleTenantWebhook } = await import("./service");
    const { getInvoice } = await import("@/features/invoices");
    const bad = signed(paid("x", 50_000, ctx.tenant.id, invoiceId));
    expect(
      (await handleTenantWebhook(database, ctx.tenant.id, bad.body, bad.header.replace(/v1=./, "v1=0")))
        .status,
    ).toBe(400);

    const part = signed(paid("1", 50_000, ctx.tenant.id, invoiceId));
    expect(await handleTenantWebhook(database, ctx.tenant.id, part.body, part.header)).toEqual({
      status: 200,
      note: "recorded",
    });
    // Stripe retries the same event: no second payment.
    await handleTenantWebhook(database, ctx.tenant.id, part.body, part.header);
    let row = await getInvoice(database, ctx.tenant.id, invoiceId);
    expect(row?.payments).toHaveLength(1);
    expect(row?.invoice).toMatchObject({ paidMinor: 50_000n, status: "partially_paid" });
    expect(row?.payments[0]?.method).toBe("stripe");

    // Pays more than is left (60 000 owed): records the balance, logs the rest.
    const rest = signed(paid("2", 70_000, ctx.tenant.id, invoiceId));
    await handleTenantWebhook(database, ctx.tenant.id, rest.body, rest.header);
    row = await getInvoice(database, ctx.tenant.id, invoiceId);
    expect(row?.invoice).toMatchObject({ paidMinor: 110_000n, status: "paid" });

    // An event for another business's invoice is ignored.
    const foreign = signed(paid("3", 1_000, "00000000-0000-0000-0000-000000000000", invoiceId));
    expect((await handleTenantWebhook(database, ctx.tenant.id, foreign.body, foreign.header)).note).toBe(
      "not paid",
    );
  });
});
