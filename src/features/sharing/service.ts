import "server-only";
import { eq } from "drizzle-orm";
import { t } from "@/i18n";
import { today as todayIn } from "@/lib/dates";
import { requiredModules } from "@/modules/catalog";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { invoices, proposals } from "@/server/db/schema";
import {
  ensureShareToken,
  isShareToken,
  rotateShareToken,
  shareUrl,
  type ShareKind,
} from "@/server/share-links";
import type { TenantContext } from "@/server/tenancy/context";
import { loadTenant } from "@/server/tenancy/service";
import { getInvoice, invoiceBalance } from "@/features/invoices";
import { canPayOnline, startInvoiceCheckout } from "@/features/payments";
import { getProposal, respondToProposalAs, type ProposalResponse } from "@/features/proposals";

type Tenant = TenantContext["tenant"];

/** The business behind a link, while it is active and has the module switched on. */
async function liveTenant(database: DbOrTx, tenantId: string, permission: string): Promise<Tenant | null> {
  const tenant = await loadTenant(database, tenantId);
  if (tenant.status !== "active") return null;
  const off = tenant.settings.disabledModules;
  if (requiredModules(permission).some((key) => off.includes(key))) return null;
  return tenant;
}

/**
 * The invoice a share link opens, or null (unknown token, a draft, or the business
 * is suspended or has invoices switched off). Reversed payments are left out.
 */
export async function sharedInvoice(database: DbOrTx, token: string) {
  if (!isShareToken(token)) return null;
  const [hit] = await database
    .select({ id: invoices.id, tenantId: invoices.tenantId })
    .from(invoices)
    .where(eq(invoices.shareToken, token));
  if (!hit) return null;
  const tenant = await liveTenant(database, hit.tenantId, "portal.invoices");
  const row = tenant && (await getInvoice(database, tenant.id, hit.id));
  if (!tenant || !row || row.invoice.status === "draft") return null;
  const inv = row.invoice;
  const balance = invoiceBalance(inv);
  const payable =
    (inv.status === "sent" || inv.status === "partially_paid") &&
    balance > 0n &&
    (await canPayOnline(database, tenant.id, inv.currency));
  return {
    tenant,
    invoice: inv,
    client: row.client,
    payments: row.payments.filter((p) => !p.reversedAt),
    balance,
    payable,
  };
}

/** The proposal a share link opens, or null (as for invoices). */
export async function sharedProposal(database: DbOrTx, token: string) {
  if (!isShareToken(token)) return null;
  const [hit] = await database
    .select({ id: proposals.id, tenantId: proposals.tenantId })
    .from(proposals)
    .where(eq(proposals.shareToken, token));
  if (!hit) return null;
  const tenant = await liveTenant(database, hit.tenantId, "portal.proposals");
  const row = tenant && (await getProposal(database, tenant.id, hit.id));
  if (!tenant || !row || row.proposal.status === "draft") return null;
  return { tenant, proposal: row.proposal, client: row.client };
}

/** The client accepts or declines through the link (same rules as in the portal). */
export async function respondToSharedProposal(
  database: Database,
  token: string,
  input: Omit<ProposalResponse, "today">,
) {
  const shared = await sharedProposal(database, token);
  if (!shared) throw new UserError(t("share.gone"));
  await respondToProposalAs(
    database,
    { tenant: shared.tenant, userId: null, clientId: shared.proposal.clientId, via: "link" },
    shared.proposal.id,
    { ...input, today: todayIn(shared.tenant.settings.timezone) },
  );
}

/** Starts Stripe Checkout for the invoice behind a link; Stripe sends the client back to it. */
export async function startSharedCheckout(database: Database, token: string): Promise<string> {
  const shared = await sharedInvoice(database, token);
  if (!shared?.payable) throw new UserError(t("payments.notAvailable"));
  return startInvoiceCheckout(
    database,
    { tenant: shared.tenant },
    {
      invoiceId: shared.invoice.id,
      clientId: shared.invoice.clientId,
      returnUrl: shareUrl("invoice", token),
    },
  );
}

/**
 * Staff: the share link of a sent invoice or proposal (made on first use). With
 * `reset`, a new link replaces the old one, which stops working.
 */
export async function shareLinkFor(
  database: Database,
  ctx: TenantContext,
  kind: ShareKind,
  id: string,
  reset = false,
): Promise<string> {
  return database.transaction(async (tx) => {
    const table = kind === "invoice" ? invoices : proposals;
    const [row] = await tx
      .select({ status: table.status, tenantId: table.tenantId })
      .from(table)
      .where(eq(table.id, id));
    if (!row || row.tenantId !== ctx.tenant.id) throw new UserError(t(`share.missing.${kind}`));
    if (row.status === "draft") throw new UserError(t("share.sendFirst"));
    const token = reset
      ? await rotateShareToken(tx, kind, ctx.tenant.id, id)
      : await ensureShareToken(tx, kind, ctx.tenant.id, id);
    if (reset) {
      await audit(tx, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        action: `${kind}.shareLinkReset`,
        entityType: kind,
        entityId: id,
      });
    }
    return shareUrl(kind, token);
  });
}
