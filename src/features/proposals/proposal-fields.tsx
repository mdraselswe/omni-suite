import { SelectField, TextAreaField, TextField } from "@/components/form/field";
import { LineItemsEditor } from "@/components/form/line-items-editor";
import { t } from "@/i18n";
import type { LineItem } from "@/lib/line-items";
import type { TenantSettings } from "@/lib/tenant-settings";

type ProposalValues = {
  id: string;
  clientId: string;
  title: string;
  intro: string;
  terms: string;
  validUntil: string | null;
  items: LineItem[];
};

/** Inputs shared by the new-proposal page and the edit dialog. */
export function ProposalFields({
  clients,
  settings,
  proposal,
  defaultClientId,
}: {
  clients: readonly { value: string; label: string }[];
  settings: TenantSettings;
  proposal?: ProposalValues;
  defaultClientId?: string;
}) {
  return (
    <>
      {proposal ? <input type="hidden" name="id" value={proposal.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="clientId"
          label={t("team.client")}
          options={clients}
          placeholder={t("form.choose")}
          defaultValue={proposal?.clientId ?? defaultClientId ?? ""}
          required
        />
        <TextField
          name="validUntil"
          label={t("proposals.validUntil")}
          type="date"
          defaultValue={proposal?.validUntil ?? ""}
        />
      </div>
      <TextField name="title" label={t("proposals.titleField")} defaultValue={proposal?.title} required />
      <TextAreaField name="intro" label={t("proposals.intro")} rows={4} defaultValue={proposal?.intro} />
      <LineItemsEditor
        initial={proposal?.items}
        currency={settings.currency}
        locale={settings.locale}
        defaultTaxBp={settings.tax.rateBp}
        pricesIncludeTax={settings.tax.pricesIncludeTax}
        taxName={settings.tax.name}
      />
      <TextAreaField name="terms" label={t("proposals.terms")} rows={4} defaultValue={proposal?.terms} />
    </>
  );
}
