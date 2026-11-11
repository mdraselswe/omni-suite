import "server-only";
import { and, eq } from "drizzle-orm";
import { recordPayment } from "@/features/invoices";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { minorDigits } from "@/lib/money";
import { parseTenantSettings } from "@/lib/tenant-settings";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { decrypt, encrypt } from "@/server/crypto";
import type { Database, DbOrTx } from "@/server/db";
import { accounts, clients, invoices, stripeConnections, tenants } from "@/server/db/schema";
import {
  keyMode,
  str,
  stripeRequest,
  stripeSupportsDigits,
  StripeError,
  verifyWebhook,
} from "@/server/stripe";
import type { TenantContext } from "@/server/tenancy/context";

/* ─── Connection (Settings → Online payments) ─────────────────────── */

export type StripeConnectionView = {
  mode: "test" | "live";
  accountId: string;
  enabled: boolean;
  updatedAt: Date;
};

export async function stripeConnection(
  database: DbOrTx,
  tenantId: string,
): Promise<StripeConnectionView | null> {
  const [row] = await database
    .select({
      mode: stripeConnections.mode,
      accountId: stripeConnections.accountId,
      enabled: stripeConnections.enabled,
      updatedAt: stripeConnections.updatedAt,
    })
    .from(stripeConnections)
    .where(eq(stripeConnections.tenantId, tenantId));
  return row ?? null;
}

/** Checks the key with Stripe (it must be able to read Checkout Sessions). */
async function assertKeyWorks(secretKey: string): Promise<void> {
  try {
    await stripeRequest(secretKey, "GET", "checkout/sessions", { limit: 1 });
  } catch (error) {
    if (error instanceof StripeError)
      throw new UserError(t("payments.keyRejected", { reason: error.message }));
    throw new UserError(t("payments.stripeUnreachable"));
  }
}

export async function saveStripeConnection(
  database: Database,
  ctx: TenantContext,
  input: { secretKey: string; webhookSecret: string; accountId: string; enabled: boolean },
  check: (key: string) => Promise<void> = assertKeyWorks,
): Promise<void> {
  const existing = await database
    .select()
    .from(stripeConnections)
    .where(eq(stripeConnections.tenantId, ctx.tenant.id));
  const current = existing[0];
  // Blank secret fields keep what is stored (they are never sent back to the browser).
  const secretKey = input.secretKey.trim() || (current ? decrypt(current.secretKeyEnc) : "");
  const webhookSecret = input.webhookSecret.trim() || (current ? decrypt(current.webhookSecretEnc) : "");
  const mode = keyMode(secretKey);
  if (!mode) throw new UserError(t("payments.badKey"));
  if (!/^whsec_[A-Za-z0-9]{10,}$/.test(webhookSecret)) throw new UserError(t("payments.badWebhookSecret"));
  const [account] = await database
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, input.accountId),
        eq(accounts.tenantId, ctx.tenant.id),
        eq(accounts.archived, false),
      ),
    );
  if (!account) throw new UserError(t("finance.accountMissing"));
  if (input.secretKey.trim()) await check(secretKey);

  const values = {
    secretKeyEnc: encrypt(secretKey),
    webhookSecretEnc: encrypt(webhookSecret),
    accountId: account.id,
    mode,
    enabled: input.enabled,
    connectedBy: ctx.user.id,
  };
  await database.transaction(async (tx) => {
    await tx
      .insert(stripeConnections)
      .values({ tenantId: ctx.tenant.id, ...values })
      .onConflictDoUpdate({ target: stripeConnections.tenantId, set: values });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "payments.stripe.save",
      entityType: "tenant",
      entityId: ctx.tenant.id,
      data: { mode, enabled: input.enabled },
    });
  });
}

export async function disconnectStripe(database: Database, ctx: TenantContext): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.delete(stripeConnections).where(eq(stripeConnections.tenantId, ctx.tenant.id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "payments.stripe.disconnect",
      entityType: "tenant",
      entityId: ctx.tenant.id,
      data: {},
    });
  });
}

/** True when a client can pay this currency online for the tenant. */
export async function canPayOnline(database: DbOrTx, tenantId: string, currency: string): Promise<boolean> {
  const conn = await stripeConnection(database, tenantId);
  return Boolean(conn?.enabled) && stripeSupportsDigits(minorDigits(currency));
}

/* ─── Paying an invoice (client portal) ───────────────────────────── */

async function secretsFor(database: DbOrTx, tenantId: string) {
  const [row] = await database
    .select()
    .from(stripeConnections)
    .where(eq(stripeConnections.tenantId, tenantId));
  if (!row) return null;
  return { ...row, secretKey: decrypt(row.secretKeyEnc), webhookSecret: decrypt(row.webhookSecretEnc) };
}

/**
 * Creates a Stripe Checkout Session for what is still owed on an invoice and
 * returns its URL. `returnUrl` is where Stripe sends the client back.
 */
