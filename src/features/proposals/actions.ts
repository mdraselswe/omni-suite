"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { today } from "@/lib/dates";
import { fields, formObject, runAction, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { parseItemsField } from "@/server/form-items";
import {
  createProposal,
  invoiceFromProposal,
  respondToProposal,
  sendProposal,
  updateProposal,
} from "./service";

async function parseProposal(slug: string, formData: FormData) {
  const { ctx } = await actionContext(slug, "proposals.write");
  const raw = formObject(formData);
  const input = z
    .object({
      clientId: fields.id(),
      title: fields.required(200),
      intro: fields.text(10000),
      terms: fields.text(10000),
      validUntil: fields.optionalDate().transform((v) => v || null),
    })
    .parse(raw);
  return {
    ctx,
    raw,
    proposal: { ...input, items: parseItemsField(raw.items, ctx.tenant.settings.currency) },
  };
}

export async function createProposalAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let id = "";
  const state = await runAction(async () => {
    const { ctx, proposal } = await parseProposal(slug, formData);
    id = await createProposal(db(), ctx, proposal);
  });
  if (state?.ok && id) redirect(`/${slug}/proposals/${id}` as "/");
  return state;
}

export async function updateProposalAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, raw, proposal } = await parseProposal(slug, formData);
    await updateProposal(db(), ctx, fields.id().parse(raw.id), proposal);
  });
}

export async function sendProposalAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "proposals.write");
    await sendProposal(db(), ctx, fields.id().parse(formObject(formData).id));
  });
}

export async function proposalToInvoiceAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let id = "";
  const state = await runAction(async () => {
    const { ctx } = await actionContext(slug, "invoices.write");
    id = await invoiceFromProposal(
      db(),
      ctx,
      fields.id().parse(formObject(formData).id),
      today(ctx.tenant.settings.timezone),
    );
  });
  if (state?.ok && id) redirect(`/${slug}/invoices/${id}` as "/");
  return state;
}

/** Portal: the client accepts or declines. */
export async function respondProposalAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "portal.proposals");
    const input = z
      .object({ id: fields.id(), name: fields.required(120), decision: z.enum(["accept", "decline"]) })
      .parse(formObject(formData));
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "";
    await respondToProposal(db(), ctx, input.id, {
      accept: input.decision === "accept",
      name: input.name,
      ip,
      today: today(ctx.tenant.settings.timezone),
    });
  });
}
