import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/layout/brand-mark";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { TextField } from "@/components/form/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button-link";
import { site } from "@/config";
import {
  acceptInvitationAction,
  accountForEmail,
  invitationByToken,
  invitationState,
  invitationStateMessage,
  InviteSignOutButton,
  isInviteProof,
  signUpForInvitationAction,
} from "@/features/team";
import { t } from "@/i18n";
import { appHref } from "@/lib/href";
import { authMethods, MIN_PASSWORD_LENGTH } from "@/server/auth/auth";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { appUrl } from "@/server/mail";
import { isAppHost, requestHost } from "@/server/tenancy/hosts";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

function Shell({ children }: { children: ReactNode }) {
  return (
    <main id="content" className="mx-auto grid min-h-svh w-full max-w-md content-center gap-6 px-4 py-12">
      <div className="flex items-center gap-2.5">
        <BrandMark name={site.name} className="size-8" />
        <span className="font-heading font-semibold">{site.name}</span>
      </div>
      {children}
    </main>
  );
}

/** Whole days left until a moment (at least 1 while it is still in the future). */
function daysUntil(moment: Date): number {
  return Math.max(1, Math.ceil((moment.getTime() - Date.now()) / 86_400_000));
}

function loginHref(next: string) {
  return appHref(`/login?next=${encodeURIComponent(next)}`);
}

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const proof = typeof sp.k === "string" ? sp.k : "";
  const self = `/invite/${token}${proof ? `?k=${encodeURIComponent(proof)}` : ""}`;
  // Answered on the app host only: a custom-domain session belongs to one business.
  if (!isAppHost(requestHost(await headers()))) redirect(appUrl(self) as "/");

  const database = db();
  const [row, user] = await Promise.all([invitationByToken(database, token), getSessionUser()]);

  if (!row) {
    return (
      <Shell>
        <div className="grid gap-2">
          <h1 className="font-heading text-2xl font-semibold">{t("invite.invalidTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("access.invite.state.missing")}</p>
        </div>
        <ButtonLink href={user ? "/" : "/login"} variant="outline" className="justify-self-start">
          {user ? t("access.invite.goHome") : t("auth.signIn")}
        </ButtonLink>
      </Shell>
    );
  }

  const inv = row.invitation;
  const state = invitationState(inv);
  if (state !== "open") {
    const mine = user?.email.toLowerCase() === inv.email;
    return (
      <Shell>
        <div className="grid gap-2">
          <h1 className="font-heading text-2xl font-semibold">{t(`access.invite.title.${state}`)}</h1>
          <p className="text-sm text-muted-foreground">{invitationStateMessage(state, row.business)}</p>
        </div>
        {user ? (
          <ButtonLink href="/" variant={mine ? "default" : "outline"} className="justify-self-start">
            {mine ? t("access.invite.open", { business: row.business }) : t("access.invite.goHome")}
          </ButtonLink>
        ) : (
          <ButtonLink href={loginHref("/")} className="justify-self-start">
            {t("auth.signIn")}
          </ButtonLink>
        )}
      </Shell>
    );
  }

  const isClient = inv.kind === "client";
  const daysLeft = daysUntil(inv.expiresAt);
  const proven = isInviteProof(token, proof);
  const methods = authMethods();
  const signedInAs = user?.email.toLowerCase();
  // Only looked up for a visitor who isn't signed in (the link holder learns no more than the link says).
  const account = user ? null : await accountForEmail(database, inv.email);

  return (
    <Shell>
      <div className="grid gap-2">
        <h1 className="font-heading text-2xl font-semibold text-balance">
          {row.inviterName
            ? t("access.invite.heading", { inviter: row.inviterName, business: row.business })
            : t("invite.title", { name: row.business })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isClient
            ? t("access.invite.purposeClient", { business: row.business, app: site.name })
            : t("access.invite.purposeTeam", { business: row.business, app: site.name })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("access.invite.forEmail", { email: inv.email, days: daysLeft })}
        </p>
      </div>

      {sp.sent === "1" ? (
        <Alert>
          <AlertTitle>{t("access.invite.checkInboxTitle")}</AlertTitle>
          <AlertDescription>{t("access.invite.checkInbox", { email: inv.email })}</AlertDescription>
        </Alert>
      ) : null}

      {user ? (
        signedInAs === inv.email ? (
          <ActionForm action={acceptInvitationAction.bind(null, token)} className="surface p-4">
            <p className="text-sm">{t("invite.signedInAs", { email: user.email })}</p>
            <SubmitButton pendingLabel={t("access.invite.joining")}>
              {t("access.invite.join", { business: row.business })}
            </SubmitButton>
          </ActionForm>
        ) : (
          <div className="grid gap-3">
            <Alert variant="destructive">
              <AlertTitle>{t("access.invite.otherAccountTitle")}</AlertTitle>
              <AlertDescription>
                {t("access.invite.otherAccount", { current: user.email, email: inv.email })}
              </AlertDescription>
            </Alert>
            <div className="justify-self-start">
              <InviteSignOutButton />
            </div>
          </div>
        )
      ) : account && sp.sent === "1" && !account.emailVerified ? (
        <p className="text-sm text-muted-foreground">
          {t("access.invite.noMail")}{" "}
          <Link
            href={loginHref(self)}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("access.invite.resendConfirmation")}
          </Link>
        </p>
      ) : account ? (
        <div className="grid gap-3 surface p-4">
          <p className="text-sm">{t("access.invite.haveAccount", { email: inv.email })}</p>
          {account.emailVerified ? null : (
            <p className="text-sm text-muted-foreground">{t("access.invite.unconfirmedAccount")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={loginHref(self)}>{t("access.invite.signInToJoin")}</ButtonLink>
            {methods.emailPassword ? (
              <ButtonLink href="/reset-password" variant="outline">
                {t("account.forgotPassword")}
              </ButtonLink>
            ) : null}
          </div>
        </div>
      ) : methods.emailPassword ? (
        <div className="grid gap-4">
          <ActionForm
            action={signUpForInvitationAction.bind(null, token, proof)}
            keepValues
            className="surface p-4"
          >
            <p className="text-sm font-medium">{t("access.invite.createTitle")}</p>
            <TextField name="name" label={t("access.invite.yourName")} autoComplete="name" required />
            <TextField
              name="email"
              label={t("auth.email")}
              type="email"
              value={inv.email}
              readOnly
              autoComplete="username"
              hint={t("access.invite.emailFixed")}
            />
            <TextField
              name="password"
              label={t("access.invite.password")}
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              hint={t("access.invite.passwordHint", { min: MIN_PASSWORD_LENGTH })}
              required
            />
            <TextField
              name="confirmPassword"
              label={t("access.invite.confirmPassword")}
              type="password"
              autoComplete="new-password"
              required
            />
            {proven ? null : (
              <p className="text-xs text-muted-foreground">
                {t("access.invite.confirmFirst", { email: inv.email })}
              </p>
            )}
            <SubmitButton pendingLabel={t("access.invite.joining")}>
              {t("access.invite.join", { business: row.business })}
            </SubmitButton>
          </ActionForm>
          {methods.google ? (
            <p className="text-sm text-muted-foreground">
              {t("access.invite.orGoogle")}{" "}
              <Link
                href={loginHref(self)}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t("access.invite.useGoogle")}
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3 surface p-4">
          <p className="text-sm">{t("access.invite.googleOnly", { email: inv.email })}</p>
          <ButtonLink href={loginHref(self)} className="justify-self-start">
            {t("access.invite.signInToJoin")}
          </ButtonLink>
        </div>
      )}
    </Shell>
  );
}
