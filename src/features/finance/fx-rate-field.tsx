"use client";

import { useState, useTransition } from "react";
import { TextField } from "@/components/form/field";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { previewConversion } from "@/lib/fx";
import { formatMoney } from "@/lib/money";
import { todaysRateAction } from "./actions";

/** What the transaction form needs to know about exchange rates (built by `transactionFx`). */
export type TransactionFx = {
  tenant: string;
  /** Business (base) currency. */
  base: string;
  locale: string;
  /** Whether a rate provider is configured ("Use today's rate" shows only then). */
  rates: boolean;
  attributionUrl: string;
  /** The business's sales tax (GST/VAT), or null when it doesn't charge one. */
  tax: { name: string; rateBp: number } | null;
};

type Status = { kind: "idle" } | { kind: "failed" } | { kind: "filled"; asOf: string };

/**
 * Exchange-rate input for an account in another currency: optional "Use today's
 * rate" (always editable, bank and card rates differ) and a live preview of the
 * amount in the business currency. Renders nothing for base-currency accounts.
 * Give it `key={currency}` so switching accounts starts fresh.
 */
export function FxRateField({
  fx,
  currency,
  amount,
}: {
  fx: TransactionFx;
  currency: string;
  amount: string;
}) {
  const [rate, setRate] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  if (currency === fx.base) return null;

  const preview = previewConversion(amount, rate, currency, fx.base);

  function fillToday() {
    startTransition(async () => {
      try {
        const quote = await todaysRateAction(fx.tenant, currency);
        if (quote) {
          setRate(quote.rate);
          setStatus({ kind: "filled", asOf: quote.asOf });
        } else {
          setStatus({ kind: "failed" });
        }
      } catch {
        setStatus({ kind: "failed" });
      }
    });
  }

  return (
    <div className="grid gap-2 sm:col-span-2">
      <TextField
        name="fxRate"
        label={t("fx.rateLabel", { from: currency, to: fx.base })}
        hint={t("fx.rateHint")}
        inputMode="decimal"
        placeholder="0.00"
        autoComplete="off"
        value={rate}
        onChange={(e) => {
          setRate(e.target.value);
          setStatus({ kind: "idle" });
        }}
        required
      />
      {fx.rates ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fillToday}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? t("fx.loading") : t("fx.useToday")}
          </Button>
          <a
            href={fx.attributionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            {t("fx.attribution")}
          </a>
          {/* Kept mounted so screen readers announce the result of the click. */}
          <p role="status" className="basis-full text-xs text-muted-foreground">
            {status.kind === "failed" ? t("fx.failed") : null}
            {status.kind === "filled"
              ? t("fx.filled", {
                  date: new Intl.DateTimeFormat(fx.locale, { dateStyle: "medium" }).format(
                    new Date(status.asOf),
                  ),
                })
              : null}
          </p>
        </div>
      ) : null}
      {preview ? (
        <p className="text-sm font-medium tabular-nums">
          <span className="sr-only">{t("fx.previewLabel", { currency: fx.base })}: </span>
          {t("fx.preview", {
            amount: formatMoney(preview.amountMinor, currency, fx.locale),
            base: formatMoney(preview.baseMinor, fx.base, fx.locale),
          })}
        </p>
      ) : null}
    </div>
  );
}
