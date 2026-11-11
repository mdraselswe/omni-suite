import { boolean, date, index, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, ts, updatedAt } from "./columns";
import { user } from "./auth";
import { accounts } from "./finance";
import { tenants } from "./core";

const tenantKey = () =>
  uuid("tenant_id")
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: "cascade" });

/** A business's own Stripe account, used to take card payments for its invoices. */
export const stripeConnections = pgTable("stripe_connections", {
  id: pk(),
  tenantId: tenantKey(),
  /** AES-256-GCM encrypted secret or restricted key. */
  secretKeyEnc: text("secret_key_enc").notNull(),
  /** AES-256-GCM encrypted webhook signing secret (whsec_…). */
  webhookSecretEnc: text("webhook_secret_enc").notNull(),
  /** Ledger account that online payments are deposited into. */
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  /** "test" or "live", from the key prefix (shown so nobody forgets a test key). */
  mode: text("mode", { enum: ["test", "live"] }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  connectedBy: text("connected_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** The platform's subscription for a business (Stripe Billing on the platform account). */
export const tenantBilling = pgTable("tenant_billing", {
  id: pk(),
  tenantId: tenantKey(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** Stripe subscription status, or "none". */
  status: text("status").notNull().default("none"),
  currentPeriodEnd: ts("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt: updatedAt(),
});

/** A business's Xero organisation (one per business). */
export const xeroConnections = pgTable("xero_connections", {
  id: pk(),
  tenantId: tenantKey(),
  xeroTenantId: text("xero_tenant_id").notNull(),
  xeroTenantName: text("xero_tenant_name").notNull().default(""),
  /** AES-256-GCM encrypted. Xero rotates it on every refresh. */
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  /** Xero account codes and tax types used when pushing invoices and payments. */
  salesAccountCode: text("sales_account_code").notNull().default("200"),
  paymentAccountCode: text("payment_account_code").notNull().default("090"),
  taxType: text("tax_type").notNull().default("OUTPUT"),
  connectedBy: text("connected_by").references(() => user.id, { onDelete: "set null" }),
  lastSyncedAt: ts("last_synced_at"),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

/** Our record → the matching Xero record, so syncs update instead of duplicating. */
export const xeroLinks = pgTable(
  "xero_links",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: ["client", "invoice", "payment"] }).notNull(),
    entityId: uuid("entity_id").notNull(),
    xeroId: text("xero_id").notNull(),
    /** Fingerprint of what was last pushed; unchanged records are skipped. */
    hash: text("hash").notNull().default(""),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.entityType, t.entityId] })],
);

/** AI requests per business per day (for the daily limit). */
export const aiUsage = pgTable(
  "ai_usage",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    requests: integer("requests").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.day] }), index("ai_usage_day_idx").on(t.day)],
);
