import "server-only";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { aiConfig, billing, type PlanKey } from "@/config";
import { serverEnv } from "@/config/env";
import { t } from "@/i18n";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { invitations, memberships, tenantBilling, tenants } from "@/server/db/schema";
import { str, stripeRequest, verifyWebhook } from "@/server/stripe";
import type { TenantContext } from "@/server/tenancy/context";

/** Platform subscription billing (what a business pays for OmniSuite), on the platform Stripe account. */

export function billingConfigured(): boolean {
  const env = serverEnv();
  return env.STRIPE_SECRET_KEY !== "" && env.STRIPE_WEBHOOK_SECRET !== "";
}

function priceIds(): Record<PlanKey, string> {
  const env = serverEnv();
  return {
    starter: env.STRIPE_PRICE_STARTER,
    growth: env.STRIPE_PRICE_GROWTH,
    scale: env.STRIPE_PRICE_SCALE,
  };
}

export function planForPrice(priceId: string): PlanKey | null {
  if (!priceId) return null;
  const match = Object.entries(priceIds()).find(([, id]) => id === priceId);
  return match ? (match[0] as PlanKey) : null;
}

export function planDef(key: string) {
  return billing.plans.find((p) => p.key === key) ?? null;
}

/** Statuses where the business has a working subscription (Stripe retries a past-due card). */
const LIVE = new Set(["active", "trialing", "past_due"]);

export type BillingView = {
  status: string;
  plan: string;
  live: boolean;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  everSubscribed: boolean;
};

export async function billingView(
  database: DbOrTx,
  tenant: { id: string; plan: string },
): Promise<BillingView> {
  const [row] = await database.select().from(tenantBilling).where(eq(tenantBilling.tenantId, tenant.id));
  const status = row?.status ?? "none";
  return {
    status,
    plan: tenant.plan,
    live: LIVE.has(status),
    currentPeriodEnd: row?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
    hasCustomer: Boolean(row?.stripeCustomerId),
    everSubscribed: Boolean(row?.stripeSubscriptionId),
  };
}

/**
 * Team members the business may have: the subscribed plan's limit, or the first
 * plan's limit while it has no subscription. No limit when billing is off (self-hosted).
 */
export async function memberLimit(
  database: DbOrTx,
  tenant: { id: string; plan: string },
): Promise<number | null> {
  if (!billingConfigured()) return null;
  const view = await billingView(database, tenant);
  const plan = (view.live ? planDef(tenant.plan) : null) ?? billing.plans[0];
  return plan?.maxMembers ?? null;
}

/**
 * AI requests the business may make per day: its plan's allowance (the first plan's
 * while it has no live subscription; 0 = AI not in the plan), or the self-hosted
 * default from src/config/ai.ts when billing is off.
 */
export async function aiDailyLimit(database: DbOrTx, tenant: { id: string; plan: string }): Promise<number> {
  if (!billingConfigured()) return aiConfig.dailyRequestsPerBusiness;
  const view = await billingView(database, tenant);
  const plan = (view.live ? planDef(tenant.plan) : null) ?? billing.plans[0];
  return plan?.aiDailyRequests ?? 0;
}

/** Throws when inviting one more team member would go over the plan's limit. */
export async function assertSeatAvailable(
  database: DbOrTx,
  tenant: { id: string; plan: string },
): Promise<void> {
  const limit = await memberLimit(database, tenant);
  if (limit === null) return;
  const [members] = await database
    .select({ n: count() })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenant.id),
        eq(memberships.kind, "internal"),
        eq(memberships.status, "active"),
      ),
    );
  const [pending] = await database
    .select({ n: count() })
    .from(invitations)
    .where(
      and(
        eq(invitations.tenantId, tenant.id),
        eq(invitations.kind, "internal"),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    );
  if ((members?.n ?? 0) + (pending?.n ?? 0) >= limit) {
    throw new UserError(t("billing.seatLimit", { limit: String(limit) }));
  }
}

/* ─── Checkout and customer portal ────────────────────────────────── */

function secret(): string {
  if (!billingConfigured()) throw new UserError(t("billing.notConfigured"));
  return serverEnv().STRIPE_SECRET_KEY;
}

function billingPageUrl(slug: string, flag?: string): string {
  const url = new URL(`/${slug}/settings/billing/`, serverEnv().APP_URL);
  if (flag) url.searchParams.set(flag, "1");
  return url.toString();
}