export async function startInvoiceCheckout(
  database: DbOrTx,
  ctx: TenantContext,
  input: { invoiceId: string; clientId: string; returnUrl: string },
): Promise<string> {
  const conn = await secretsFor(database, ctx.tenant.id);
  if (!conn?.enabled) throw new UserError(t("payments.notAvailable"));
  const [row] = await database
    .select({ invoice: invoices, clientEmail: clients.email })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(eq(invoices.id, input.invoiceId), eq(invoices.tenantId, ctx.tenant.id)));
  const inv = row?.invoice;
  if (!inv || inv.clientId !== input.clientId) throw new UserError(t("payments.notAvailable"));
  if (inv.status !== "sent" && inv.status !== "partially_paid") throw new UserError(t("invoices.notPayable"));
  const balance = inv.totalMinor - inv.paidMinor;
  if (balance <= 0n || !stripeSupportsDigits(minorDigits(inv.currency))) {
    throw new UserError(t("payments.notAvailable"));
  }
  const business = ctx.tenant.settings.branding.displayName || ctx.tenant.name;
  const back = new URL(input.returnUrl);
  const success = new URL(back);
  success.searchParams.set("paid", "1");
  const cancel = new URL(back);
  cancel.searchParams.set("cancelled", "1");
  const session = await stripeRequest<{ url?: string }>(
    conn.secretKey,
    "POST",
    "checkout/sessions",
    {
      mode: "payment",
      client_reference_id: inv.id,
      customer_email: row.clientEmail || undefined,
      success_url: success.toString(),
      cancel_url: cancel.toString(),
      metadata: { invoiceId: inv.id, tenantId: ctx.tenant.id },
      payment_intent_data: {
        description: `${business} ${inv.number}`,
        metadata: { invoiceId: inv.id, tenantId: ctx.tenant.id },
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: inv.currency.toLowerCase(),
            unit_amount: balance.toString(),
            product_data: { name: t("payments.lineName", { number: inv.number, business }) },
          },
        },
      ],
    },
    // Same invoice + same balance within Stripe's idempotency window → same session.
    `inv-${inv.id}-${balance.toString()}-${Math.floor(Date.now() / 600_000)}`,
  );
  if (!session.url) throw new UserError(t("payments.stripeUnreachable"));
  return session.url;
}

/* ─── Webhook (Stripe → app) ──────────────────────────────────────── */

export type WebhookResult = { status: 200 | 400; note: string };

/**
 * Handles a webhook for one business. A paid Checkout Session records the
 * payment once (the session id is stored as the payment's external reference).
 */
export async function handleTenantWebhook(
  database: Database,
  tenantId: string,
  rawBody: string,
  signature: string | null,
): Promise<WebhookResult> {
  const conn = await secretsFor(database, tenantId);
  if (!conn) return { status: 400, note: "not connected" };
  const event = verifyWebhook(rawBody, signature, conn.webhookSecret);
  if (!event) return { status: 400, note: "bad signature" };
  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return { status: 200, note: "ignored" };
  }
  const session = event.data.object;
  const metadata = (session.metadata ?? {}) as Record<string, unknown>;
  if (str(session, "payment_status") !== "paid" || str(metadata, "tenantId") !== tenantId) {
    return { status: 200, note: "not paid" };
  }
  const invoiceId = str(metadata, "invoiceId");
  const amount = typeof session.amount_total === "number" ? BigInt(session.amount_total) : 0n;
  const [tenantRow] = await database.select().from(tenants).where(eq(tenants.id, tenantId));
  const [inv] = await database
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));
  if (!tenantRow || !inv || amount <= 0n) return { status: 200, note: "unknown invoice" };
  if (str(session, "currency").toUpperCase() !== inv.currency)
    return { status: 200, note: "currency mismatch" };

  const tenant = {
    id: tenantRow.id,
    slug: tenantRow.slug,
    name: tenantRow.name,
    status: tenantRow.status,
    plan: tenantRow.plan,
    settings: parseTenantSettings(tenantRow.settings),
  };
  const balance = inv.totalMinor - inv.paidMinor;
  // Paid by hand in the meantime: record what is still owed; the rest is logged for a refund.
  const applied = amount > balance ? balance : amount;
  let unapplied = amount - applied;
  if (applied > 0n) {
    try {
      await recordPayment(database, { tenant, user: null }, inv.id, {
        amountMinor: applied,
        date: today(tenant.settings.timezone),
        accountId: conn.accountId,
        method: "stripe",
        categoryId: null,
        externalRef: str(session, "id") || event.id,
      });
    } catch (error) {
      // Voided invoice or closed period: retrying won't help, so log it for a person to sort out.
      if (!(error instanceof UserError)) throw error;
      unapplied = amount;
    }
  }
  if (unapplied > 0n) {
    await audit(database, {
      tenantId,
      actorUserId: null,
      action: "payments.stripe.unapplied",
      entityType: "invoice",
      entityId: inv.id,
      data: { received: amount, unapplied, session: str(session, "id") },
    });
  }
  return { status: 200, note: "recorded" };
}
