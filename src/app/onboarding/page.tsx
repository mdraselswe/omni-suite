import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { TextField } from "@/components/form/field";
import { createBusinessAction } from "@/features/business";
import { t } from "@/i18n";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "New business" };

export default async function NewBusinessPage() {
  await requireUser();
  return (
    <main id="content" className="mx-auto grid min-h-svh max-w-md content-center gap-6 px-4 py-12">
      <div className="grid gap-1">
        <h1 className="font-heading text-2xl font-semibold">{t("business.newTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("business.newSub")}</p>
      </div>
      <ActionForm action={createBusinessAction} keepValues>
        <TextField name="name" label={t("business.name")} required autoComplete="organization" />
        <TextField
          name="slug"
          label={t("business.slug")}
          hint={t("business.slugHint")}
          pattern="[a-z0-9-]+"
          autoCapitalize="none"
        />
        <SubmitButton pendingLabel={t("form.saving")}>{t("business.create")}</SubmitButton>
      </ActionForm>
    </main>
  );
}
