"use server";

import { z } from "zod";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { fields, formObject, runAction, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import {
  closePeriod,
  createAccount,
  createCategory,
  createTransaction,
  reopenPeriod,
  reverseTransaction,
  setCategoryArchived,
  updateAccount,
  TX_KINDS,
} from "./service";

export async function createTransactionAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "finance.write");
    const raw = formObject(formData);
    const input = z
      .object({
        kind: z.enum(TX_KINDS as [string, ...string[]]),
        accountId: fields.id(),
        toAccountId: fields.optionalId(),
        categoryId: fields.optionalId(),
        partnerId: fields.optionalId(),
        clientId: fields.optionalId(),
        date: fields.date(),
        description: fields.text(300),
        amount: fields.money(ctx.tenant.settings.currency, { positive: true }),
        fxRate: z
          .string()
          .regex(/^\d+(\.\d{1,8})?$/)
          .or(z.literal(""))
          .optional(),
      })
      .parse(raw);
    await createTransaction(db(), ctx, {
      kind: input.kind as (typeof TX_KINDS)[number],
      accountId: input.accountId,
      toAccountId: input.toAccountId,
      categoryId: input.categoryId,
      partnerId: input.partnerId,
      clientId: input.clientId,
      date: input.date,
      description: input.description,
      amountMinor: input.amount,
      fxRate: input.fxRate || undefined,
    });
  });
}

export async function reverseTransactionAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "finance.write");
    const { id, reason } = z
      .object({ id: fields.id(), reason: fields.text(200).default("") })
      .parse(formObject(formData));
    await reverseTransaction(db(), ctx, id, today(ctx.tenant.settings.timezone), reason);
    return t("finance.reversed");
  });
}

export async function createAccountAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "finance.write");
    const raw = formObject(formData);
    const currency = (raw.currency || ctx.tenant.settings.currency).toUpperCase();
    const input = z
      .object({
        name: fields.required(80),
        type: z.enum(["bank", "cash", "wallet", "card"]),
        currency: z.string().regex(/^[A-Z]{3}$/),
        opening: fields.money(currency, { optional: true }),
      })
      .parse({ ...raw, currency });
    await createAccount(db(), ctx, {
      name: input.name,
      type: input.type,
      currency: input.currency,
      openingBalanceMinor: input.opening,
    });
  });
}

export async function toggleAccountAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "finance.write");
    const input = z
      .object({ id: fields.id(), name: fields.required(80), archived: z.enum(["true", "false"]) })
      .parse(formObject(formData));
    await updateAccount(db(), ctx, input.id, { name: input.name, archived: input.archived === "true" });
  });
}

export async function createCategoryAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "finance.write");
    const input = z
      .object({ kind: z.enum(["income", "expense"]), name: fields.required(80) })
      .parse(formObject(formData));
    await createCategory(db(), ctx, input);
  });
}

export async function toggleCategoryAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "finance.write");
    const input = z
      .object({ id: fields.id(), archived: z.enum(["true", "false"]) })
      .parse(formObject(formData));
    await setCategoryArchived(db(), ctx, input.id, input.archived === "true");
  });
}

export async function closePeriodAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "finance.close", "all");
    const input = z.object({ startDate: fields.date(), endDate: fields.date() }).parse(formObject(formData));
    await closePeriod(db(), ctx, input);
  });
}

export async function reopenPeriodAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "finance.close", "all");
    const { id } = z.object({ id: fields.id() }).parse(formObject(formData));
    await reopenPeriod(db(), ctx, id);
  });
}
