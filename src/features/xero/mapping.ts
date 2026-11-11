import { createHash } from "node:crypto";
import type { LineItem } from "@/lib/line-items";
import { toDecimalString } from "@/lib/money";

/**
 * Pure OmniSuite → Xero payload mapping (Accounting API). No I/O here so it is
 * easy to test; the sync loop in ./service.ts does the calls.
 */

/** Xero tax type for lines without GST (Australia: "GST Free Income"). */
export const GST_FREE_TAX_TYPE = "EXEMPTOUTPUT";

/** Records per request: Xero accepts batches, 50 keeps each request small. */
export const BATCH_SIZE = 50;

/** Stored in xero_connections.last_error when the grant is gone and the owner must reconnect. */
export const RECONNECT_NEEDED = "reconnect-needed";

export type XeroSettings = { salesAccountCode: string; paymentAccountCode: string; taxType: string };

export type ClientForXero = { id: string; name: string; email: string; phone: string };

export type InvoiceForXero = {
  id: string;
  number: string;
  status: "draft" | "sent" | "partially_paid" | "paid" | "void";
  issueDate: string;
  dueDate: string;
  currency: string;
  items: readonly LineItem[];
};

export type PaymentForXero = {
  id: string;
  invoiceId: string;
  amountMinor: bigint;
  date: string;
  method: string;
};

export type XeroContact = {
  ContactID?: string;
  Name: string;
  EmailAddress: string;
  Phones?: { PhoneType: "DEFAULT"; PhoneNumber: string }[];
};

export type XeroLine = {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  AccountCode: string;
  TaxType: string;
};

export type XeroInvoice = {
  InvoiceID?: string;
  Type: "ACCREC";
  Contact: { ContactID: string };
  InvoiceNumber: string;
  Date: string;
  DueDate: string;
  CurrencyCode: string;
  LineAmountTypes: "Exclusive" | "Inclusive";
  Status: "AUTHORISED" | "VOIDED";
  LineItems: XeroLine[];
};

export type XeroPayment = {
  Invoice: { InvoiceID: string };
  Account: { Code: string };
  Date: string;
  Amount: number;
  Reference: string;
};

/** Short, stable fingerprint of what we send, so unchanged records are skipped. */
export function hashOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const money = (minor: bigint, currency: string) => Number(toDecimalString(minor, currency));

export function contactPayload(client: ClientForXero, contactId?: string): XeroContact {
  return {
    ...(contactId ? { ContactID: contactId } : {}),
    Name: client.name.trim().slice(0, 255),
    EmailAddress: client.email.trim(),
    ...(client.phone.trim() ? { Phones: [{ PhoneType: "DEFAULT", PhoneNumber: client.phone.trim() }] } : {}),
  };
}

/**
 * Drafts never go to Xero; a void invoice goes only to void one Xero already has.
 * Paid status isn't sent: Xero derives it from the payments we push.
 */
export function shouldSyncInvoice(invoice: Pick<InvoiceForXero, "status">, linked: boolean): boolean {
  if (invoice.status === "draft") return false;
  if (invoice.status === "void") return linked;
  return true;
}

export function invoicePayload(
  invoice: InvoiceForXero,
  opts: { contactId: string; pricesIncludeTax: boolean; settings: XeroSettings; invoiceId?: string },
): XeroInvoice {
  return {
    ...(opts.invoiceId ? { InvoiceID: opts.invoiceId } : {}),
    Type: "ACCREC",
    Contact: { ContactID: opts.contactId },
    InvoiceNumber: invoice.number,
    Date: invoice.issueDate,
    DueDate: invoice.dueDate,
    CurrencyCode: invoice.currency.toUpperCase(),
    LineAmountTypes: opts.pricesIncludeTax ? "Inclusive" : "Exclusive",
    Status: invoice.status === "void" ? "VOIDED" : "AUTHORISED",
    LineItems: invoice.items.map((item) => ({
      Description: item.description,
      Quantity: Number(item.quantity),
      UnitAmount: money(BigInt(item.unitPriceMinor), invoice.currency),
      AccountCode: opts.settings.salesAccountCode,
      TaxType: item.taxRateBp > 0 ? opts.settings.taxType : GST_FREE_TAX_TYPE,
    })),
  };
}

/** The hash ignores Xero ids so linking a record doesn't make it look changed. */
export function invoiceHash(payload: XeroInvoice): string {
  // JSON.stringify drops undefined keys.
  return hashOf({ ...payload, InvoiceID: undefined });
}

export function contactHash(payload: XeroContact): string {
  return hashOf({ ...payload, ContactID: undefined });
}

export function paymentPayload(
  payment: PaymentForXero,
  opts: { xeroInvoiceId: string; currency: string; accountCode: string },
): XeroPayment {
  return {
    Invoice: { InvoiceID: opts.xeroInvoiceId },
    Account: { Code: opts.accountCode },
    Date: payment.date,
    Amount: money(payment.amountMinor, opts.currency),
    Reference: payment.method.slice(0, 255),
  };
}

/** Xero account codes are short alphanumerics; tax types are UPPER_CASE words. */
export const ACCOUNT_CODE = /^[A-Za-z0-9._-]{1,10}$/;
export const TAX_TYPE = /^[A-Z0-9_]{2,40}$/;
