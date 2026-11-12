"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { limits } from "@/config";
import { t } from "@/i18n";
import { fields, formObject, runAction, UserError, type ActionState } from "@/server/action";
import { getAuth, MIN_PASSWORD_LENGTH } from "@/server/auth/auth";
import { getSessionUser, requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { consume, MINUTE_MS } from "@/server/rate-limit";
import { isAppHost, requestHost } from "@/server/tenancy/hosts";
import type { Audience } from "@/modules/catalog";
import { signUpForInvitation } from "./invite-signup";
import { acceptInvitation, isInviteProof } from "./service";

/** Where a new member lands: clients in their portal, the team on the dashboard. */
function landing(slug: string, kind: Audience): string {
  return kind === "client" ? `/${slug}/portal` : `/${slug}`;
}

/** Invitations are answered on the app host only (custom-domain sessions are bound to one business). */
async function assertAppHost(): Promise<void> {
  if (!isAppHost(requestHost(await headers()))) throw new UserError(t("access.invite.appHostOnly"));
}

export async function acceptInvitationAction(token: string): Promise<ActionState> {
  let target = "/";
  const state = await runAction(async () => {
    await assertAppHost();
    const user = await requireUser();
    const result = await acceptInvitation(db(), token, user);
    target = landing(result.slug, result.kind);
  });
  if (state?.ok) redirect(target as "/");
  return state;
}

/**
 * New invitee: name + password on the invitation page. From the emailed link
 * (`proof`) the account is created, verified, the invitation accepted and the
 * user signed in, in one step. Attempts per invitation are throttled like sign-ins.
 */
export async function signUpForInvitationAction(
  token: string,
  proof: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target: string | null = null;
  const state = await runAction(async () => {
    await assertAppHost();
    if (await getSessionUser()) throw new UserError(t("access.invite.signOutFirst"));
    const input = z
      .object({
        name: fields.required(80),
        password: z
          .string()
          .min(MIN_PASSWORD_LENGTH, t("account.passwordTooShort", { min: MIN_PASSWORD_LENGTH }))
          .max(128, t("access.invite.passwordTooLong")),
        confirmPassword: z.string(),
      })
      .refine((v) => v.password === v.confirmPassword, {
        message: t("account.passwordMismatch"),
        path: ["confirmPassword"],
      })
      .parse(formObject(formData));
    const key = createHash("sha256").update(token).digest("base64url");
    const allowed = await consume(db(), {
      key: `invite-signup:${key}`,
      limit: limits.signIn.perEmailMax,
      windowMs: limits.signIn.perEmailWindowMinutes * MINUTE_MS,
    });
    if (!allowed) throw new UserError(t("security.signInThrottled"));

    const result = await signUpForInvitation(db(), token, {
      name: input.name,
      password: input.password,
      emailProven: isInviteProof(token, proof),
    });
    if (result.status === "confirmEmail") {
      target = `/invite/${token}?sent=1`;
      return;
    }
    const goTo = landing(result.slug, result.kind);
    try {
      await getAuth().api.signInEmail({
        body: { email: result.email, password: input.password },
        headers: await headers(),
      });
      target = goTo;
    } catch (error) {
      // The account and membership exist; signing in by hand finishes the job.
      console.error("[invite] sign-in after sign-up failed", error);
      target = `/login?next=${encodeURIComponent(goTo)}`;
    }
  });
  if (state?.ok && target) redirect(target as "/");
  return state;
}
