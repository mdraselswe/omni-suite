import "server-only";
import { APIError } from "better-auth/api";
import { t } from "@/i18n";
import { UserError } from "@/server/action";
import { getAuth } from "@/server/auth/auth";
import type { Database } from "@/server/db";
import type { Audience } from "@/modules/catalog";
import {
  acceptInvitation,
  accountForEmail,
  invitationByToken,
  invitationState,
  invitationStateMessage,
} from "./service";

export type InviteSignupResult =
  | { status: "joined"; email: string; slug: string; kind: Audience }
  | { status: "confirmEmail"; email: string };

/**
 * A new invitee creates their account on the invitation page.
 *
 * - From the emailed link (`emailProven`): the address is proven by the link, so
 *   the account is created verified and the invitation accepted in one step.
 * - From a link someone shared by hand: the account is created unverified and
 *   the usual confirmation email goes out; its link brings them back to accept.
 *
 * Never touches an existing account (that would let a link holder take it over):
 * existing users sign in instead.
 */
export async function signUpForInvitation(
  database: Database,
  token: string,
  input: { name: string; password: string; emailProven: boolean },
): Promise<InviteSignupResult> {
  const row = await invitationByToken(database, token);
  if (!row) throw new UserError(t("invite.invalid"));
  const state = invitationState(row.invitation);
  if (state !== "open") throw new UserError(invitationStateMessage(state, row.business));
  const email = row.invitation.email;
  if (await accountForEmail(database, email)) {
    throw new UserError(t("access.invite.accountExists", { email }));
  }

  const auth = getAuth();
  if (!input.emailProven) {
    try {
      await auth.api.signUpEmail({
        body: { name: input.name, email, password: input.password, callbackURL: `/invite/${token}` },
      });
    } catch (error) {
      if (error instanceof APIError) throw new UserError(t("access.invite.signupFailed"));
      throw error;
    }
    return { status: "confirmEmail", email };
  }

  const context = await auth.$context;
  const hash = await context.password.hash(input.password);
  let userId: string;
  try {
    const created = await context.internalAdapter.createUser(
      { email, name: input.name, emailVerified: true },
      { method: "email-password" },
    );
    userId = created.id;
    await context.internalAdapter.linkAccount({
      userId,
      providerId: "credential",
      accountId: userId,
      password: hash,
    });
  } catch (error) {
    // Most likely the same address signed up a moment ago in another tab.
    console.error("[invite] account creation failed", error);
    throw new UserError(t("access.invite.signupFailed"));
  }
  const joined = await acceptInvitation(database, token, { id: userId });
  return { status: "joined", email, ...joined };
}
