import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { decrypt, encrypt } from "@/server/crypto";
import type { Database, DbOrTx } from "@/server/db";
import { clients, invoicePayments, invoices, tenants, xeroConnections, xeroLinks } from "@/server/db/schema";
import { enqueue } from "@/server/jobs/queue";
import { refreshTokens, revokeToken, XeroAuthError, xeroApi } from "@/server/xero";
import {
  BATCH_SIZE,
  chunk,
  contactHash,
  contactPayload,
  invoiceHash,
  invoicePayload,
  PAYMENT_DELETED,
  paymentPayload,
  RECONNECT_NEEDED,
  shouldSyncInvoice,
  type XeroContact,
  type XeroInvoice,
  type XeroPayment,
  type XeroSettings,
} from "./mapping";

export async function getXeroConnection(database: DbOrTx, tenantId: string) {
  const [row] = await database.select().from(xeroConnections).where(eq(xeroConnections.tenantId, tenantId));
  return row ?? null;
}

/* ─── Access tokens ─────────────────────────────────────────────── */

const accessCache = new Map<string, { token: string; until: number }>();

function remember(tenantId: string, token: string, expiresIn: number): void {
  accessCache.set(tenantId, { token, until: Date.now() + (expiresIn - 120) * 1000 });
}

/** Test hook and used on connect/disconnect. */
export function forgetAccessToken(tenantId: string): void {
  accessCache.delete(tenantId);
}

/**
 * A valid access token for the business. Xero refresh tokens are single-use, so the
 * refresh happens with the connection row locked and the new token is saved before
 * anything uses the access token (two workers can never spend the same refresh token).
 */
export async function xeroAccessToken(database: Database, tenantId: string): Promise<string> {
  const hit = accessCache.get(tenantId);
  if (hit && hit.until > Date.now()) return hit.token;
  return database.transaction(async (tx) => {
    const [conn] = await tx
      .select()
      .from(xeroConnections)
      .where(eq(xeroConnections.tenantId, tenantId))
      .for("update");
    if (!conn) throw new Error("Xero is not connected");
    // Another worker may have refreshed while we waited for the lock.
    const fresh = accessCache.get(tenantId);
    if (fresh && fresh.until > Date.now()) return fresh.token;
    // Bound to the business (AAD): a token row copied to another business won't decrypt.
    const tokens = await refreshTokens(decrypt(conn.refreshTokenEnc, tenantId));
    await tx
      .update(xeroConnections)
      .set({ refreshTokenEnc: encrypt(tokens.refreshToken, tenantId) })
      .where(eq(xeroConnections.id, conn.id));
    remember(tenantId, tokens.accessToken, tokens.expiresIn);
    return tokens.accessToken;
  });
}

/* ─── Connect / settings / disconnect ───────────────────────────── */

export async function saveXeroConnection(
  database: Database,
  input: {
    tenantId: string;
    userId: string;
    xeroTenantId: string;
    xeroTenantName: string;
    refreshToken: string;
    accessToken: string;
    expiresIn: number;
  },
): Promise<void> {
  await database.transaction(async (tx) => {
    const existing = await getXeroConnection(tx, input.tenantId);
    // A different organisation means the old links point at the wrong books.
    if (existing && existing.xeroTenantId !== input.xeroTenantId) {
      await tx.delete(xeroLinks).where(eq(xeroLinks.tenantId, input.tenantId));
    }
    const values = {
      xeroTenantId: input.xeroTenantId,
      xeroTenantName: input.xeroTenantName,
      refreshTokenEnc: encrypt(input.refreshToken, input.tenantId),
      connectedBy: input.userId,
      lastError: null,
    };
    await tx
      .insert(xeroConnections)
      .values({ tenantId: input.tenantId, ...values })
      .onConflictDoUpdate({ target: xeroConnections.tenantId, set: values });
    await audit(tx, {
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: "xero.connect",
      entityType: "xero",
      data: { organisation: input.xeroTenantName },
    });
    await enqueue(tx, {
      type: "xero.sync",
      tenantId: input.tenantId,
      dedupeKey: `xero.sync:${input.tenantId}`,
    });
  });
  remember(input.tenantId, input.accessToken, input.expiresIn);
}

