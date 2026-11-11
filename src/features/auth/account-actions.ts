"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { z } from "zod";
import { t } from "@/i18n";
import { fields, formObject, runAction, UserError, type ActionState } from "@/server/action";
import { getAuth, MIN_PASSWORD_LENGTH } from "@/server/auth/auth";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { hasPasswordAccount } from "./account";

/** Account page: change the display name. */
export async function updateProfileAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireUser();
    const { name } = z.object({ name: fields.required(80) }).parse(formObject(formData));
    await getAuth().api.updateUser({ headers: await headers(), body: { name } });
    return t("account.profileSaved");
  });
}

/** Account page: change the password (needs the current one); signs out other devices. */
export async function changePasswordAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    if (!(await hasPasswordAccount(db(), user.id))) throw new UserError(t("account.noPassword"));
    const input = z
      .object({
        currentPassword: z.string().min(1, t("form.required")),
        newPassword: z
          .string()
          .min(MIN_PASSWORD_LENGTH, t("account.passwordTooShort", { min: MIN_PASSWORD_LENGTH })),
        confirmPassword: z.string(),
      })
      .refine((v) => v.newPassword === v.confirmPassword, {
        message: t("account.passwordMismatch"),
        path: ["confirmPassword"],
      })
      .parse(formObject(formData));
    try {
      await getAuth().api.changePassword({
        headers: await headers(),
        body: {
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: true,
        },
      });
    } catch (error) {
      if (error instanceof APIError) {
        throw new UserError(
          error.body?.code === "INVALID_PASSWORD" ? t("account.wrongPassword") : t("account.passwordFailed"),
        );
      }
      throw error;
    }
    return t("account.passwordChanged");
  });
}
