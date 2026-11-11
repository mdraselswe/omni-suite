import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { buttonVariants } from "@/components/ui/button";
import { acceptInvitationAction, invitationByToken } from "@/features/team";
import { t } from "@/i18n";
import { appHref } from "@/lib/href";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const row = await invitationByToken(db(), token);
  const user = await getSessionUser();
  const valid = row && !row.invitation.acceptedAt && row.invitation.expiresAt > new Date();

  return (
    <main id="content" className="mx-auto grid min-h-svh max-w-md content-center gap-5 px-4 py-12">
      {!valid ? (
        <>
          <h1 className="font-heading text-2xl font-semibold">{t("invite.invalidTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("invite.invalid")}</p>
        </>
      ) : (
        <>
          <h1 className="font-heading text-2xl font-semibold">
            {t("invite.title", { name: row.tenantName })}
          </h1>
          <p className="text-sm text-muted-foreground">{t("invite.sub", { email: row.invitation.email })}</p>
          {user ? (
            <ActionForm action={acceptInvitationAction.bind(null, token)}>
              <p className="text-sm">{t("invite.signedInAs", { email: user.email })}</p>
              <SubmitButton pendingLabel={t("form.saving")}>{t("invite.accept")}</SubmitButton>
            </ActionForm>
          ) : (
            <Link
              href={appHref(`/login?next=${encodeURIComponent(`/invite/${token}`)}`)}
              className={buttonVariants()}
            >
              {t("invite.signInFirst")}
            </Link>
          )}
        </>
      )}
    </main>
  );
}
