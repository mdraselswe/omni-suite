import { CsvImportDialog } from "@/components/data/csv-import-dialog";
import { SelectField } from "@/components/form/field";
import { limits } from "@/config";
import { t } from "@/i18n";
import { csvDataUrl, DATE_FORMATS, defaultDateFormat } from "@/lib/csv-import";
import { LEAD_SAMPLE } from "./import";
import { importLeadsAction, previewLeadImportAction } from "./import-actions";

/** "Import" button + dialog for the leads page (needs leads.write; the actions check it again). */
export function LeadImportDialog({
  tenant,
  stages,
  locale,
}: {
  tenant: string;
  stages: readonly { key: string; label: string }[];
  locale: string;
}) {
  const first = stages[0]?.label ?? "";
  return (
    <CsvImportDialog
      trigger={t("imports.trigger")}
      title={t("imports.leads.title")}
      description={t("imports.leads.description", { max: limits.imports.maxRows })}
      sample={{ href: csvDataUrl(LEAD_SAMPLE), filename: t("imports.leads.sampleFile") }}
      columns={[
        { name: "name", hint: t("imports.leads.col.name") },
        { name: "company", hint: t("imports.leads.col.company") },
        { name: "email", hint: t("imports.leads.col.email") },
        { name: "phone", hint: t("imports.leads.col.phone") },
        { name: "source", hint: t("imports.leads.col.source") },
        {
          name: "stage",
          hint: t("imports.leads.col.stage", { stages: stages.map((s) => s.label).join(", "), first }),
        },
        { name: "value", hint: t("imports.leads.col.value") },
        { name: "follow up date", hint: t("imports.leads.col.followUp") },
        { name: "notes", hint: t("imports.leads.col.notes") },
        { name: "owner email", hint: t("imports.leads.col.owner") },
        { name: "cf_<key>", hint: t("imports.leads.col.custom") },
      ]}
      previewHeaders={[
        t("form.name"),
        t("leads.company"),
        t("form.email.label"),
        t("leads.stage"),
        t("leads.value"),
        t("leads.followUp"),
      ]}
      preview={previewLeadImportAction.bind(null, tenant)}
      run={importLeadsAction.bind(null, tenant)}
    >
      <SelectField
        name="dateFormat"
        label={t("imports.dateFormat")}
        hint={t("imports.dateFormatHint")}
        options={DATE_FORMATS.map((f) => ({ value: f, label: t(`imports.dateFormat.${f}`) }))}
        defaultValue={defaultDateFormat(locale)}
      />
    </CsvImportDialog>
  );
}
