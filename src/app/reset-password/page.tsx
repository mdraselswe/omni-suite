import type { Metadata } from "next";
import { BrandMark } from "@/components/layout/brand-mark";
import { ButtonLink } from "@/components/ui/button-link";
import { site } from "@/config";
import { NewPasswordForm, ResetRequestForm } from "@/features/auth";
import { t } from "@/i18n";
import { authMethods, MIN_PASSWORD_LENGTH } from "@/server/auth/auth";

export const metadata: Metadata = { title: "Reset password" };

/**
 * Forgotten password. Without `token`: ask for a reset link by email. With the
 * `token` Better Auth adds when the emailed link is opened: choose a new password.
 */
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";
  const invalid = query.error === "INVALID_TOKEN";
  const methods = authMethods();
  const enabled = methods.emailPassword || methods.devLogin;

  return (
    <main id="content" className="mx-auto grid min-h-svh max-w-md content-center gap-6 px-4 py-12">
      <div className="flex items-center gap-2.5">
        <BrandMark name={site.name} className="size-9" />
        <span className="font-heading text-lg font-semibold">{site.name}</span>
      </div>
      <div className="grid gap-2">
        <h1 className="font-heading text-2xl font-semibold">
          {token ? t("account.newPasswordTitle") : t("account.resetTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {token ? t("account.newPasswordSub") : t("account.resetSub")}
        </p>
      </div>
      {!enabled ? (
        <p className="rounded-lg border bg-muted p-4 text-sm">{t("account.passwordsOff")}</p>
      ) : (
        <>
          {invalid ? (
            <p role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
              {t("account.resetInvalid")}
            </p>
          ) : null}
          {token && !invalid ? (
            <NewPasswordForm token={token} minLength={MIN_PASSWORD_LENGTH} />
          ) : (
            <ResetRequestForm />
          )}
        </>
      )}
      <ButtonLink href="/login" variant="ghost" className="justify-self-start">
        {t("account.backToSignIn")}
      </ButtonLink>
    </main>
  );
}
