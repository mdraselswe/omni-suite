import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { TextField } from "@/components/form/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createBusinessAction, RegionFields } from "@/features/business";
import { invitationsForEmail } from "@/features/team";
import { t } from "@/i18n";
import { appHref, tenantHref } from "@/lib/href";
import { currencyOptions, timeZoneOptions } from "@/lib/intl-options";
import { tenantSettingsSchema } from "@/lib/tenant-settings";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { userTenants } from "@/server/tenancy/service";

export const metadata: Metadata = { title: "New business" };

export default async function NewBusinessPage() {
  const user = await requireUser();
  const defaults = tenantSettingsSchema.parse({});
  const database = db();
  // Invited people and clients don't need a business of their own: point them to theirs first.
  const [tenants, invites] = await Promise.all([
    userTenants(database, user.id),
    user.emailVerified ? invitationsForEmail(database, user.email) : Promise.resolve([]),
  ]);
  const invite = invites.find((i) => !i.expired);
  const portal = tenants.find((tn) => tn.kind === "client");
  const onlyClient = tenants.length > 0 && tenants.every((tn) => tn.kind === "client");
  return (
    <main id="content" className="mx-auto grid min-h-svh max-w-md content-center gap-6 px-4 py-12">
      <div className="grid gap-1">
        <h1 className="font-heading text-2xl font-semibold">{t("business.newTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("business.newSub")}</p>
      </div>
      {invite ? (
        <Alert>
          <AlertDescription>
            {t("access.onboardingPage.invited", { business: invite.business })}{" "}
            <Link href={appHref(`/invite/${invite.token}`)}>{t("access.home.view")}</Link>
          </AlertDescription>
        </Alert>
      ) : onlyClient && portal ? (
        <Alert>
          <AlertDescription>
            {t("access.onboardingPage.client", { business: portal.name })}{" "}
            <Link href={tenantHref(portal.slug, "portal")}>{t("access.onboardingPage.openPortal")}</Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <ActionForm action={createBusinessAction} keepValues>
        <TextField name="name" label={t("business.name")} required autoComplete="organization" />
        <TextField
          name="slug"
          label={t("business.slug")}
          hint={t("business.slugHint")}
          pattern="[a-z0-9-]+"
          autoCapitalize="none"
        />
        <RegionFields
          currencies={currencyOptions()}
          timeZones={timeZoneOptions(new Date())}
          defaultCurrency={defaults.currency}
          defaultTimeZone={defaults.timezone}
        />
        <SubmitButton pendingLabel={t("form.saving")}>{t("business.create")}</SubmitButton>
      </ActionForm>
    </main>
  );
}
