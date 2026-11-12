"use server";

import { z } from "zod";
import { fields, formObject, runAction, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteFile, setFileVisibility } from "./service";

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