export async function updateXeroSettings(
  database: Database,
  tenantId: string,
  userId: string,
  settings: XeroSettings,
): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .update(xeroConnections)
      .set(settings)
      .where(eq(xeroConnections.tenantId, tenantId))
      .returning({ id: xeroConnections.id });
    if (!row) throw new Error("Xero is not connected");
    await audit(tx, {
      tenantId,
      actorUserId: userId,
      action: "xero.settings",
      entityType: "xero",
      data: settings,
    });
  });
}

export async function disconnectXero(database: Database, tenantId: string, userId: string): Promise<void> {
  const conn = await getXeroConnection(database, tenantId);
  if (!conn) return;
  // Revoking the refresh token also removes the app's connection in Xero.
  await revokeToken(decrypt(conn.refreshTokenEnc, tenantId));
  await database.transaction(async (tx) => {
    await tx.delete(xeroLinks).where(eq(xeroLinks.tenantId, tenantId));
    await tx.delete(xeroConnections).where(eq(xeroConnections.tenantId, tenantId));
    await audit(tx, { tenantId, actorUserId: userId, action: "xero.disconnect", entityType: "xero" });
  });
  forgetAccessToken(tenantId);
}

/** Connections that are due for the hourly sync (skips ones waiting for a reconnect). */
export async function xeroDueForSync(database: DbOrTx, now: Date): Promise<string[]> {
  const hourAgo = new Date(now.getTime() - 3600_000);
  const rows = await database
    .select({
      tenantId: xeroConnections.tenantId,
      lastSyncedAt: xeroConnections.lastSyncedAt,
      lastError: xeroConnections.lastError,
    })
    .from(xeroConnections)
    .innerJoin(tenants, eq(tenants.id, xeroConnections.tenantId))
    // Suspended businesses don't sync.
    .where(eq(tenants.status, "active"));
  return rows
    .filter((r) => r.lastError !== RECONNECT_NEEDED && (!r.lastSyncedAt || r.lastSyncedAt < hourAgo))
    .map((r) => r.tenantId);
}

/* ─── Sync (OmniSuite → Xero, one way) ──────────────────────────── */

type Link = { entityId: string; xeroId: string; hash: string };
type ItemResult = { ValidationErrors?: { Message?: string }[]; StatusAttributeString?: string };

function itemError(item: ItemResult | undefined): string | null {
  if (!item) return "No response from Xero";
  const messages = (item.ValidationErrors ?? []).map((e) => e.Message ?? "").filter(Boolean);
  if (messages.length > 0) return messages.join("; ");
  return item.StatusAttributeString === "ERROR" ? "Rejected by Xero" : null;
}

async function linksOf(database: DbOrTx, tenantId: string, type: "client" | "invoice" | "payment") {
  const rows = await database
    .select({ entityId: xeroLinks.entityId, xeroId: xeroLinks.xeroId, hash: xeroLinks.hash })
    .from(xeroLinks)
    .where(and(eq(xeroLinks.tenantId, tenantId), eq(xeroLinks.entityType, type)));
  return new Map<string, Link>(rows.map((r) => [r.entityId, r]));
}

async function saveLink(
  database: DbOrTx,
  tenantId: string,
  entityType: "client" | "invoice" | "payment",
  entityId: string,
  xeroId: string,
  hash: string,
): Promise<void> {
  const set = { xeroId, hash, syncedAt: new Date() };
  await database
    .insert(xeroLinks)
    .values({ tenantId, entityType, entityId, ...set })
    .onConflictDoUpdate({ target: [xeroLinks.tenantId, xeroLinks.entityType, xeroLinks.entityId], set });
}

export type SyncResult = { contacts: number; invoices: number; payments: number; errors: string[] };

/**
 * Pushes contacts, invoices and payments that changed since the last sync.
 * Records that Xero rejects are reported in last_error and retried next time.
 */
