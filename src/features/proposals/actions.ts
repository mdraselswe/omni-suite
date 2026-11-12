"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { fields, formObject, runAction, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { parseItemsField } from "@/server/form-items";
import {
  createProposal,
  deleteProposal,
  extendProposal,
  invoiceFromProposal,
  projectFromProposal,
  reopenProposal,
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
    const delivery = await sendProposal(db(), ctx, fields.id().parse(formObject(formData).id));
    return t(
      delivery === "portal"
        ? "proposals.sentPortal"
        : delivery === "email"
          ? "proposals.sentEmail"
          : "proposals.sentNobody",
    );
  });
}

export async function reopenProposalAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "proposals.write");
    await reopenProposal(db(), ctx, fields.id().parse(formObject(formData).id));
  });
}

export async function deleteProposalAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const state = await runAction(async () => {
    const { ctx } = await actionContext(slug, "proposals.write");
    await deleteProposal(db(), ctx, fields.id().parse(formObject(formData).id));
  });
  if (state?.ok) redirect(tenantHref(slug, "proposals"));
  return state;
}

export async function proposalToInvoiceAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let id = "";
  const state = await runAction(async () => {
    const { ctx } = await actionContext(slug, "invoices.write");
    const input = z
      .object({
        id: fields.id(),
        // "50" or "12.5" percent; empty bills everything still unbilled.
        deposit: z
          .string()
          .trim()
          .regex(/^\d{1,2}(\.\d{1,2})?$/, t("proposals.depositRange"))
          .or(z.literal(""))
          .optional(),
      })
      .parse(formObject(formData));
    id = await invoiceFromProposal(db(), ctx, input.id, today(ctx.tenant.settings.timezone), {
      depositBp: input.deposit ? Math.round(Number(input.deposit) * 100) : undefined,
    });
  });
  if (state?.ok && id) redirect(`/${slug}/invoices/${id}` as "/");
  return state;
}

/** Starts the project for an accepted proposal and opens it. */
export async function proposalToProjectAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let id = "";
  const state = await runAction(async () => {
    const { ctx } = await actionContext(slug, "projects.write");
    id = await projectFromProposal(
      db(),
      ctx,
      fields.id().parse(formObject(formData).id),
      today(ctx.tenant.settings.timezone),
    );
  });
  if (state?.ok && id) redirect(`/${slug}/projects/${id}` as "/");
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
      .object({
        id: fields.id(),
        name: fields.required(120),
        decision: z.enum(["accept", "decline"]),
        acceptTerms: fields.checkbox(),
        reason: fields.text(1000),
      })
      .parse(formObject(formData));
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "";
    await respondToProposal(db(), ctx, input.id, {
      accept: input.decision === "accept",
      name: input.name,
      ip,
      today: today(ctx.tenant.settings.timezone),
      acceptTerms: input.acceptTerms,
      reason: input.reason,
    });
  });
}

/** Staff give a sent (or expired) proposal a new valid-until day. */
export async function extendProposalAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "proposals.write");
    const input = z.object({ id: fields.id(), validUntil: fields.date() }).parse(formObject(formData));
    await extendProposal(db(), ctx, input.id, {
      validUntil: input.validUntil,
      today: today(ctx.tenant.settings.timezone),
    });
    return t("proposals.extended");
  });
}
