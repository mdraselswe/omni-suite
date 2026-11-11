"use server";

import { z } from "zod";
import { t } from "@/i18n";
import { formObject, runAction, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { enqueue } from "@/server/jobs/queue";
import { disconnect } from "./service";

/** Queues a background backup job ("full" rewrites every tab, "snapshot" writes the JSON file). */
export async function queueBackupAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "backup.manage");
    const { kind } = z.object({ kind: z.enum(["full", "snapshot"]) }).parse(formObject(formData));
    await enqueue(db(), {
      type: `backup.${kind}`,
      tenantId: ctx.tenant.id,
      dedupeKey: `backup.${kind}:${ctx.tenant.id}`,
    });
    return t("backup.queued");
  });
}

export async function disconnectBackupAction(slug: string): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "backup.manage");
    await disconnect(db(), ctx.tenant.id, ctx.user.id);
  });
}
