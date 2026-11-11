"use client";

import { useState } from "react";
import { SelectField, TextField } from "@/components/form/field";
import { t } from "@/i18n";

const METHODS = ["capital_ratio", "ownership_units", "fixed_percent", "weighted"] as const;
type Method = (typeof METHODS)[number];

/** Fields for proposing a profit rule; the method decides which inputs appear. */
export function RuleFields({ partners, today }: { partners: { id: string; name: string }[]; today: string }) {
  const [method, setMethod] = useState<Method>("ownership_units");
  const [laborSource, setLaborSource] = useState<"time_entries" | "manual">("time_entries");
  return (
    <div className="grid gap-4">
      <SelectField
        name="method"
        label={t("rules.method")}
        value={method}
        onChange={(e) => setMethod(e.target.value as Method)}
        options={METHODS.map((m) => ({ value: m, label: t(`rules.method.${m}`) }))}
        hint={t(`rules.methodHint.${method}`)}
      />
      {method === "fixed_percent" ? (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">{t("partners.percent")}</legend>
          {partners.map((p) => (
            <TextField
              key={p.id}
              name={`share_${p.id}`}
              label={p.name}
              inputMode="decimal"
              placeholder="50"
              defaultValue={partners.length > 0 ? String(Math.floor(100 / partners.length)) : ""}
            />
          ))}
        </fieldset>
      ) : null}
      {method === "weighted" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            name="capitalWeight"
            label={t("rules.capitalWeight")}
            inputMode="decimal"
            defaultValue="60"
          />
          <SelectField
            name="laborSource"
            label={t("rules.laborSource")}
            value={laborSource}
            onChange={(e) => setLaborSource(e.target.value as "time_entries" | "manual")}
            options={[
              { value: "time_entries", label: t("rules.laborSource.time_entries") },
              { value: "manual", label: t("rules.laborSource.manual") },
            ]}
          />
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="reserve" label={t("rules.reserve")} inputMode="decimal" defaultValue="0" />
        <SelectField
          name="lossMethod"
          label={t("rules.lossMethod")}
          options={[
            { value: "same_as_profit", label: t("rules.lossMethod.same_as_profit") },
            { value: "ownership_units", label: t("rules.lossMethod.ownership_units") },
          ]}
        />
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">{t("rules.fees")}</legend>
        <p className="text-xs text-muted-foreground sm:col-span-2">{t("rules.feesHint")}</p>
        {partners.map((p) => (
          <TextField key={p.id} name={`fee_${p.id}`} label={p.name} inputMode="decimal" placeholder="0.00" />
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="effectiveFrom"
          label={t("rules.effectiveFrom")}
          type="date"
          defaultValue={today}
          required
        />
        <TextField name="note" label={t("rules.note")} />
      </div>
    </div>
  );
}
