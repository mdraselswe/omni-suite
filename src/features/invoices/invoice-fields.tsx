import { CustomFieldInputs } from "@/components/form/custom-field-inputs";
import { SelectField, TextAreaField, TextField } from "@/components/form/field";
import { LineItemsEditor } from "@/components/form/line-items-editor";
import { t } from "@/i18n";
import type { CustomFieldDef, CustomValues } from "@/lib/custom-fields";
import type { LineItem } from "@/lib/line-items";
import type { TenantSettings } from "@/lib/tenant-settings";

type InvoiceValues = {
  id: string;
  clientId: string;
  issueDate: string;
  dueDate: string;
  notes: string;
  items: LineItem[];
  custom: CustomValues;
};

/** Inputs shared by the new-invoice page and the edit dialog. */
export function InvoiceFields({
  clients,
  settings,
  defs,
  today,
  invoice,
  defaultClientId,
  defaultItems,
}: {
  clients: readonly { value: string; label: string }[];
  settings: TenantSettings;
  defs: readonly CustomFieldDef[];
  today: string;
  invoice?: InvoiceValues;
  defaultClientId?: string;
  defaultItems?: LineItem[];
}) {
  return (
    <>
      {invoice ? <input type="hidden" name="id" value={invoice.id} /> : null}
      <SelectField
        name="clientId"
        label={t("team.client")}
        options={clients}
        placeholder={t("form.choose")}
        defaultValue={invoice?.clientId ?? defaultClientId ?? ""}
        required
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="issueDate"
          label={t("invoices.issueDate")}
          type="date"
          defaultValue={invoice?.issueDate ?? today}
          required
        />
        <TextField
          name="dueDate"
          label={t("invoices.dueDate")}
          type="date"
          defaultValue={invoice?.dueDate ?? ""}
          hint={t("invoices.dueHint", { days: String(settings.paymentTermsDays) })}
        />
      </div>
      <LineItemsEditor
        initial={invoice?.items ?? defaultItems}
        currency={settings.currency}
        locale={settings.locale}
        defaultTaxBp={settings.tax.rateBp}
        pricesIncludeTax={settings.tax.pricesIncludeTax}
        taxName={settings.tax.name}
      />
      <CustomFieldInputs defs={defs} values={invoice?.custom} />
      <TextAreaField name="notes" label={t("form.notes")} rows={3} defaultValue={invoice?.notes} />
    </>
  );
}
