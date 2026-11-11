import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { CheckboxField, TextAreaField, TextField } from "@/components/form/field";
import { Section } from "@/components/layout/page";
import { updateGeneralAction } from "@/features/settings";
import { t } from "@/i18n";
import { requireTenantPermission } from "@/server/auth/session";

export default async function SettingsPage({ params }: PageProps<"/[tenant]/settings">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "settings.manage");
  const s = ctx.tenant.settings;

  return (
    <ActionForm action={updateGeneralAction.bind(null, tenant)} keepValues className="max-w-3xl gap-8">
      <Section title={t("settings.general")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="name" label={t("settings.businessName")} defaultValue={ctx.tenant.name} required />
          <TextField
            name="displayName"
            label={t("settings.displayName")}
            defaultValue={s.branding.displayName}
          />
          <TextField
            name="currency"
            label={t("settings.currency")}
            defaultValue={s.currency}
            maxLength={3}
            required
          />
          <TextField name="timezone" label={t("settings.timezone")} defaultValue={s.timezone} required />
          <TextField name="locale" label={t("settings.locale")} defaultValue={s.locale} required />
          <TextField
            name="fiscalYearStartMonth"
            label={t("settings.fyStart")}
            type="number"
            min={1}
            max={12}
            defaultValue={s.fiscalYearStartMonth}
            required
          />
        </div>
      </Section>

      <Section title={t("settings.tax")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="taxName" label={t("settings.taxName")} defaultValue={s.tax.name} required />
          <TextField
            name="taxRate"
            label={t("settings.taxRate")}
            hint={t("settings.taxRateHint")}
            inputMode="decimal"
            defaultValue={String(s.tax.rateBp / 100)}
            required
          />
          <TextField
            name="registrationNumber"
            label={t("settings.taxNumber")}
            defaultValue={s.tax.registrationNumber}
          />
          <CheckboxField
            name="pricesIncludeTax"
            label={t("settings.taxIncluded")}
            defaultChecked={s.tax.pricesIncludeTax}
            className="self-end"
          />
        </div>
      </Section>

      <Section title={t("invoices.title")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            name="invoicePrefix"
            label={t("settings.invoicePrefix")}
            defaultValue={s.invoicePrefix}
            maxLength={10}
          />
          <TextField
            name="proposalPrefix"
            label={t("settings.proposalPrefix")}
            defaultValue={s.proposalPrefix}
            maxLength={10}
          />
          <TextField
            name="paymentTermsDays"
            label={t("settings.terms")}
            type="number"
            min={0}
            max={365}
            defaultValue={s.paymentTermsDays}
            required
          />
        </div>
        <TextAreaField
          name="invoiceFooter"
          label={t("settings.footer")}
          rows={4}
          defaultValue={s.invoiceFooter}
        />
      </Section>

      <SubmitButton className="justify-self-start" pendingLabel={t("form.saving")}>
        {t("settings.saveGeneral")}
      </SubmitButton>
    </ActionForm>
  );
}
