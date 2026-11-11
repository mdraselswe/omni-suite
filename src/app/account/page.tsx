import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { TextField } from "@/components/form/field";
import { Section } from "@/components/layout/page";
import { ButtonLink } from "@/components/ui/button-link";
import { changePasswordAction, hasPasswordAccount, updateProfileAction } from "@/features/auth";
import { t } from "@/i18n";
import { authMethods, MIN_PASSWORD_LENGTH } from "@/server/auth/auth";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Your account" };

/** The signed-in person's own profile and password (not tied to any business). */
export default async function AccountPage() {
  const user = await requireUser();
  const hasPassword = await hasPasswordAccount(db(), user.id);
  const methods = authMethods();
  const canReset = methods.emailPassword || methods.devLogin;

  return (
    <main id="content" className="mx-auto grid w-full max-w-2xl gap-8 px-4 py-10 sm:py-14">
      <div className="grid gap-1">
        <h1 className="font-heading text-2xl font-semibold sm:text-3xl">{t("account.title")}</h1>
        <p className="text-sm break-all text-muted-foreground">{t("account.sub", { email: user.email })}</p>
      </div>

      <Section title={t("account.profile")}>
        <ActionForm action={updateProfileAction} keepValues className="max-w-md">
          <TextField
            name="name"
            label={t("auth.name")}
            defaultValue={user.name}
            autoComplete="name"
            maxLength={80}
            required
          />
          <TextField
            name="email"
            label={t("auth.email")}
            defaultValue={user.email}
            hint={t("account.emailFixed")}
            readOnly
            disabled
          />
          <SubmitButton pendingLabel={t("form.saving")} className="justify-self-start">
            {t("form.save")}
          </SubmitButton>
        </ActionForm>
      </Section>

      <Section title={t("account.password")}>
        {hasPassword ? (
          <ActionForm action={changePasswordAction} className="max-w-md">
            <TextField
              name="currentPassword"
              label={t("account.currentPassword")}
              type="password"
              autoComplete="current-password"
              required
            />
            <TextField
              name="newPassword"
              label={t("account.newPassword")}
              hint={t("account.passwordHint", { min: MIN_PASSWORD_LENGTH })}
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
            <TextField
              name="confirmPassword"
              label={t("account.confirmPassword")}
              type="password"
              autoComplete="new-password"
              required
            />
            <SubmitButton pendingLabel={t("form.saving")} className="justify-self-start">
              {t("account.changePassword")}
            </SubmitButton>
          </ActionForm>
        ) : (
          <div className="grid max-w-md gap-3 text-sm text-muted-foreground">
            <p>{t("account.noPasswordHint")}</p>
            {canReset ? (
              <ButtonLink href="/reset-password" variant="outline" className="justify-self-start">
                {t("account.createPassword")}
              </ButtonLink>
            ) : null}
          </div>
        )}
      </Section>

      <ButtonLink href="/" variant="ghost" className="justify-self-start">
        {t("account.back")}
      </ButtonLink>
    </main>
  );
}
