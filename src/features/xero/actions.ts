"use server";

import { z } from "zod";
import { t } from "@/i18n";
import { formObject, runAction, UserError, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { enqueue } from "@/server/jobs/queue";
import { ACCOUNT_CODE, TAX_TYPE } from "./mapping";
import { disconnectXero, getXeroConnection, updateXeroSettings } from "./service";

/** Queues a sync now instead of waiting for the hourly one. */
export async function syncXeroNowAction(slug: string): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "integrations.manage");
    if (!(await getXeroConnection(db(), ctx.tenant.id))) throw new UserError(t("xero.notConnected"));
    await enqueue(db(), {
      type: "xero.sync",
      tenantId: ctx.tenant.id,
      dedupeKey: `xero.sync:${ctx.tenant.id}`,
    });
    return t("xero.queued");
  });
}

export async function saveXeroSettingsAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "integrations.manage");
    const input = z
      .object({
        salesAccountCode: z.string().trim().regex(ACCOUNT_CODE, t("xero.codeInvalid")),
        paymentAccountCode: z.string().trim().regex(ACCOUNT_CODE, t("xero.codeInvalid")),
        taxType: z
          .string()
          .trim()
          .transform((v) => v.toUpperCase())
          .pipe(z.string().regex(TAX_TYPE, t("xero.taxTypeInvalid"))),
      })
      .parse(formObject(formData));
    await updateXeroSettings(db(), ctx.tenant.id, ctx.user.id, input);
    return t("xero.settingsSaved");
  });
}

export async function disconnectXeroAction(slug: string): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "integrations.manage");
    await disconnectXero(db(), ctx.tenant.id, ctx.user.id);
    return t("xero.disconnected");
  });
}
