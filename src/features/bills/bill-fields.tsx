"use client";

import { useState } from "react";
import { ComboboxField } from "@/components/form/combobox-field";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/form/field";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { parseMoney, toDecimalString } from "@/lib/money";

type Option = { value: string; label: string };

/** Values of a bill being edited (amounts already as decimal strings). */
export type BillFormValues = {
  id: string;
  supplier: string;
  reference: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  amount: string;
  tax: string;
  categoryId: string;
  notes: string;
  fileName: string | null;
};

/**
 * Fields of the new/edit bill form. The amount is what the supplier asks for, tax
 * included; the GST/VAT inside it is optional ("Work it out" uses the business's rate).
 */
export function BillFields({
  bill,
  suppliers,
  categories,
  currencies,
  baseCurrency,
  tax,
  today,
  termsDays,
  maxFileMb,
}: {
  bill?: BillFormValues;
  suppliers: readonly string[];
  categories: readonly Option[];
  currencies: Option[];
  baseCurrency: string;
  /** The business's sales tax, or null when it doesn't charge one. */
  tax: { name: string; rateBp: number } | null;
  today: string;
  termsDays: number;
  maxFileMb: number;
}) {
  const [currency, setCurrency] = useState(bill?.currency ?? baseCurrency);
  const [amount, setAmount] = useState(bill?.amount ?? "");
  const [taxValue, setTaxValue] = useState(bill?.tax ?? "");
  const amountMinor = parseMoney(amount, currency);
  const listId = bill ? `bill-suppliers-${bill.id}` : "bill-suppliers";

  function workItOut() {
    if (!tax || amountMinor === null || amountMinor <= 0n) return;
    const rate = BigInt(tax.rateBp);
    const n = amountMinor * rate;
    const d = 10000n + rate;
    setTaxValue(toDecimalString((n * 2n + d) / (d * 2n), currency));
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {bill ? <input type="hidden" name="id" value={bill.id} /> : null}
      <TextField
        name="supplier"
        label={t("bills.supplier")}
        hint={t("bills.supplierHint")}
        list={listId}
        autoComplete="off"
        defaultValue={bill?.supplier}
        required
      />
      <datalist id={listId}>
        {suppliers.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <TextField
        name="reference"
        label={t("bills.reference")}
        hint={t("bills.referenceHint")}
        autoComplete="off"
        defaultValue={bill?.reference}
      />
      <TextField
        name="issueDate"
        label={t("bills.issueDate")}
        type="date"
        defaultValue={bill?.issueDate ?? today}
        required
      />
      <TextField
        name="dueDate"
        label={t("bills.dueDate")}
        hint={bill ? undefined : t("bills.dueDateHint", { days: termsDays })}
        type="date"
        defaultValue={bill?.dueDate}
      />
      <ComboboxField
        name="currency"
        label={t("finance.currency")}
        hint={t("bills.currencyHint")}
        options={currencies}
        value={currency}
        onValueChange={(next) => {
          if (next) setCurrency(next);
        }}
        required
      />
      <TextField
        name="amount"
        label={t("bills.amount")}
        hint={t("bills.amountHint")}
        inputMode="decimal"
        placeholder="0.00"
        autoComplete="off"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
      />
      {tax ? (
        <div className="grid content-start gap-2">
          <TextField
            name="tax"
            label={t("finance.taxIncluded", { tax: tax.name })}
            hint={t("bills.taxHint", { tax: tax.name })}
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
            value={taxValue}
            onChange={(e) => setTaxValue(e.target.value)}
          />
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={workItOut}
              disabled={amountMinor === null || amountMinor <= 0n}
            >
              {t("finance.taxWorkOut", { tax: tax.name, rate: String(tax.rateBp / 100) })}
            </Button>
          </div>
        </div>
      ) : null}
      <SelectField
        name="categoryId"
        label={t("finance.category")}
        hint={t("bills.categoryHint")}
        options={categories}
        placeholder={t("form.none")}
        defaultValue={bill?.categoryId ?? ""}
      />
      <TextAreaField
        name="notes"
        label={t("form.notes")}
        className="sm:col-span-2"
        rows={3}
        defaultValue={bill?.notes}
      />
      <TextField
        name="file"
        label={bill?.fileName ? t("bills.replaceFile") : t("bills.file")}
        hint={t("bills.fileHint", { mb: maxFileMb })}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
        className="sm:col-span-2"
      />
      {bill?.fileName ? (
        <CheckboxField
          name="removeFile"
          label={t("bills.removeFile", { name: bill.fileName })}
          className="sm:col-span-2"
        />
      ) : null}
    </div>
  );
}
