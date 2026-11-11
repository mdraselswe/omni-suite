"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { serverEnv } from "@/config/env";
import { t } from "@/i18n";
import { fields, formObject, runAction, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/tenancy/context";
import { cleanHost, isAppHost, slugForHost } from "@/server/tenancy/hosts";
import { disconnectStripe, saveStripeConnection, startInvoiceCheckout } from "./service";

export async function saveStripeAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "payments.online", "all");
    const input = z
      .object({
        secretKey: fields.text(300),
        webhookSecret: fields.text(300),
        accountId: fields.id(),
        enabled: fields.checkbox(),
      })
      .parse(formObject(formData));
    await saveStripeConnection(db(), ctx, input);
    return t("payments.saved");
  });
}

export async function disconnectStripeAction(slug: string): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "payments.online", "all");
    await disconnectStripe(db(), ctx);
    return t("payments.disconnected");
  });
}

/**
 * Where Stripe sends the client back: the page they paid from (the referer), but only on
 * this app's host or a domain that belongs to this business. Otherwise the portal list.
 */
async function returnUrl(slug: string): Promise<string> {
  const fallback = new URL(`/${slug}/portal/invoices/`, serverEnv().APP_URL).toString();
  const h = await headers();
  let from: URL;
  try {
    from = new URL(h.get("referer") ?? "");
  } catch {
    return fallback;
  }
  const host = cleanHost(from.host);
  if (!isAppHost(host) && (await slugForHost(host)) !== slug) return fallback;
  return `${from.origin}${from.pathname}`;
}

/** Client portal: "Pay online" sends the client to Stripe Checkout. */
export async function payInvoiceAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let url = "";
  const state = await runAction(async () => {
    const { ctx } = await actionContext(slug, "portal.invoices");
    const clientId = ctx.membership.clientId;
    if (ctx.membership.kind !== "client" || !clientId) throw new ForbiddenError("portal.invoices");
    const { invoiceId } = z.object({ invoiceId: fields.id() }).parse(formObject(formData));
    url = await startInvoiceCheckout(db(), ctx, { invoiceId, clientId, returnUrl: await returnUrl(slug) });
  });
  if (state?.ok && url) redirect(url as "/");
  return state;
}
