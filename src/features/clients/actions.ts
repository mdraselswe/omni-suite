"use server";

import { z } from "zod";
import { t } from "@/i18n";
import {
  customValues,
  FieldErrors,
  fields,
  formObject,
  runAction,
  UserError,
  type ActionState,
} from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { parseCsv } from "@/server/export";
import { customFieldsFor } from "@/server/shared";
import { clientSchema, parseClientImport } from "./import";
import {
  createClient,
  deleteTemplate,
  parseQuestionLines,
  saveTemplate,
  sendOnboarding,
  submitOnboarding,
  updateClient,
  updateOnboardingChecklist,
  type OnboardingAnswers,
} from "./service";

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

/** CSV import: columns name, email, phone, website, address, notes and cf_<key> custom fields. */
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
    const defs = await customFieldsFor(db(), ctx.tenant.id, "client");
    const { clients, skippedRows } = parseClientImport(rows, defs);
    for (const client of clients) await createClient(db(), ctx, client);
    const summary = t("clients.importSummary", { imported: clients.length, skipped: skippedRows.length });
    if (skippedRows.length === 0) return summary;
    const shown = skippedRows.slice(0, 10).join(", ");
    return `${summary} ${t("clients.importSkippedRows", { rows: skippedRows.length > 10 ? `${shown}…` : shown })}`;
  });
}

export async function deleteTemplateAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "onboarding.manage");
    await deleteTemplate(db(), ctx, fields.id().parse(formObject(formData).id));
    return t("onboarding.templateDeleted");
  });
}

export async function sendOnboardingAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "onboarding.manage");
    const input = z
      .object({
        clientId: fields.id(),
        templateId: fields.id(),
        // Only sent when nobody at the client can open the portal yet.
        invite: fields.checkbox(),
        inviteEmail: fields.email(),
      })
      .parse(formObject(formData));
    if (input.invite && !input.inviteEmail) {
      throw new FieldErrors({ inviteEmail: [t("form.required")] });
    }
    const { delivery } = await sendOnboarding(db(), ctx, {
      clientId: input.clientId,
      templateId: input.templateId,
      inviteEmail: input.invite ? input.inviteEmail : null,
    });
    return t(`access.onboarding.sent.${delivery}`, { email: input.inviteEmail });
  });
}

export async function saveTemplateAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "onboarding.manage");
    const input = z
      .object({
        id: fields.optionalId(),
        name: fields.required(120),
        questions: fields.text(10000),
        checklist: fields.text(5000),
      })
      .parse(formObject(formData));
    const questions = parseQuestionLines(input.questions);
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
    const { id } = z.object({ id: fields.id() }).parse(formObject(formData));
    // Answers arrive as a_<key>; a file question sends one a_<key> per chosen file.
    const answers: OnboardingAnswers = {};
    for (const name of new Set(formData.keys())) {
      if (!name.startsWith("a_")) continue;
      const values = fields.all(formData, name);
      answers[name.slice(2)] = values.length > 1 ? values : (values[0] ?? "");
    }
    await submitOnboarding(db(), ctx, id, answers);
    return t("onboarding.thanks");
  });
}
