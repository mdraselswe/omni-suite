import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, day, money, pk, ts } from "./columns";
import { user } from "./auth";
import { tenants } from "./core";

const tenantRef = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

export const accounts = pgTable(
  "accounts",
  {
    id: pk(),
    tenantId: tenantRef(),
    name: text("name").notNull(),
    type: text("type", { enum: ["bank", "cash", "wallet", "card"] }).notNull(),
    currency: text("currency").notNull(),
    openingBalanceMinor: money("opening_balance_minor"),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("accounts_tenant_idx").on(t.tenantId)],
);

export const categories = pgTable(
  "categories",
  {
    id: pk(),
    tenantId: tenantRef(),
    kind: text("kind", { enum: ["income", "expense"] }).notNull(),
    name: text("name").notNull(),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("categories_tenant_idx").on(t.tenantId, t.kind)],
);

/**
 * Append-only money ledger. `amountMinor` is always positive; `kind` gives the
 * direction. Corrections are new rows with `reversesId` set.
 * - income / expense: count towards profit
 * - transfer: moves money between accounts (toAccountId)
 * - capital_in: partner capital paid in (equity, not income)
 * - drawing: money paid out to a partner (equity, not expense)
 */
export const transactions = pgTable(
  "transactions",
  {
    id: pk(),
    tenantId: tenantRef(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    toAccountId: uuid("to_account_id").references(() => accounts.id),
    kind: text("kind", { enum: ["income", "expense", "transfer", "capital_in", "drawing"] }).notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    date: day("date").notNull(),
    description: text("description").notNull().default(""),
    /** In the account's currency. */
    amountMinor: money("amount_minor"),
    currency: text("currency").notNull(),
    /** Same amount in the tenant's base currency (rate on the date). */
    baseAmountMinor: money("base_amount_minor"),
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }).notNull().default("1"),
    partnerId: uuid("partner_id"),
    clientId: uuid("client_id"),
    invoiceId: uuid("invoice_id"),
    receiptFileId: uuid("receipt_file_id"),
    reversesId: uuid("reverses_id"),
    reversedAt: ts("reversed_at"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("transactions_tenant_date_idx").on(t.tenantId, t.date),
    index("transactions_tenant_account_idx").on(t.tenantId, t.accountId),
    index("transactions_tenant_kind_date_idx").on(t.tenantId, t.kind, t.date),
    index("transactions_tenant_to_account_idx").on(t.tenantId, t.toAccountId),
    index("transactions_tenant_partner_idx").on(t.tenantId, t.partnerId),
    // A row can be reversed once.
    uniqueIndex("transactions_reverses_uq")
      .on(t.reversesId)
      .where(sql`${t.reversesId} is not null`),
  ],
);

export const periods = pgTable(
  "periods",
  {
    id: pk(),
    tenantId: tenantRef(),
    startDate: day("start_date").notNull(),
    endDate: day("end_date").notNull(),
    closedAt: ts("closed_at"),
    closedBy: text("closed_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("periods_tenant_idx").on(t.tenantId, t.startDate)],
);

export const partners = pgTable(
  "partners",
  {
    id: pk(),
    tenantId: tenantRef(),
    /** The partner's membership, if they use the app. */
    membershipId: uuid("membership_id"),
    name: text("name").notNull(),
    email: text("email").notNull().default(""),
    joinedOn: day("joined_on").notNull(),
    leftOn: day("left_on"),
    createdAt: createdAt(),
  },
  (t) => [index("partners_tenant_idx").on(t.tenantId)],
);

export const capitalContributions = pgTable(
  "capital_contributions",
  {
    id: pk(),
    tenantId: tenantRef(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id),
    date: day("date").notNull(),
    kind: text("kind", { enum: ["cash", "asset", "work"] }).notNull(),
    /** Base currency. */
    amountMinor: money("amount_minor"),
    description: text("description").notNull().default(""),
    transactionId: uuid("transaction_id"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("capital_tenant_partner_idx").on(t.tenantId, t.partnerId, t.date)],
);

/** Units held by a partner from `effectiveFrom` until `effectiveTo` (exclusive). */
export const ownershipPeriods = pgTable(
  "ownership_periods",
  {
    id: pk(),
    tenantId: tenantRef(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id),
    units: money("units"),
    effectiveFrom: day("effective_from").notNull(),
    effectiveTo: day("effective_to"),
    eventId: uuid("event_id").notNull(),
  },
  (t) => [index("ownership_tenant_idx").on(t.tenantId, t.effectiveFrom)],
);

export const ownershipEvents = pgTable(
  "ownership_events",
  {
    id: pk(),
    tenantId: tenantRef(),
    type: text("type", { enum: ["initial", "investment", "transfer", "adjustment"] }).notNull(),
    date: day("date").notNull(),
    data: jsonb("data").notNull().default({}),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("ownership_events_tenant_idx").on(t.tenantId, t.date)],
);

export const profitRules = pgTable(
  "profit_rules",
  {
    id: pk(),
    tenantId: tenantRef(),
    version: integer("version").notNull(),
    effectiveFrom: day("effective_from").notNull(),
    status: text("status", { enum: ["proposed", "active", "rejected", "superseded"] }).notNull(),
    config: jsonb("config").notNull(),
    note: text("note").notNull().default(""),
    proposedBy: text("proposed_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("profit_rules_tenant_idx").on(t.tenantId, t.effectiveFrom)],
);

export const profitRuleApprovals = pgTable(
  "profit_rule_approvals",
  {
    id: pk(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => profitRules.id, { onDelete: "cascade" }),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id),
    decision: text("decision", { enum: ["approved", "rejected"] }).notNull(),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("profit_rule_approvals_rule_partner_uq").on(t.ruleId, t.partnerId)],
);

export const distributionRuns = pgTable(
  "distribution_runs",
  {
    id: pk(),
    tenantId: tenantRef(),
    periodStart: day("period_start").notNull(),
    periodEnd: day("period_end").notNull(),
    status: text("status", { enum: ["draft", "final"] }).notNull(),
    /** Everything used for the calculation, so history never shifts. */
    inputs: jsonb("inputs").notNull(),
    result: jsonb("result").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("distribution_runs_tenant_idx").on(t.tenantId, t.periodStart)],
);
