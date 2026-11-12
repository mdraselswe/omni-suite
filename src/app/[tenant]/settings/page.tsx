import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { ComboboxField } from "@/components/form/combobox-field";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/form/field";
import { Section } from "@/components/layout/page";
import { regionalConfig } from "@/config";
import { moneyRecorded, updateGeneralAction } from "@/features/settings";
import { t } from "@/i18n";
import {
  currencyOptions,
  localeOptions,
  monthOptions,
  timeZoneOptions,
  withCurrent,
} from "@/lib/intl-options";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

export default async function SettingsPage({ params }: PageProps<"/[tenant]/settings">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "settings.manage");
  const s = ctx.tenant.settings;
  const currencyLocked = await moneyRecorded(db(), ctx.tenant.id);

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
          <ComboboxField
            name="currency"
            label={t("locale.currency")}
            hint={
              currencyLocked ? t("locale.currencyLocked", { currency: s.currency }) : t("locale.currencyHint")
            }
            options={withCurrent(currencyOptions(), s.currency)}
            defaultValue={s.currency}
            readOnly={currencyLocked}
            required
          />
          <ComboboxField
            name="timezone"
            label={t("locale.timezone")}
            options={withCurrent(timeZoneOptions(new Date()), s.timezone)}
            defaultValue={s.timezone}
            required
          />
          <ComboboxField
            name="locale"
            label={t("locale.format")}
            options={withCurrent(localeOptions(regionalConfig.locales), s.locale)}
            defaultValue={s.locale}
            required
          />
          <SelectField
            name="fiscalYearStartMonth"
            label={t("locale.fyStart")}
            options={monthOptions(s.locale)}
            defaultValue={String(s.fiscalYearStartMonth)}
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
        <TextField
          name="replyToEmail"
          label={t("settings.replyTo")}
          hint={t("settings.replyToHint")}
          type="email"
          defaultValue={s.replyToEmail}
        />
        <fieldset className="grid gap-4 rounded-md border p-4">
          <legend className="px-1 text-sm font-medium">{t("settings.reminders")}</legend>
          <CheckboxField
            name="remindersEnabled"
            label={t("settings.remindersOn")}
            defaultChecked={s.reminders.enabled}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="reminderDaysBefore"
              label={t("settings.reminderBefore")}
              hint={t("settings.reminderBeforeHint")}
              type="number"
              min={0}
              max={60}
              defaultValue={s.reminders.daysBefore}
              required
            />
            <TextField
              name="reminderDaysAfter"
              label={t("settings.reminderAfter")}
              hint={t("settings.reminderAfterHint")}
              inputMode="numeric"
              defaultValue={s.reminders.daysAfter.join(", ")}
            />
          </div>
        </fieldset>
      </Section>

      <SubmitButton className="justify-self-start" pendingLabel={t("form.saving")}>
        {t("settings.saveGeneral")}
      </SubmitButton>
    </ActionForm>
  );
}
