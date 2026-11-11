"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { PLAN_KEYS } from "@/config";
import { formObject, runAction, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { openBillingPortal, startSubscriptionCheckout } from "./service";

/** Sends the owner to Stripe Checkout for the chosen plan. */
export async function choosePlanAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let url = "";
  const state = await runAction(async () => {
    const { ctx } = await actionContext(slug, "billing.manage", "all");
    const { plan } = z.object({ plan: z.enum(PLAN_KEYS) }).parse(formObject(formData));
    url = await startSubscriptionCheckout(db(), ctx, plan);
  });
  if (state?.ok && url) redirect(url as "/");
  return state;
}

/** Opens Stripe's customer portal (change plan or card, invoices, cancel). */
export async function manageBillingAction(slug: string): Promise<ActionState> {
  let url = "";
  const state = await runAction(async () => {
    const { ctx } = await actionContext(slug, "billing.manage", "all");
    url = await openBillingPortal(db(), ctx);
  });
  if (state?.ok && url) redirect(url as "/");
  return state;
}
