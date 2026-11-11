"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { computeTotals, type LineItem } from "@/lib/line-items";
import { formatMoney, parseMoney, parsePercentBp, toDecimalString } from "@/lib/money";
import { FieldError } from "./action-form";

type Row = { description: string; quantity: string; unitPrice: string; taxPercent: string };

/** Editable invoice/proposal lines with live totals. Submits as JSON in `items`. */
export function LineItemsEditor({
  initial,
  currency,
  locale,
  defaultTaxBp,
  pricesIncludeTax,
  taxName,
}: {
  initial?: LineItem[];
  currency: string;
  locale: string;
  defaultTaxBp: number;
  pricesIncludeTax: boolean;
  taxName: string;
}) {
  const defaultTax = String(defaultTaxBp / 100);
  const [rows, setRows] = useState<Row[]>(
    initial && initial.length > 0
      ? initial.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unitPrice: toDecimalString(BigInt(i.unitPriceMinor), currency),
          taxPercent: String(i.taxRateBp / 100),
        }))
      : [{ description: "", quantity: "1", unitPrice: "", taxPercent: defaultTax }],
  );
  const update = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const valid: LineItem[] = rows.flatMap((r) => {
    const price = parseMoney(r.unitPrice, currency);
    const tax = parsePercentBp(r.taxPercent || "0");
    return price !== null && tax !== null && /^\d+(\.\d{1,3})?$/.test(r.quantity || "1")
      ? [
          {
            description: r.description,
            quantity: r.quantity || "1",
            unitPriceMinor: price.toString(),
            taxRateBp: tax,
          },
        ]
      : [];
  });
  const totals = computeTotals(valid, pricesIncludeTax);
  const money = (m: bigint) => formatMoney(m, currency, locale);

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium">{t("items.title")}</legend>
      <input type="hidden" name="items" value={JSON.stringify(rows)} />
      {rows.map((row, i) => (
        <div
          key={i}
          className="grid grid-cols-6 gap-2 rounded-md border p-2 sm:grid-cols-12 sm:border-0 sm:p-0"
        >
          <Input
            aria-label={t("items.description")}
            placeholder={t("items.description")}
            value={row.description}
            onChange={(e) => update(i, { description: e.target.value })}
            className="col-span-6 sm:col-span-5"
          />
          <Input
            aria-label={t("items.quantity")}
            inputMode="decimal"
            value={row.quantity}
            onChange={(e) => update(i, { quantity: e.target.value })}
            className="col-span-2 sm:col-span-1"
          />
          <Input
            aria-label={t("items.price")}
            placeholder={t("items.price")}
            inputMode="decimal"
            value={row.unitPrice}
            onChange={(e) => update(i, { unitPrice: e.target.value })}
            className="col-span-2 sm:col-span-3"
          />
          <Input
            aria-label={t("items.tax")}
            inputMode="decimal"
            value={row.taxPercent}
            onChange={(e) => update(i, { taxPercent: e.target.value })}
            className="col-span-1 sm:col-span-2"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("items.remove")}
            disabled={rows.length === 1}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            className="col-span-1"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() =>
          setRows([...rows, { description: "", quantity: "1", unitPrice: "", taxPercent: defaultTax }])
        }
      >
        <Plus aria-hidden="true" />
        {t("items.add")}
      </Button>
      <FieldError name="items" />
      <dl className="grid justify-end gap-1 text-sm tabular-nums">
        <div className="flex justify-between gap-8">
          <dt className="text-muted-foreground">{t("items.subtotal")}</dt>
          <dd>{money(totals.subtotalMinor)}</dd>
        </div>
        <div className="flex justify-between gap-8">
          <dt className="text-muted-foreground">{taxName}</dt>
          <dd>{money(totals.taxMinor)}</dd>
        </div>
        <div className="flex justify-between gap-8 font-semibold">
          <dt>{t("items.total")}</dt>
          <dd>{money(totals.totalMinor)}</dd>
        </div>
      </dl>
      <p className="justify-self-end text-xs text-muted-foreground">
        {t(pricesIncludeTax ? "items.taxIncluded" : "items.taxExcluded", { tax: taxName })}
      </p>
    </fieldset>
  );
}
