/** Pure bill rules, shared by the service, pages and tests. */

export const BILL_STATUSES = ["open", "partially_paid", "paid", "void"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

/** List filters: "open" covers part-paid bills too; "overdue" is open and past due. */
export const BILL_FILTERS = ["open", "overdue", "paid", "void"] as const;
export type BillFilterStatus = (typeof BILL_FILTERS)[number];

type Amounts = { totalMinor: bigint; paidMinor: bigint; voidedAt: Date | null };

/** Void when cancelled, otherwise by what live payments cover. */
export function billStatus(bill: Amounts): BillStatus {
  if (bill.voidedAt) return "void";
  if (bill.paidMinor >= bill.totalMinor) return "paid";
  return bill.paidMinor > 0n ? "partially_paid" : "open";
}

/** What is still owed: nothing on void bills, never below zero. */
export function billBalance(bill: Amounts): bigint {
  if (bill.voidedAt) return 0n;
  const owed = bill.totalMinor - bill.paidMinor;
  return owed > 0n ? owed : 0n;
}

/** Status to show: "overdue" when something is still owed after the due date. */
export function billDisplayStatus(
  bill: Amounts & { dueDate: string },
  today: string,
): BillStatus | "overdue" {
  const status = billStatus(bill);
  return (status === "open" || status === "partially_paid") && bill.dueDate < today ? "overdue" : status;
}