export async function syncXero(database: Database, tenantId: string): Promise<SyncResult> {
  const conn = await getXeroConnection(database, tenantId);
  const result: SyncResult = { contacts: 0, invoices: 0, payments: 0, errors: [] };
  if (!conn) return result;
  try {
    const token = await xeroAccessToken(database, tenantId);
    const api = <T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown) =>
      xeroApi<T>(token, conn.xeroTenantId, method, path, body);
    const settings: XeroSettings = {
      salesAccountCode: conn.salesAccountCode,
      paymentAccountCode: conn.paymentAccountCode,
      taxType: conn.taxType,
    };

    const invoiceLinks = await linksOf(database, tenantId, "invoice");
    const rows = await database
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), ne(invoices.status, "draft")));
    const toSync = rows.filter((inv) => shouldSyncInvoice(inv, invoiceLinks.has(inv.id)));

    /* Contacts for the clients on those invoices. */
    const clientIds = [...new Set(toSync.map((inv) => inv.clientId))];
    const clientLinks = await linksOf(database, tenantId, "client");
    const clientRows =
      clientIds.length === 0
        ? []
        : await database
            .select({
              id: clients.id,
              name: clients.name,
              // Xero sends invoices to the contact's email: the billing one when set.
              email: sql<string>`coalesce(nullif(${clients.billingEmail}, ''), ${clients.email})`,
              phone: clients.phone,
            })
            .from(clients)
            .where(and(eq(clients.tenantId, tenantId), inArray(clients.id, clientIds)));
    const pendingContacts: { clientId: string; payload: XeroContact; hash: string }[] = [];
    for (const client of clientRows) {
      let contactId = clientLinks.get(client.id)?.xeroId;
      if (!contactId) {
        // Xero contact names are unique: reuse a contact the business already has.
        const found = await api<{ Contacts?: { ContactID: string; Name: string }[] }>(
          "GET",
          `/Contacts?searchTerm=${encodeURIComponent(client.name.trim())}`,
        );
        contactId = found.Contacts?.find(
          (c) => c.Name.trim().toLowerCase() === client.name.trim().toLowerCase(),
        )?.ContactID;
      }
      const payload = contactPayload(client, contactId);
      const hash = contactHash(payload);
      const link = clientLinks.get(client.id);
      if (link && link.hash === hash) continue;
      pendingContacts.push({ clientId: client.id, payload, hash });
    }
    for (const batch of chunk(pendingContacts, BATCH_SIZE)) {
      const res = await api<{ Contacts?: (ItemResult & { ContactID?: string })[] }>(
        "POST",
        "/Contacts?summarizeErrors=false",
        { Contacts: batch.map((b) => b.payload) },
      );
      for (const [i, pending] of batch.entries()) {
        const item = res.Contacts?.[i];
        const error = itemError(item);
        if (error || !item?.ContactID) {
          result.errors.push(`${pending.payload.Name}: ${error ?? "no id"}`);
          continue;
        }
        await saveLink(database, tenantId, "client", pending.clientId, item.ContactID, pending.hash);
        clientLinks.set(pending.clientId, {
          entityId: pending.clientId,
          xeroId: item.ContactID,
          hash: pending.hash,
        });
        result.contacts++;
      }
    }

    /* Invoices. */
    const pendingInvoices: { invoiceId: string; payload: XeroInvoice; hash: string }[] = [];
    for (const inv of toSync) {
      const contactId = clientLinks.get(inv.clientId)?.xeroId;
      if (!contactId) continue; // its contact failed above; reported there
      const link = invoiceLinks.get(inv.id);
      // Each invoice keeps the tax setting it was made with, even if the business changed it later.
      const payload = invoicePayload(inv, {
        contactId,
        pricesIncludeTax: inv.pricesIncludeTax,
        settings,
        invoiceId: link?.xeroId,
      });
      const hash = invoiceHash(payload);
      if (link && link.hash === hash) continue;
      pendingInvoices.push({ invoiceId: inv.id, payload, hash });
    }
    for (const batch of chunk(pendingInvoices, BATCH_SIZE)) {
      const res = await api<{ Invoices?: (ItemResult & { InvoiceID?: string })[] }>(
        "POST",
        "/Invoices?summarizeErrors=false",
        { Invoices: batch.map((b) => b.payload) },
      );
      for (const [i, pending] of batch.entries()) {
        const item = res.Invoices?.[i];
        const error = itemError(item);
        if (error || !item?.InvoiceID) {
          result.errors.push(`${pending.payload.InvoiceNumber}: ${error ?? "no id"}`);
          continue;
        }
        await saveLink(database, tenantId, "invoice", pending.invoiceId, item.InvoiceID, pending.hash);
        invoiceLinks.set(pending.invoiceId, {
          entityId: pending.invoiceId,
          xeroId: item.InvoiceID,
          hash: pending.hash,
        });
        result.invoices++;
      }
    }

    /*
     * Payments. Xero can't edit a payment, so each one is created once. A payment
     * reversed here is never sent; one Xero already has is deleted there.
     */
    const paymentLinks = await linksOf(database, tenantId, "payment");
    const currencyOf = new Map(rows.map((inv) => [inv.id, inv.currency]));
    const payments = await database
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.tenantId, tenantId));
    for (const p of payments) {
      const link = paymentLinks.get(p.id);
      if (!p.reversedAt || !link || link.hash === PAYMENT_DELETED) continue;
      const res = await api<{ Payments?: ItemResult[] }>(
        "POST",
        `/Payments/${encodeURIComponent(link.xeroId)}`,
        {
          Status: "DELETED",
        },
      );
      const error = itemError(res.Payments?.[0]);
      if (error) {
        result.errors.push(`Payment ${p.date} (reversed): ${error}`);
        continue;
      }
      await saveLink(database, tenantId, "payment", p.id, link.xeroId, PAYMENT_DELETED);
      result.payments++;
    }
    const pendingPayments: { paymentId: string; payload: XeroPayment }[] = [];
    for (const p of payments) {
      if (p.reversedAt || paymentLinks.has(p.id)) continue;
      const xeroInvoiceId = invoiceLinks.get(p.invoiceId)?.xeroId;
      const currency = currencyOf.get(p.invoiceId);
      if (!xeroInvoiceId || !currency) continue;
      pendingPayments.push({
        paymentId: p.id,
        payload: paymentPayload(p, { xeroInvoiceId, currency, accountCode: settings.paymentAccountCode }),
      });
    }
    for (const batch of chunk(pendingPayments, BATCH_SIZE)) {
      const res = await api<{ Payments?: (ItemResult & { PaymentID?: string })[] }>(
        "PUT",
        "/Payments?summarizeErrors=false",
        { Payments: batch.map((b) => b.payload) },
      );
      for (const [i, pending] of batch.entries()) {
        const item = res.Payments?.[i];
        const error = itemError(item);
        if (error || !item?.PaymentID) {
          result.errors.push(`Payment ${pending.payload.Date}: ${error ?? "no id"}`);
          continue;
        }
        await saveLink(database, tenantId, "payment", pending.paymentId, item.PaymentID, "");
        result.payments++;
      }
    }

    await database
      .update(xeroConnections)
      .set({
        lastSyncedAt: new Date(),
        lastError: result.errors.length ? result.errors.slice(0, 5).join("\n") : null,
      })
      .where(eq(xeroConnections.tenantId, tenantId));
    return result;
  } catch (error) {
    if (error instanceof XeroAuthError) {
      forgetAccessToken(tenantId);
      await database
        .update(xeroConnections)
        .set({ lastError: RECONNECT_NEEDED })
        .where(eq(xeroConnections.tenantId, tenantId));
      return { ...result, errors: [RECONNECT_NEEDED] };
    }
    await database
      .update(xeroConnections)
      .set({ lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500) })
      .where(eq(xeroConnections.tenantId, tenantId));
    throw error;
  }
}