/** Stripe Checkout for a new subscription. Returns the URL to send the owner to. */
export async function startSubscriptionCheckout(
  database: DbOrTx,
  ctx: TenantContext,
  planKey: PlanKey,
): Promise<string> {
  const key = secret();
  const price = priceIds()[planKey];
  if (!price) throw new UserError(t("billing.planUnavailable"));
  const view = await billingView(database, ctx.tenant);
  if (view.live) throw new UserError(t("billing.useManage"));
  const [row] = await database.select().from(tenantBilling).where(eq(tenantBilling.tenantId, ctx.tenant.id));
  const session = await stripeRequest<{ url?: string }>(
    key,
    "POST",
    "checkout/sessions",
    {
      mode: "subscription",
      client_reference_id: ctx.tenant.id,
      customer: row?.stripeCustomerId ?? undefined,
      customer_email: row?.stripeCustomerId ? undefined : ctx.user.email,
      line_items: [{ price, quantity: 1 }],
      metadata: { tenantId: ctx.tenant.id },
      subscription_data: {
        metadata: { tenantId: ctx.tenant.id },
        // The free pilot: only for a business that has never subscribed.
        trial_period_days: view.everSubscribed || billing.trialDays === 0 ? undefined : billing.trialDays,
      },
      success_url: billingPageUrl(ctx.tenant.slug, "done"),
      cancel_url: billingPageUrl(ctx.tenant.slug),
    },
    `sub-${ctx.tenant.id}-${planKey}-${Math.floor(Date.now() / 600_000)}`,
  );
  if (!session.url) throw new UserError(t("billing.stripeError"));
  return session.url;
}

/** Stripe's customer portal: change plan, card, invoices, cancel. */
export async function openBillingPortal(database: DbOrTx, ctx: TenantContext): Promise<string> {
  const key = secret();
  const [row] = await database.select().from(tenantBilling).where(eq(tenantBilling.tenantId, ctx.tenant.id));
  if (!row?.stripeCustomerId) throw new UserError(t("billing.noCustomer"));
  const session = await stripeRequest<{ url?: string }>(key, "POST", "billing_portal/sessions", {
    customer: row.stripeCustomerId,
    return_url: billingPageUrl(ctx.tenant.slug),
  });
  if (!session.url) throw new UserError(t("billing.stripeError"));
  return session.url;
}

/* ─── Webhook ─────────────────────────────────────────────────────── */

type Subscription = {
  id: string;
  status: string;
  customer: string | { id: string };
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items: { data: { price: { id: string }; current_period_end?: number }[] };
};

/** Reads the subscription from Stripe (pinned API version) and stores it for the business. */
export async function syncSubscription(
  database: Database,
  tenantId: string,
  subscriptionId: string,
  fetchSub: (id: string) => Promise<Subscription> = (id) =>
    stripeRequest<Subscription>(secret(), "GET", `subscriptions/${encodeURIComponent(id)}`),
): Promise<void> {
  const sub = await fetchSub(subscriptionId);
  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  const plan = planForPrice(item?.price.id ?? "");
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const values = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    status: sub.status,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end) || Boolean(sub.cancel_at),
  };
  await database.transaction(async (tx) => {
    await tx
      .insert(tenantBilling)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: tenantBilling.tenantId, set: values });
    if (plan && LIVE.has(sub.status)) await tx.update(tenants).set({ plan }).where(eq(tenants.id, tenantId));
    await audit(tx, {
      tenantId,
      actorUserId: null,
      action: "billing.subscription",
      entityType: "tenant",
      entityId: tenantId,
      data: { status: sub.status, plan: plan ?? "", subscription: sub.id },
    });
  });
}

async function tenantForSubscription(database: DbOrTx, obj: Record<string, unknown>): Promise<string | null> {
  const metadata = (obj.metadata ?? {}) as Record<string, unknown>;
  const fromMeta = str(metadata, "tenantId");
  if (/^[0-9a-f-]{36}$/.test(fromMeta)) return fromMeta;
  const [row] = await database
    .select({ tenantId: tenantBilling.tenantId })
    .from(tenantBilling)
    .where(eq(tenantBilling.stripeSubscriptionId, str(obj, "id")));
  return row?.tenantId ?? null;
}

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export async function handlePlatformWebhook(
  database: Database,
  rawBody: string,
  signature: string | null,
  fetchSub?: (id: string) => Promise<Subscription>,
): Promise<{ status: 200 | 400; note: string }> {
  if (!billingConfigured()) return { status: 400, note: "billing off" };
  const event = verifyWebhook(rawBody, signature, serverEnv().STRIPE_WEBHOOK_SECRET);
  if (!event) return { status: 400, note: "bad signature" };
  const obj = event.data.object;

  if (event.type === "checkout.session.completed" && str(obj, "mode") === "subscription") {
    const tenantId = str(obj, "client_reference_id");
    const subscriptionId = str(obj, "subscription");
    const [tenant] = await database.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant || !subscriptionId) return { status: 200, note: "unknown business" };
    await syncSubscription(database, tenant.id, subscriptionId, fetchSub);
    return { status: 200, note: "subscribed" };
  }
  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    const tenantId = await tenantForSubscription(database, obj);
    if (!tenantId) return { status: 200, note: "unknown business" };
    const [tenant] = await database.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) return { status: 200, note: "unknown business" };
    await syncSubscription(database, tenant.id, str(obj, "id"), fetchSub);
    return { status: 200, note: "synced" };
  }
  return { status: 200, note: "ignored" };
}

/** For the platform admin list. */
export async function billingStatuses(database: DbOrTx): Promise<Map<string, string>> {
  const rows = await database
    .select({ tenantId: tenantBilling.tenantId, status: tenantBilling.status })
    .from(tenantBilling);
  return new Map(rows.map((r) => [r.tenantId, r.status]));
}
