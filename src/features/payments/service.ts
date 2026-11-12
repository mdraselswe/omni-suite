import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { insertTransaction, reverseTransactionTx } from "@/features/finance";
import { invoiceBalance, recordPayment } from "@/features/invoices";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { minorDigits } from "@/lib/money";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { decrypt, encrypt } from "@/server/crypto";
import type { Database, DbOrTx } from "@/server/db";
import {
  accounts,
  categories,
  clients,
  invoicePayments,
  invoices,
  stripeConnections,
  tenants,
} from "@/server/db/schema";
import { notify, usersWithPermission } from "@/server/shared";
import {
  keyMode,
  str,
  stripeRequest,
  stripeSupportsDigits,
  StripeError,
  verifyWebhook,
} from "@/server/stripe";
import type { TenantContext } from "@/server/tenancy/context";
import { tenantFromRow } from "@/server/tenancy/service";

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
  const secretKey = input.secretKey.trim() || (current ? decrypt(current.secretKeyEnc, ctx.tenant.id) : "");
  const webhookSecret =
    input.webhookSecret.trim() || (current ? decrypt(current.webhookSecretEnc, ctx.tenant.id) : "");
  const mode = keyMode(secretKey);
  if (!mode) throw new UserError(t("payments.badKey"));
  if (!/^whsec_[A-Za-z0-9]{10,}$/.test(webhookSecret)) throw new UserError(t("payments.badWebhookSecret"));
  const [account] = await database
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, input.accountId),
        eq(accounts.tenantId, ctx.tenant.id),
        eq(accounts.archived, false),
      ),
    );
  if (!account) throw new UserError(t("finance.accountMissing"));
  // Invoices are in the base currency, so online payments must land in a base-currency account.
  if (account.currency !== ctx.tenant.settings.currency) {
    throw new UserError(t("invoices.accountCurrency", { currency: ctx.tenant.settings.currency }));
  }
  if (input.secretKey.trim()) await check(secretKey);

  const values = {
    // Bound to this business: a row copied to another business won't decrypt.
    secretKeyEnc: encrypt(secretKey, ctx.tenant.id),
    webhookSecretEnc: encrypt(webhookSecret, ctx.tenant.id),
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

/**
 * True when a client can pay this currency online: Stripe is on and the money
 * lands in an account of the same currency (a payment can't be booked otherwise).
 */
export async function canPayOnline(database: DbOrTx, tenantId: string, currency: string): Promise<boolean> {
  const [row] = await database
    .select({ enabled: stripeConnections.enabled, currency: accounts.currency })
    .from(stripeConnections)
    .innerJoin(accounts, eq(accounts.id, stripeConnections.accountId))
    .where(eq(stripeConnections.tenantId, tenantId));
  return Boolean(row?.enabled) && row?.currency === currency && stripeSupportsDigits(minorDigits(currency));
}

/* ─── Paying an invoice (client portal) ───────────────────────────── */

async function secretsFor(database: DbOrTx, tenantId: string) {
  const [row] = await database
    .select()
    .from(stripeConnections)
    .where(eq(stripeConnections.tenantId, tenantId));
  if (!row) return null;
  return {
    ...row,
    secretKey: decrypt(row.secretKeyEnc, tenantId),
    webhookSecret: decrypt(row.webhookSecretEnc, tenantId),
  };
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
    .select({
      invoice: invoices,
      clientEmail: sql<string>`coalesce(nullif(${clients.billingEmail}, ''), ${clients.email})`,
    })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(eq(invoices.id, input.invoiceId), eq(invoices.tenantId, ctx.tenant.id)));
  const inv = row?.invoice;
  if (!inv || inv.clientId !== input.clientId) throw new UserError(t("payments.notAvailable"));
  if (inv.status !== "sent" && inv.status !== "partially_paid") throw new UserError(t("invoices.notPayable"));
  const balance = invoiceBalance(inv);
  if (balance <= 0n || !(await canPayOnline(database, ctx.tenant.id, inv.currency))) {
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

/** Calls the webhook makes back to Stripe (replaced in tests). */
export type StripeApi = <T>(secretKey: string, path: string, params?: Record<string, unknown>) => Promise<T>;

const stripeGet: StripeApi = (secretKey, path, params = {}) =>
  stripeRequest(secretKey, "GET", path, params as Parameters<typeof stripeRequest>[3]);

/** The expense category Stripe's fees go to (made on first use). */
async function feeCategory(tx: DbOrTx, tenantId: string): Promise<string> {
  const name = t("payments.feeCategory");
  const [found] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.tenantId, tenantId), eq(categories.kind, "expense"), eq(categories.name, name)))
    .orderBy(asc(categories.createdAt))
    .limit(1);
  if (found) return found.id;
  const [made] = await tx
    .insert(categories)
    .values({ tenantId, kind: "expense", name })
    .returning({ id: categories.id });
  if (!made) throw new Error("Category insert failed");
  return made.id;
}

