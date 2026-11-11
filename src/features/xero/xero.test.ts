// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";
import {
  chunk,
  invoiceHash,
  invoicePayload,
  paymentPayload,
  RECONNECT_NEEDED,
  shouldSyncInvoice,
  type InvoiceForXero,
} from "./mapping";

const settings = { salesAccountCode: "200", paymentAccountCode: "090", taxType: "OUTPUT" };
const invoice: InvoiceForXero = {
  id: "inv",
  number: "INV-0001",
  status: "sent",
  issueDate: "2026-11-01",
  dueDate: "2026-11-15",
  currency: "aud",
  items: [
    { description: "Website", quantity: "1", unitPriceMinor: "150000", taxRateBp: 1000 },
    { description: "Hosting (GST free)", quantity: "1.5", unitPriceMinor: "2005", taxRateBp: 0 },
  ],
};

describe("xero mapping", () => {
  it("maps an invoice to an authorised ACCREC with tax types per line", () => {
    const payload = invoicePayload(invoice, { contactId: "c1", pricesIncludeTax: false, settings });
    expect(payload).toMatchObject({
      Type: "ACCREC",
      Contact: { ContactID: "c1" },
      InvoiceNumber: "INV-0001",
      CurrencyCode: "AUD",
      LineAmountTypes: "Exclusive",
      Status: "AUTHORISED",
    });
    expect(payload.LineItems).toEqual([
      { Description: "Website", Quantity: 1, UnitAmount: 1500, AccountCode: "200", TaxType: "OUTPUT" },
      {
        Description: "Hosting (GST free)",
        Quantity: 1.5,
        UnitAmount: 20.05,
        AccountCode: "200",
        TaxType: "EXEMPTOUTPUT",
      },
    ]);
    expect(
      invoicePayload(invoice, { contactId: "c1", pricesIncludeTax: true, settings }).LineAmountTypes,
    ).toBe("Inclusive");
  });

  it("never sends drafts and only voids invoices Xero already has", () => {
    expect(shouldSyncInvoice({ status: "draft" }, true)).toBe(false);
    expect(shouldSyncInvoice({ status: "void" }, false)).toBe(false);
    expect(shouldSyncInvoice({ status: "void" }, true)).toBe(true);
    expect(shouldSyncInvoice({ status: "paid" }, false)).toBe(true);
    const voided = invoicePayload(
      { ...invoice, status: "void" },
      { contactId: "c1", pricesIncludeTax: false, settings },
    );
    expect(voided.Status).toBe("VOIDED");
  });

  it("hashes content, not ids or payment progress", () => {
    const base = invoicePayload(invoice, { contactId: "c1", pricesIncludeTax: false, settings });
    const linked = invoicePayload(invoice, {
      contactId: "c1",
      pricesIncludeTax: false,
      settings,
      invoiceId: "x",
    });
    const paid = invoicePayload(
      { ...invoice, status: "paid" },
      { contactId: "c1", pricesIncludeTax: false, settings, invoiceId: "x" },
    );
    expect(invoiceHash(linked)).toBe(invoiceHash(base));
    expect(invoiceHash(paid)).toBe(invoiceHash(base));
    const edited = invoicePayload(
      { ...invoice, dueDate: "2026-11-30" },
      { contactId: "c1", pricesIncludeTax: false, settings },
    );
    expect(invoiceHash(edited)).not.toBe(invoiceHash(base));
  });

  it("formats payments and batches", () => {
    expect(
      paymentPayload(
        { id: "p", invoiceId: "inv", amountMinor: 50000n, date: "2026-11-05", method: "bank" },
        { xeroInvoiceId: "X1", currency: "AUD", accountCode: "090" },
      ),
    ).toEqual({
      Invoice: { InvoiceID: "X1" },
      Account: { Code: "090" },
      Date: "2026-11-05",
      Amount: 500,
      Reference: "bank",
    });
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

/* ─── Sync loop against a mocked Xero ──────────────────────────────── */

type Call = { method: string; url: string; body: string };

function mockXero(handlers: Record<string, (call: Call) => { status?: number; json: unknown }>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const call = { method: init?.method ?? "GET", url: String(input), body: String(init?.body ?? "") };
      calls.push(call);
      const key = Object.keys(handlers).find((k) => {
        const [method, path] = k.split(" ");
        return call.method === method && call.url.includes(path ?? "");
      });
      const handler = key ? handlers[key] : undefined;
      if (!handler) throw new Error(`Unexpected ${call.method} ${call.url}`);
      const { status = 200, json } = handler(call);
      return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

let database: Database;
let tenantId: string;

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  const { encrypt } = await import("@/server/crypto");
  const { clients, invoices, invoicePayments, xeroConnections } = await import("@/server/db/schema");
  database = await createTestDb();
  ({ tenantId } = await setupTenant(database, "xero"));
  const [client] = await database
    .insert(clients)
    .values({ tenantId, name: "Koala Dental", email: "admin@koala.example" })
    .returning({ id: clients.id });
  const clientId = client?.id ?? "";
  const rows = await database
    .insert(invoices)
    .values([
      {
        tenantId,
        clientId,
        number: "INV-0001",
        status: "partially_paid" as const,
        issueDate: "2026-11-01",
        dueDate: "2026-11-15",
        currency: "AUD",
        items: [...invoice.items],
      },
      {
        tenantId,
        clientId,
        number: "INV-0002",
        status: "draft" as const,
        issueDate: "2026-11-02",
        dueDate: "2026-11-16",
        currency: "AUD",
        items: [...invoice.items],
      },
    ])
    .returning({ id: invoices.id });
  await database.insert(invoicePayments).values({
    tenantId,
    invoiceId: rows[0]?.id ?? "",
    transactionId: "01890000-0000-7000-8000-000000000001",
    amountMinor: 50000n,
    date: "2026-11-05",
    method: "bank",
  });
  await database.insert(xeroConnections).values({
    tenantId,
    xeroTenantId: "org-1",
    xeroTenantName: "Demo Org",
    refreshTokenEnc: encrypt("rt-1"),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("xero sync", () => {
  it("rotates the refresh token, pushes contact, invoice and payment, then skips unchanged records", async () => {
    const { syncXero, getXeroConnection, forgetAccessToken } = await import("./service");
    const { decrypt } = await import("@/server/crypto");
    forgetAccessToken(tenantId);
    const calls = mockXero({
      "POST identity.xero.com/connect/token": () => ({
        json: { access_token: "at-1", refresh_token: "rt-2", expires_in: 1800 },
      }),
      "GET /Contacts?searchTerm=": () => ({ json: { Contacts: [] } }),
      "POST /Contacts": () => ({ json: { Contacts: [{ ContactID: "c-1" }] } }),
      "POST /Invoices": () => ({ json: { Invoices: [{ InvoiceID: "i-1" }] } }),
      "PUT /Payments": () => ({ json: { Payments: [{ PaymentID: "p-1" }] } }),
    });

    const first = await syncXero(database, tenantId);
    expect(first).toEqual({ contacts: 1, invoices: 1, payments: 1, errors: [] });
    const tokenCall = calls.find((c) => c.url.includes("/connect/token"));
    expect(tokenCall?.body).toContain("refresh_token=rt-1");
    const conn = await getXeroConnection(database, tenantId);
    expect(decrypt(conn?.refreshTokenEnc ?? "")).toBe("rt-2");
    expect(conn?.lastSyncedAt).toBeTruthy();
    expect(conn?.lastError).toBeNull();
    // Drafts stay out; the API got the tenant header.
    const invoiceCall = calls.find((c) => c.url.includes("/Invoices"));
    expect(invoiceCall?.body).toContain("INV-0001");
    expect(invoiceCall?.body).not.toContain("INV-0002");

    calls.length = 0;
    const second = await syncXero(database, tenantId);
    expect(second).toEqual({ contacts: 0, invoices: 0, payments: 0, errors: [] });
    // Cached access token, nothing re-sent.
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([]);
  });

  it("keeps per-record errors and asks for a reconnect when the grant is gone", async () => {
    const { syncXero, getXeroConnection, forgetAccessToken, xeroDueForSync } = await import("./service");
    forgetAccessToken(tenantId);
    mockXero({
      "POST identity.xero.com/connect/token": () => ({ status: 400, json: { error: "invalid_grant" } }),
    });
    const result = await syncXero(database, tenantId);
    expect(result.errors).toEqual([RECONNECT_NEEDED]);
    expect((await getXeroConnection(database, tenantId))?.lastError).toBe(RECONNECT_NEEDED);
    expect(await xeroDueForSync(database, new Date(Date.now() + 2 * 3600_000))).not.toContain(tenantId);
  });
});
