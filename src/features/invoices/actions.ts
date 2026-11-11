"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { addDays } from "@/lib/dates";
import { customValues, fields, formObject, runAction, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { parseItemsField } from "@/server/form-items";
import { customFieldsFor } from "@/server/shared";
import {
  createInvoice,
  createRecurring,
  recordPayment,
  sendInvoice,
  setRecurringActive,
  updateInvoice,
  voidInvoice,
} from "./service";

async function parseInvoice(slug: string, formData: FormData) {
  const { ctx } = await actionContext(slug, "invoices.write");
  const raw = formObject(formData);
  const input = z
    .object({
      clientId: fields.id(),
      issueDate: fields.date(),
      dueDate: fields.optionalDate(),
      notes: fields.text(5000),
    })
    .parse(raw);
  const items = parseItemsField(raw.items, ctx.tenant.settings.currency);
  const custom = customValues(await customFieldsFor(db(), ctx.tenant.id, "invoice"), raw);
  return {
    ctx,
    raw,
    invoice: {
      ...input,
      dueDate: input.dueDate || addDays(input.issueDate, ctx.tenant.settings.paymentTermsDays),
      items,
      custom,
    },
  };
}

export async function createInvoiceAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let id = "";
  const state = await runAction(async () => {
    const { ctx, invoice } = await parseInvoice(slug, formData);
    id = await createInvoice(db(), ctx, invoice);
  });
  if (state?.ok && id) redirect(`/${slug}/invoices/${id}` as "/");
  return state;
}

export async function updateInvoiceAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, raw, invoice } = await parseInvoice(slug, formData);
    await updateInvoice(db(), ctx, fields.id().parse(raw.id), invoice);
  });
}

export async function sendInvoiceAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "invoices.write");
    await sendInvoice(db(), ctx, fields.id().parse(formObject(formData).id));
  });
}

export async function voidInvoiceAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "invoices.write");
    await voidInvoice(db(), ctx, fields.id().parse(formObject(formData).id));
  });
}

export async function recordPaymentAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "payments.record");
    const input = z
      .object({
        id: fields.id(),
        amount: fields.money(ctx.tenant.settings.currency, { positive: true }),
        date: fields.date(),
        accountId: fields.id(),
        method: fields.text(50),
        categoryId: fields.optionalId(),
      })
      .parse(formObject(formData));
    await recordPayment(db(), ctx, input.id, {
      amountMinor: input.amount,
      date: input.date,
      accountId: input.accountId,
      method: input.method,
      categoryId: input.categoryId,
    });
  });
}

export async function createRecurringAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "invoices.write");
    const raw = formObject(formData);
    const input = z
      .object({
        clientId: fields.id(),
        name: fields.required(120),
        intervalMonths: fields.int(1, 36),
        nextRunDate: fields.date(),
        autoSend: fields.checkbox(),
      })
      .parse(raw);
    await createRecurring(db(), ctx, {
      ...input,
      items: parseItemsField(raw.items, ctx.tenant.settings.currency),
    });
  });
}

export async function toggleRecurringAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "invoices.write");
    const { id, active } = z
      .object({ id: fields.id(), active: z.enum(["true", "false"]) })
      .parse(formObject(formData));
    await setRecurringActive(db(), ctx, id, active === "true");
  });
}
