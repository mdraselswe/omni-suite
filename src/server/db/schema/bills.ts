import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, day, money, pk, ts } from "./columns";
import { user } from "./auth";
import { tenants } from "./core";
import { categories } from "./finance";

const tenantRef = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

/**
 * A supplier's bill the business owes (accounts payable): a contractor's invoice,
 * a software renewal, the team's monthly salaries. Paying it writes expense rows
 * to the ledger (see `billPayments`). What is paid is never stored here: it is the
 * sum of the bill's payments whose ledger row is still live, so a payment reversed
 * anywhere (bill page or ledger) reopens the bill. Status is derived the same way:
 * void when `voidedAt` is set, otherwise open / partially paid / paid by amount.
 */
export const bills = pgTable(
  "bills",
  {
    id: pk(),
    tenantId: tenantRef(),
    /** Free text: suppliers are not a separate list (earlier names are suggested). */
    supplier: text("supplier").notNull(),
    /** The supplier's bill or invoice number, if any. */
    reference: text("reference").notNull().default(""),
    issueDate: day("issue_date").notNull(),
    dueDate: day("due_date").notNull(),
    currency: text("currency").notNull(),
    /** What the bill asks for, tax included (minor units of `currency`). */
    totalMinor: money("total_minor"),
    /** GST/VAT inside `totalMinor` (claimable as it is paid). */
    taxMinor: money("tax_minor"),
    /** Expense category the payments are booked to (null: uncategorised). */
    categoryId: uuid("category_id").references(() => categories.id),
    notes: text("notes").notNull().default(""),
    /** Attached copy of the bill (stored privately; served only to members who can read bills). */
    fileKey: text("file_key"),
    fileName: text("file_name"),
    fileMime: text("file_mime"),
    fileSize: integer("file_size"),
    voidedAt: ts("voided_at"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("bills_tenant_due_idx").on(t.tenantId, t.dueDate),
    index("bills_tenant_supplier_idx").on(t.tenantId, t.supplier),
  ],
);

/** One payment towards a bill: the expense row it wrote to the ledger and the part of the bill it paid. */
export const billPayments = pgTable(
  "bill_payments",
  {
    id: pk(),
    tenantId: tenantRef(),
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id),
    /** The ledger row (kind expense). Reversing it undoes the payment. */
    transactionId: uuid("transaction_id").notNull(),
    /** In the bill's currency (the paying account has the same currency). */
    amountMinor: money("amount_minor"),
    date: day("date").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("bill_payments_bill_idx").on(t.tenantId, t.billId),
    uniqueIndex("bill_payments_transaction_uq").on(t.transactionId),
  ],
);