/**
 * Books Stripe's processing fee for a payment as an expense in the payout
 * account, so the ledger matches what actually lands in the bank. Best effort:
 * if Stripe can't be asked, the payment still counts and the fee is logged.
 */
async function recordStripeFee(
  database: Database,
  tenant: TenantContext["tenant"],
  conn: { secretKey: string; accountId: string },
  paymentIntentId: string,
  invoiceNumber: string,
  date: string,
  api: StripeApi,
): Promise<void> {
  if (!paymentIntentId) return;
  try {
    const intent = await api<{
      latest_charge?:
        { balance_transaction?: { fee?: number; currency?: string } | string | null } | string | null;
    }>(conn.secretKey, `payment_intents/${paymentIntentId}`, {
      expand: ["latest_charge.balance_transaction"],
    });
    const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    const balanceTx = typeof charge?.balance_transaction === "object" ? charge.balance_transaction : null;
    const fee = typeof balanceTx?.fee === "number" ? BigInt(balanceTx.fee) : 0n;
    const [account] = await database
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(eq(accounts.id, conn.accountId));
    if (fee <= 0n || !account || balanceTx?.currency?.toUpperCase() !== account.currency) return;
    await database.transaction(async (tx) => {
      await insertTransaction(
        tx,
        { tenant, user: null },
        {
          kind: "expense",
          accountId: conn.accountId,
          categoryId: await feeCategory(tx, tenant.id),
          date,
          description: t("payments.feeDescription", { number: invoiceNumber }),
          amountMinor: fee,
        },
      );
    });
  } catch (error) {
    await audit(database, {
      tenantId: tenant.id,
      actorUserId: null,
      action: "payments.stripe.feeUnknown",
      entityType: "tenant",
      entityId: tenant.id,
      data: { paymentIntentId, error: error instanceof Error ? error.message : String(error) },
    });
  }
}

/**
 * A refunded card payment: a full refund reverses the payment (the invoice is
 * owed again); a partial refund is flagged to the team to record by hand.
 */
