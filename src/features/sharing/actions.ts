"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { t } from "@/i18n";
import { fields, formObject, runAction, UserError, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { consume, HOUR_MS } from "@/server/rate-limit";
import { respondToSharedProposal, shareLinkFor, startSharedCheckout } from "./service";

/** A few tries per link per hour: enough for a person, not for a script. */
async function throttle(what: string, token: string) {
  const key = createHash("sha256").update(token).digest("base64url");
  const allowed = await consume(db(), { key: `share-${what}:${key}`, limit: 10, windowMs: HOUR_MS });
  if (!allowed) throw new UserError(t("share.tooMany"));
}

/** Share link, no login: the client accepts or declines the proposal. */
export async function respondSharedProposalAction(
  token: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const input = z
      .object({
        name: fields.required(120),
        decision: z.enum(["accept", "decline"]),
        acceptTerms: fields.checkbox(),
        reason: fields.text(1000),
      })
      .parse(formObject(formData));
    await throttle("respond", token);
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "";
    await respondToSharedProposal(db(), token, {
      accept: input.decision === "accept",
      name: input.name,
      ip,
      acceptTerms: input.acceptTerms,
      reason: input.reason,
    });
    return t(input.decision === "accept" ? "share.accepted" : "share.declined");
  });
}

/** Share link, no login: "Pay online" sends the client to Stripe Checkout. */
export async function paySharedInvoiceAction(token: string): Promise<ActionState> {
  let url = "";
  const state = await runAction(async () => {
    await throttle("pay", token);
    url = await startSharedCheckout(db(), token);
  });
  if (state?.ok && url) redirect(url as "/");
  return state;
}

/** Staff: make (or, with reset, replace) the share link of a sent invoice or proposal. */
export async function shareLinkAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const input = z
      .object({ kind: z.enum(["invoice", "proposal"]), id: fields.id(), reset: fields.checkbox() })
      .parse(formObject(formData));
    const { ctx } = await actionContext(
      slug,
      input.kind === "invoice" ? "invoices.write" : "proposals.write",
    );
    await shareLinkFor(db(), ctx, input.kind, input.id, input.reset);
    return t(input.reset ? "share.resetDone" : "share.created");
  });
}
