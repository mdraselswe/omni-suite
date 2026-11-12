"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { t } from "@/i18n";
import { addDays, today } from "@/lib/dates";
import { isSupportedCurrency } from "@/lib/intl-options";
import { fields, formObject, runAction, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";
import {
  billCurrency,
  createBill,
  payBill,
  undoBillPayment,
  updateBill,
  voidBill,
  type BillInput,
} from "./service";

const fxRate = () =>
  z
    .string()
    .regex(/^\d+(\.\d{1,8})?$/)
    .or(z.literal(""))
    .optional();

/** The bill form's fields. Amounts are in the bill's own currency (its own number of decimals). */
function parseBill(ctx: TenantContext, formData: FormData): { input: BillInput; file: File | null } {
  const raw = formObject(formData);
  const { currency } = z
    .object({ currency: z.string().refine(isSupportedCurrency, t("locale.badCurrency")) })
    .parse({ currency: (raw.currency || ctx.tenant.settings.currency).toUpperCase() });
  const input = z
    .object({
      supplier: fields.required(120),
      reference: fields.text(80),
      issueDate: fields.date(),
      dueDate: fields.optionalDate(),
      amount: fields.money(currency, { positive: true }),
      tax: fields.money(currency, { optional: true }).optional(),
      categoryId: fields.optionalId(),
      notes: fields.text(2000),
    })
    .parse(raw);
  const upload = formData.get("file");
  return {
    input: {
      supplier: input.supplier,
      reference: input.reference,
      issueDate: input.issueDate,
      dueDate: input.dueDate || addDays(input.issueDate, ctx.tenant.settings.paymentTermsDays),
      currency,
      totalMinor: input.amount,
      taxMinor: input.tax ?? 0n,
      categoryId: input.categoryId,
      notes: input.notes,
    },
    // An empty file input still posts a nameless, empty File.
    file: upload instanceof File && upload.size > 0 ? upload : null,
  };
}

export async function createBillAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let id = "";
  const state = await runAction(async () => {
    const { ctx } = await actionContext(slug, "bills.write");
    const { input, file } = parseBill(ctx, formData);
    id = await createBill(db(), ctx, input, file);
  });
  if (state?.ok && id) redirect(`/${slug}/bills/${id}` as "/");
  return state;
}

export async function updateBillAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "bills.write");
    const raw = formObject(formData);
    const { id, removeFile } = z.object({ id: fields.id(), removeFile: fields.checkbox() }).parse(raw);
    const { input, file } = parseBill(ctx, formData);
    await updateBill(db(), ctx, id, input, { file, removeFile });
  });
}

export async function voidBillAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "bills.write");
    await voidBill(db(), ctx, fields.id().parse(formObject(formData).id));
    return t("bills.voided");
  });
}

export async function payBillAction(slug: string, _p: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "bills.write");
    const raw = formObject(formData);
    const currency = (await billCurrency(db(), ctx.tenant.id, raw.id ?? "")) ?? ctx.tenant.settings.currency;
    const input = z
      .object({
        id: fields.id(),
        amount: fields.money(currency, { positive: true }),
        date: fields.date(),
        accountId: fields.id(),
        fxRate: fxRate(),
      })
      .parse(raw);
    await payBill(db(), ctx, input.id, {
      amountMinor: input.amount,
      date: input.date,
      accountId: input.accountId,
      fxRate: input.fxRate || undefined,
    });
    return t("bills.paid");
  });
}

export async function undoBillPaymentAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "bills.write");
    const input = z
      .object({ id: fields.id(), paymentId: fields.id(), reason: fields.text(200).default("") })
      .parse(formObject(formData));
    await undoBillPayment(
      db(),
      ctx,
      input.id,
      input.paymentId,
      today(ctx.tenant.settings.timezone),
      input.reason,
    );
    return t("bills.paymentUndone");
  });
}
