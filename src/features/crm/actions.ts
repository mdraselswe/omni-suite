"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { customValues, fields, formObject, runAction, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { customFieldsFor } from "@/server/shared";
import { convertLead, createLead, moveLead, setLeadArchived, updateLead } from "./service";

async function parseLead(slug: string, formData: FormData, permission: "leads.write") {
  const { ctx, scope } = await actionContext(slug, permission);
  const raw = formObject(formData);
  const input = z
    .object({
      name: fields.required(200),
      company: fields.text(200),
      email: fields.email(),
      phone: fields.text(50),
      source: fields.text(100),
      stage: fields.required(50),
      value: fields.money(ctx.tenant.settings.currency, { optional: true }),
      notes: fields.text(5000),
      followUpDate: fields.optionalDate(),
      ownerMembershipId: fields.optionalId(),
    })
    .parse(raw);
  const custom = customValues(await customFieldsFor(db(), ctx.tenant.id, "lead"), raw);
  const { value, followUpDate, ...rest } = input;
  return {
    ctx,
    scope,
    raw,
    lead: { ...rest, valueMinor: value, followUpDate: followUpDate || null, custom },
  };
}

export async function createLeadAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, lead } = await parseLead(slug, formData, "leads.write");
    await createLead(db(), ctx, lead);
  });
}

export async function updateLeadAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, scope, raw, lead } = await parseLead(slug, formData, "leads.write");
    await updateLead(db(), ctx, scope, fields.id().parse(raw.id), lead);
  });
}

export async function moveLeadAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, scope } = await actionContext(slug, "leads.write");
    const { id, stage } = z
      .object({ id: fields.id(), stage: fields.required(50) })
      .parse(formObject(formData));
    await moveLead(db(), ctx, scope, id, stage);
  });
}

export async function convertLeadAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let clientId = "";
  const state = await runAction(async () => {
    const { ctx, scope } = await actionContext(slug, "leads.write");
    await actionContext(slug, "clients.write");
    const { id } = z.object({ id: fields.id() }).parse(formObject(formData));
    clientId = await convertLead(db(), ctx, scope, id);
  });
  if (state?.ok && clientId) redirect(`/${slug}/clients/${clientId}` as "/");
  return state;
}

export async function archiveLeadAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, scope } = await actionContext(slug, "leads.write");
    const { id, archived } = z
      .object({ id: fields.id(), archived: z.enum(["true", "false"]) })
      .parse(formObject(formData));
    await setLeadArchived(db(), ctx, scope, id, archived === "true");
  });
}
