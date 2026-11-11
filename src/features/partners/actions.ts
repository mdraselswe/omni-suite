"use server";

import { z } from "zod";
import { t } from "@/i18n";
import { parsePercentBp } from "@/lib/money";
import { fields, formObject, runAction, UserError, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { createTransaction } from "@/features/finance";
import type { ProfitRule } from "./profit";
import {
  createPartner,
  decideRule,
  deleteDraftDistribution,
  finaliseDistribution,
  listPartners,
  proposeRule,
  recordCapital,
  recordInvestment,
  recordTransfer,
  saveDistribution,
  setInitialOwnership,
  updatePartner,
} from "./service";

function percent(value: string | undefined, field: string): number {
  const bp = parsePercentBp(value ?? "");
  if (bp === null) throw new UserError(`${t("form.percent")} (${field})`);
  return bp;
}

export async function createPartnerAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "partners.manage", "all");
    const input = z
      .object({
        name: fields.required(120),
        email: fields.email(),
        joinedOn: fields.date(),
        membershipId: fields.optionalId(),
      })
      .parse(formObject(formData));
    await createPartner(db(), ctx, input);
  });
}

export async function updatePartnerAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "partners.manage", "all");
    const input = z
      .object({
        id: fields.id(),
        name: fields.required(120),
        email: fields.email(),
        membershipId: fields.optionalId(),
        leftOn: fields.optionalDate().transform((v) => v || null),
      })
      .parse(formObject(formData));
    await updatePartner(db(), ctx, input.id, input);
  });
}

export async function recordCapitalAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "partners.manage", "all");
    const input = z
      .object({
        partnerId: fields.id(),
        date: fields.date(),
        kind: z.enum(["cash", "asset", "work"]),
        amount: fields.money(ctx.tenant.settings.currency, { positive: true }),
        description: fields.text(200),
        accountId: fields.optionalId(),
      })
      .parse(formObject(formData));
    await recordCapital(db(), ctx, { ...input, amountMinor: input.amount });
  });
}

export async function recordDrawingAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "finance.write");
    const input = z
      .object({
        partnerId: fields.id(),
        accountId: fields.id(),
        date: fields.date(),
        amount: fields.money(ctx.tenant.settings.currency, { positive: true }),
        description: fields.text(200),
      })
      .parse(formObject(formData));
    await createTransaction(db(), ctx, {
      kind: "drawing",
      accountId: input.accountId,
      partnerId: input.partnerId,
      date: input.date,
      amountMinor: input.amount,
      description: input.description || t("partners.drawings"),
    });
  });
}

export async function setInitialOwnershipAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "partners.manage", "all");
    const raw = formObject(formData);
    const { date, note } = z.object({ date: fields.date(), note: fields.text(300) }).parse(raw);
    const shares = Object.entries(raw)
      .filter(([k, v]) => k.startsWith("pct_") && v.trim() !== "")
      .map(([k, v]) => ({ partnerId: k.slice(4), basisPoints: percent(v, k) }));
    await setInitialOwnership(db(), ctx, { date, note, shares });
  });
}

export async function recordInvestmentAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "partners.manage", "all");
    const cur = ctx.tenant.settings.currency;
    const input = z
      .object({
        partnerId: fields.id(),
        date: fields.date(),
        preMoney: fields.money(cur, { positive: true }),
        investment: fields.money(cur, { positive: true }),
        accountId: fields.optionalId(),
        note: fields.text(300),
      })
      .parse(formObject(formData));
    await recordInvestment(db(), ctx, {
      partnerId: input.partnerId,
      date: input.date,
      preMoneyMinor: input.preMoney,
      investmentMinor: input.investment,
      accountId: input.accountId,
      note: input.note,
    });
  });
}

export async function recordTransferAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "partners.manage", "all");
    const raw = formObject(formData);
    const input = z
      .object({
        fromPartnerId: fields.id(),
        toPartnerId: fields.id(),
        date: fields.date(),
        note: fields.text(300),
      })
      .parse(raw);
    await recordTransfer(db(), ctx, { ...input, basisPoints: percent(raw.percent, "percent") });
  });
}

export async function proposeRuleAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "profit.propose", "all");
    const raw = formObject(formData);
    const base = z
      .object({
        method: z.enum(["capital_ratio", "ownership_units", "fixed_percent", "weighted"]),
        lossMethod: z.enum(["same_as_profit", "ownership_units"]),
        laborSource: z.enum(["time_entries", "manual"]).default("time_entries"),
        effectiveFrom: fields.date(),
        note: fields.text(500),
      })
      .parse(raw);
    const partners = await listPartners(db(), ctx.tenant.id, base.effectiveFrom);
    const cur = ctx.tenant.settings.currency;
    const fees = partners.flatMap((p) => {
      const value = raw[`fee_${p.id}`]?.trim();
      if (!value) return [];
      const amount = fields.money(cur, { positive: true }).parse(value);
      return [{ partnerId: p.id, amountMinor: amount.toString() }];
    });
    let method: ProfitRule["method"];
    if (base.method === "fixed_percent") {
      const shares = partners
        .filter((p) => !p.leftOn)
        .map((p) => ({
          partnerId: p.id,
          basisPoints: percent(raw[`share_${p.id}`] || "0", `share_${p.id}`),
        }));
      if (shares.reduce((a, s) => a + s.basisPoints, 0) !== 10000) throw new UserError(t("rules.mustSum"));
      method = { type: "fixed_percent", shares };
    } else if (base.method === "weighted") {
      const capitalWeightBp = percent(raw.capitalWeight, "capitalWeight");
      method = {
        type: "weighted",
        capitalWeightBp,
        laborWeightBp: 10000 - capitalWeightBp,
        laborSource: base.laborSource,
      };
    } else {
      method = { type: base.method };
    }
    await proposeRule(db(), ctx, {
      effectiveFrom: base.effectiveFrom,
      note: base.note,
      config: {
        reserveBp: percent(raw.reserve || "0", "reserve"),
        fees,
        method,
        lossMethod: base.lossMethod,
      },
    });
  });
}

export async function decideRuleAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    // Any partner who can see the rules decides for themselves; deciding for others
    // needs profit.propose (checked in decideRule).
    const { ctx } = await actionContext(slug, "partners.read");
    const input = z
      .object({ ruleId: fields.id(), partnerId: fields.id(), decision: z.enum(["approved", "rejected"]) })
      .parse(formObject(formData));
    await decideRule(db(), ctx, input);
  });
}

export async function saveDistributionAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "distributions.run", "all");
    const raw = formObject(formData);
    const input = z.object({ start: fields.date(), end: fields.date(), final: fields.checkbox() }).parse(raw);
    const manualLabor = Object.fromEntries(
      Object.entries(raw)
        .filter(([k, v]) => k.startsWith("labor_") && /^\d+$/.test(v.trim()))
        .map(([k, v]) => [k.slice(6), BigInt(v.trim())]),
    );
    await saveDistribution(db(), ctx, { ...input, manualLabor });
  });
}

export async function finaliseDistributionAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "distributions.run", "all");
    const { id } = z.object({ id: fields.id() }).parse(formObject(formData));
    await finaliseDistribution(db(), ctx, id);
  });
}

export async function deleteDistributionAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "distributions.run", "all");
    const { id } = z.object({ id: fields.id() }).parse(formObject(formData));
    await deleteDraftDistribution(db(), ctx, id);
  });
}
