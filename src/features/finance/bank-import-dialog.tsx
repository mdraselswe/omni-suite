import { CsvImportDialog } from "@/components/data/csv-import-dialog";
import { SelectField, TextField } from "@/components/form/field";
import { limits } from "@/config";
import { t } from "@/i18n";
import { csvDataUrl, DATE_FORMATS, defaultDateFormat } from "@/lib/csv-import";
import { BANK_SAMPLE } from "./import";
import { importBankAction, previewBankImportAction } from "./import-actions";

/** "Import" button + dialog for the Money page (needs finance.write; the actions check it again). */
export function BankImportDialog({
  tenant,
  accounts,
  base,
  locale,
  defaultAccountId,
}: {
  tenant: string;
  /** Active accounts, as `accountOptions` gives them. */
  accounts: readonly { value: string; label: string; currency: string }[];
  /** Business currency. */
  base: string;
  locale: string;
  /** The account the ledger is filtered to, if any. */
  defaultAccountId?: string;
}) {
  // The rate field only shows when there is an account it could apply to.
  const foreign = accounts.some((a) => a.currency !== base);
  return (
    <CsvImportDialog
      trigger={t("imports.trigger")}
      title={t("imports.bank.title")}
      description={t("imports.bank.description", { max: limits.imports.maxRows })}
      sample={{ href: csvDataUrl(BANK_SAMPLE), filename: t("imports.bank.sampleFile") }}
      columns={[
        { name: "date", hint: t("imports.bank.col.date") },
        { name: "description", hint: t("imports.bank.col.description") },
        { name: "amount", hint: t("imports.bank.col.amount") },
        { name: "money in / money out", hint: t("imports.bank.col.inOut") },
        { name: "reference", hint: t("imports.bank.col.reference") },
        { name: "category", hint: t("imports.bank.col.category") },
        { name: "tax", hint: t("imports.bank.col.tax") },
      ]}
      previewHeaders={[
        t("form.date.label"),
        t("form.description"),
        t("finance.amount"),
        t("finance.category"),
        t("imports.bank.tax"),
      ]}
      preview={previewBankImportAction.bind(null, tenant)}
      run={importBankAction.bind(null, tenant)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="accountId"
          label={t("finance.account")}
          options={accounts}
          defaultValue={defaultAccountId ?? accounts[0]?.value}
          required
        />
        <SelectField
          name="dateFormat"
          label={t("imports.dateFormat")}
          hint={t("imports.dateFormatHint")}
          options={DATE_FORMATS.map((f) => ({ value: f, label: t(`imports.dateFormat.${f}`) }))}
          defaultValue={defaultDateFormat(locale)}
        />
      </div>
      {foreign ? (
        <TextField
          name="fxRate"
          label={t("finance.fxRate")}
          hint={t("imports.bank.fxHint", { base })}
          inputMode="decimal"
        />
      ) : null}
    </CsvImportDialog>
  );
}