async function handleRefund(
  database: Database,
  tenant: TenantContext["tenant"],
  conn: { secretKey: string },
  charge: Record<string, unknown>,
  api: StripeApi,
): Promise<WebhookResult> {
  const intentId = str(charge, "payment_intent");
  if (!intentId) return { status: 200, note: "no payment intent" };
  const sessions = await api<{ data?: { id?: string }[] }>(conn.secretKey, "checkout/sessions", {
    payment_intent: intentId,
    limit: 1,
  }).catch(() => ({ data: [] }));
  const sessionId = sessions.data?.[0]?.id ?? "";
  const [payment] = sessionId
    ? await database
        .select({ payment: invoicePayments, number: invoices.number })
        .from(invoicePayments)
        .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
        .where(
          and(
            eq(invoicePayments.tenantId, tenant.id),
            eq(invoicePayments.externalRef, sessionId),
            isNull(invoicePayments.reversedAt),
          ),
        )
    : [];
  if (!payment) return { status: 200, note: "unknown or already reversed" };
  const refunded = typeof charge.amount_refunded === "number" ? BigInt(charge.amount_refunded) : 0n;
  const owners = await usersWithPermission(database, tenant.id, "invoices.read");
  // Full refund = the whole charge went back, not just as much as was applied to the
  // invoice: refunding only an overpayment's excess must keep the applied payment.
  const charged = typeof charge.amount === "number" ? BigInt(charge.amount) : null;
  if (charge.refunded === true || (charged !== null && refunded >= charged)) {
    await database.transaction(async (tx) => {
      await reverseTransactionTx(
        tx,
        { tenant, user: null },
        payment.payment.transactionId,
        today(tenant.settings.timezone),
        t("payments.refundReason"),
      );
    });
    await notify(database, tenant.id, owners, {
      title: t("payments.refundedTitle", { number: payment.number }),
      body: t("payments.refundedBody", { number: payment.number }),
      link: `/${tenant.slug}/invoices/${payment.payment.invoiceId}/`,
    });
    return { status: 200, note: "refund reversed" };
  }
  await audit(database, {
    tenantId: tenant.id,
    actorUserId: null,
    action: "payments.stripe.partialRefund",
    entityType: "invoice",
    entityId: payment.payment.invoiceId,
    data: { refunded, paymentId: payment.payment.id },
  });
  await notify(database, tenant.id, owners, {
    title: t("payments.partialRefundTitle", { number: payment.number }),
    body: t("payments.partialRefundBody", { number: payment.number }),
    link: `/${tenant.slug}/invoices/${payment.payment.invoiceId}/`,
  });
  return { status: 200, note: "partial refund flagged" };
}

/**
 * Handles a webhook for one business. A paid Checkout Session records the
 * payment once (the session id is stored as the payment's external reference).
 */
export async function handleTenantWebhook(
  database: Database,
  tenantId: string,
  rawBody: string,
  signature: string | null,
  deps: { api?: StripeApi; rate?: (foreign: string, base: string) => Promise<string | null> } = {},
): Promise<WebhookResult> {
  const api = deps.api ?? stripeGet;
  const conn = await secretsFor(database, tenantId);
  if (!conn) return { status: 400, note: "not connected" };
  const event = verifyWebhook(rawBody, signature, conn.webhookSecret);
  if (!event) return { status: 400, note: "bad signature" };
  if (event.type === "charge.refunded") {
    const [row] = await database.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!row) return { status: 200, note: "unknown tenant" };
    return handleRefund(database, tenantFromRow(row), conn, event.data.object, api);
  }
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
  const externalRef = str(session, "id") || event.id;
  // Stripe redelivers events: once recorded, a repeat is not an "unapplied" payment.
  const [seen] = await database
    .select({ id: invoicePayments.id })
    .from(invoicePayments)
    .where(and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.externalRef, externalRef)));
  if (seen) return { status: 200, note: "already recorded" };
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

  const tenant = tenantFromRow(tenantRow);
  const balance = invoiceBalance(inv);
  // An invoice in another currency needs today's rate to count in the base-currency reports.
  const base = tenant.settings.currency;
  const fxRate =
    inv.currency === base
      ? undefined
      : ((await (deps.rate ?? (async () => null))(inv.currency, base)) ?? undefined);
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
        externalRef,
        fxRate,
      });
      await recordStripeFee(
        database,
        tenant,
        conn,
        str(session, "payment_intent"),
        inv.number,
        today(tenant.settings.timezone),
        api,
      );
      await notify(database, tenantId, await usersWithPermission(database, tenantId, "invoices.read"), {
        title: t("payments.receivedTitle", { number: inv.number }),
        body: t("payments.receivedBody", { number: inv.number }),
        link: `/${tenant.slug}/invoices/${inv.id}/`,
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
