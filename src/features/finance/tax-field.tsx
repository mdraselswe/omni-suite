"use client";

import { useState } from "react";
import { TextField } from "@/components/form/field";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { parseMoney, toDecimalString } from "@/lib/money";

/**
 * The GST/VAT inside an income or expense amount. Optional: leave empty when the
 * supplier didn't charge tax. "Work it out" fills amount × rate ÷ (1 + rate).
 */
export function TaxField({
  tax,
  currency,
  amount,
}: {
  tax: { name: string; rateBp: number };
  currency: string;
  amount: string;
}) {
  const [value, setValue] = useState("");
  const amountMinor = parseMoney(amount, currency);

  function workItOut() {
    if (amountMinor === null || amountMinor <= 0n) return;
    const rate = BigInt(tax.rateBp);
    const n = amountMinor * rate;
    const d = 10000n + rate;
    setValue(toDecimalString((n * 2n + d) / (d * 2n), currency));
  }

  return (
    <div className="grid gap-2 sm:col-span-2">
      <TextField
        name="tax"
        label={t("finance.taxIncluded", { tax: tax.name })}
        hint={t("finance.taxIncludedHint", { tax: tax.name })}
        inputMode="decimal"
        placeholder="0.00"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
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
  );
}
