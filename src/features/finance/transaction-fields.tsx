"use client";

import { useState } from "react";
import { SelectField, TextField } from "@/components/form/field";
import { t } from "@/i18n";

type Option = { value: string; label: string };

const KINDS = ["income", "expense", "transfer", "capital_in", "drawing"] as const;

/** Fields of the "record a transaction" form; shows only what the chosen type needs. */
export function TransactionFields({
  accounts,
  categories,
  partners,
  clients,
  today,
  defaultKind = "expense",
}: {
  accounts: Option[];
  categories: { value: string; name: string; kind: "income" | "expense" }[];
  partners: Option[];
  clients: Option[];
  today: string;
  defaultKind?: (typeof KINDS)[number];
}) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>(defaultKind);
  const cats = categories.filter((c) => c.kind === kind).map((c) => ({ value: c.value, label: c.name }));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        name="kind"
        label={t("finance.kind")}
        value={kind}
        onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
        options={KINDS.map((k) => ({ value: k, label: t(`finance.kind.${k}`) }))}
      />
      <TextField name="date" label={t("form.date.label")} type="date" defaultValue={today} required />
      <SelectField
        name="accountId"
        label={kind === "transfer" ? t("finance.from") : t("finance.account")}
        options={accounts}
      />
      {kind === "transfer" ? (
        <SelectField
          name="toAccountId"
          label={t("finance.toAccount")}
          options={accounts}
          placeholder={t("form.choose")}
        />
      ) : null}
      {kind === "income" || kind === "expense" ? (
        <SelectField
          name="categoryId"
          label={t("finance.category")}
          options={cats}
          placeholder={t("form.none")}
        />
      ) : null}
      {kind === "capital_in" || kind === "drawing" ? (
        <SelectField name="partnerId" label={t("finance.partner")} options={partners} />
      ) : null}
      {kind === "income" ? (
        <SelectField
          name="clientId"
          label={t("finance.client")}
          options={clients}
          placeholder={t("form.none")}
        />
      ) : null}
      <TextField name="amount" label={t("finance.amount")} inputMode="decimal" placeholder="0.00" required />
      <TextField name="description" label={t("form.description")} className="sm:col-span-2" />
      <TextField
        name="fxRate"
        label={t("finance.fxRate")}
        hint={t("finance.fxHint")}
        inputMode="decimal"
        placeholder="1"
        className="sm:col-span-2"
      />
    </div>
  );
}
