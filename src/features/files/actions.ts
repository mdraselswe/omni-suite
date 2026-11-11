"use server";

import { z } from "zod";
import { t } from "@/i18n";
import { fields, formObject, runAction, UserError, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteFile, setFileVisibility, uploadFile } from "./service";

export async function uploadFileAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "portal.files").catch(() => actionContext(slug, "files.write"));
    const raw = formObject(formData);
    const input = z
      .object({
        entityType: z.enum(["project", "client", "transaction", "general"]).default("general"),
        entityId: fields.optionalId(),
        clientVisible: fields.checkbox(),
      })
      .parse(raw);
    const file = formData.get("file");
    if (!(file instanceof File)) throw new UserError(t("files.empty"));
    await uploadFile(db(), ctx, { ...input, file });
  });
}

export async function toggleFileAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, scope } = await actionContext(slug, "files.write");
    const { id, visible } = z
      .object({ id: fields.id(), visible: z.enum(["true", "false"]) })
      .parse(formObject(formData));
    await setFileVisibility(db(), ctx, scope, id, visible === "true");
  });
}

export async function deleteFileAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, scope } = await actionContext(slug, "files.write");
    await deleteFile(db(), ctx, scope, fields.id().parse(formObject(formData).id));
  });
}
