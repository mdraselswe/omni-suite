"use server";

import { z } from "zod";
import { t } from "@/i18n";
import { customValues, fields, formObject, runAction, UserError, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { parseCsv } from "@/server/export";
import { customFieldsFor } from "@/server/shared";
import {
  createClient,
  saveTemplate,
  sendOnboarding,
  submitOnboarding,
  updateClient,
  updateOnboardingChecklist,
  type OnboardingField,
} from "./service";

const clientSchema = z.object({
  name: fields.required(200),
  email: fields.email(),
  phone: fields.text(50),
  website: fields.text(300),
  address: fields.text(500),
  notes: fields.text(5000),
  status: z.enum(["active", "inactive"]).default("active"),
});

export async function createClientAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "clients.write");
    const raw = formObject(formData);
    const input = clientSchema.parse(raw);
    const custom = customValues(await customFieldsFor(db(), ctx.tenant.id, "client"), raw);
    await createClient(db(), ctx, { ...input, custom });
  });
}

export async function updateClientAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "clients.write");
    const raw = formObject(formData);
    const { id, ...input } = clientSchema.extend({ id: fields.id() }).parse(raw);
    const custom = customValues(await customFieldsFor(db(), ctx.tenant.id, "client"), raw);
    await updateClient(db(), ctx, id, { ...input, custom });
  });
}

/** CSV import: columns name, email, phone, website, address, notes. */
export async function importClientsAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "clients.write");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError(t("files.empty"));
    const rows = parseCsv(await file.text()).slice(0, 2000);
    let count = 0;
    for (const row of rows) {
      const parsed = clientSchema.safeParse({ ...row, status: "active" });
      if (!parsed.success) continue;
      await createClient(db(), ctx, { ...parsed.data, custom: {} });
      count++;
    }
    return t("clients.imported", { count });
  });
}

export async function sendOnboardingAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "onboarding.manage");
    const input = z.object({ clientId: fields.id(), templateId: fields.id() }).parse(formObject(formData));
    await sendOnboarding(db(), ctx, input);
  });
}

export async function saveTemplateAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "onboarding.manage");
    const raw = formObject(formData);
    const input = z
      .object({
        id: fields.optionalId(),
        name: fields.required(120),
        questions: fields.text(10000),
        checklist: fields.text(5000),
      })
      .parse(raw);
    const used = new Set<string>();
    const questions: OnboardingField[] = input.questions
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line, i) => {
        const [label = "", type = "", required = ""] = line.split("|").map((p) => p.trim());
        let key =
          label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "")
            .slice(0, 40) || `q${i + 1}`;
        if (used.has(key)) key = `${key}_${i + 1}`;
        used.add(key);
        return {
          key,
          label,
          type: type === "textarea" ? "textarea" : "text",
          required: required === "required",
        };
      });
    const checklist = input.checklist
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    await saveTemplate(db(), ctx, { id: input.id, name: input.name, fields: questions, checklist });
  });
}

export async function updateChecklistAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "onboarding.manage");
    const { id, complete } = z
      .object({ id: fields.id(), complete: fields.checkbox() })
      .parse(formObject(formData));
    await updateOnboardingChecklist(db(), ctx, id, fields.all(formData, "done"), complete);
  });
}

export async function submitOnboardingAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "portal.onboarding");
    const raw = formObject(formData);
    const { id } = z.object({ id: fields.id() }).parse(raw);
    const answers = Object.fromEntries(
      Object.entries(raw)
        .filter(([k]) => k.startsWith("a_"))
        .map(([k, v]) => [k.slice(2), v]),
    );
    await submitOnboarding(db(), ctx, id, answers);
    return t("onboarding.thanks");
  });
}
