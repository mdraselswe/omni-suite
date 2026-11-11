"use server";

import { z } from "zod";
import { t } from "@/i18n";
import { parsePercentBp } from "@/lib/money";
import { fields, formObject, runAction, UserError, type ActionState } from "@/server/action";
import { actionContext, requirePlatformAdmin, requireTenant } from "@/server/auth/session";
import { serverEnv } from "@/config/env";
import { db } from "@/server/db";
import { markAllRead } from "@/server/shared";
import { clearHostCache } from "@/server/tenancy/hosts";
import {
  addCustomField,
  addDomain,
  deleteCustomField,
  removeDomain,
  setModuleEnabled,
  setTenantStatus,
  updateSettings,
  verifyDomain,
} from "./service";

export async function updateGeneralAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "settings.manage");
    const input = z
      .object({
        name: fields.required(120),
        displayName: fields.text(120),
        currency: z.string().trim().toUpperCase().length(3),
        timezone: fields.required(60),
        locale: fields.required(20),
        taxName: fields.required(20),
        taxRate: fields.required(10),
        pricesIncludeTax: fields.checkbox(),
        registrationNumber: fields.text(40),
        fiscalYearStartMonth: fields.int(1, 12),
        invoicePrefix: fields.text(10),
        proposalPrefix: fields.text(10),
        paymentTermsDays: fields.int(0, 365),
        invoiceFooter: fields.text(2000),
      })
      .parse(formObject(formData));
    const rateBp = parsePercentBp(input.taxRate);
    if (rateBp === null) throw new UserError(t("form.percent"));
    try {
      new Intl.DateTimeFormat(input.locale, { timeZone: input.timezone });
    } catch {
      throw new UserError(t("form.invalid"));
    }
    const s = ctx.tenant.settings;
    await updateSettings(db(), ctx, {
      name: input.name,
      settings: {
        currency: input.currency,
        timezone: input.timezone,
        locale: input.locale,
        tax: {
          name: input.taxName,
          rateBp,
          pricesIncludeTax: input.pricesIncludeTax,
          registrationNumber: input.registrationNumber,
        },
        fiscalYearStartMonth: input.fiscalYearStartMonth,
        invoicePrefix: input.invoicePrefix,
        proposalPrefix: input.proposalPrefix,
        paymentTermsDays: input.paymentTermsDays,
        invoiceFooter: input.invoiceFooter,
        branding: { ...s.branding, displayName: input.displayName },
      },
    });
  });
}

export async function setModuleAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "settings.manage");
    const { key, enabled } = z
      .object({ key: z.string(), enabled: z.enum(["true", "false"]) })
      .parse(formObject(formData));
    await setModuleEnabled(db(), ctx, key, enabled === "true");
  });
}

function lines(value: string): string[][] {
  return value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("|").map((p) => p.trim()));
}

function slugKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

export async function updatePipelineAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "settings.manage");
    const input = z
      .object({ stages: fields.required(5000), statuses: fields.required(5000) })
      .parse(formObject(formData));
    const stages = lines(input.stages).map(([key = "", label = "", kind = "open"]) => ({
      key: slugKey(key),
      label: label || key,
      kind: kind === "won" ? ("won" as const) : kind === "lost" ? ("lost" as const) : ("open" as const),
    }));
    const statuses = lines(input.statuses).map(([key = "", label = "", done = ""]) => ({
      key: slugKey(key),
      label: label || key,
      done: done.toLowerCase() === "done",
    }));
    const bad = [...stages, ...statuses].some((s) => !s.key);
    const dup = (keys: string[]) => new Set(keys).size !== keys.length;
    if (
      bad ||
      !stages.length ||
      !statuses.length ||
      dup(stages.map((s) => s.key)) ||
      dup(statuses.map((s) => s.key))
    ) {
      throw new UserError(t("settings.badLines"));
    }
    await updateSettings(db(), ctx, { settings: { pipelineStages: stages, projectStatuses: statuses } });
  });
}

export async function addCustomFieldAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "settings.manage");
    const input = z
      .object({
        entity: z.enum(["client", "lead", "project", "invoice"]),
        label: fields.required(80),
        type: z.enum(["text", "number", "date", "select", "checkbox"]),
        options: fields.text(2000),
        required: fields.checkbox(),
      })
      .parse(formObject(formData));
    const options = input.options
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
    await addCustomField(db(), ctx, { ...input, options: input.type === "select" ? options : [] });
  });
}

export async function deleteCustomFieldAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "settings.manage");
    await deleteCustomField(db(), ctx, fields.id().parse(formObject(formData).id));
  });
}

export async function addDomainAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "domains.manage");
    const { hostname } = z.object({ hostname: fields.required(253) }).parse(formObject(formData));
    await addDomain(db(), ctx, hostname, new URL(serverEnv().APP_URL).hostname);
  });
}

export async function verifyDomainAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "domains.manage");
    const ok = await verifyDomain(db(), ctx, fields.id().parse(formObject(formData).id));
    if (!ok) throw new UserError(t("domains.verifyFailed"));
    clearHostCache();
    return t("domains.verifiedOk");
  });
}

export async function removeDomainAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "domains.manage");
    await removeDomain(db(), ctx, fields.id().parse(formObject(formData).id));
    clearHostCache();
  });
}

export async function markNotificationsReadAction(slug: string): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireTenant(slug);
    await markAllRead(db(), ctx.tenant.id, ctx.user.id);
  });
}

export async function setTenantStatusAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requirePlatformAdmin();
    const input = z
      .object({ tenantId: fields.id(), status: z.enum(["active", "suspended"]), plan: fields.required(40) })
      .parse(formObject(formData));
    await setTenantStatus(db(), admin.id, input);
  });
}
