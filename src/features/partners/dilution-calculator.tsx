"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { formatMoney, parseMoney, shareBasisPoints, sum } from "@/lib/money";
import { issueUnitsForInvestment } from "./profit";

const NEW_ID = "__new__";

/**
 * What-if calculator: how ownership changes if someone invests at a valuation.
 * Pure client-side maths, nothing is saved.
 */
export function DilutionCalculator({
  holdings,
  currency,
  locale,
}: {
  holdings: { partnerId: string; name: string; units: string }[];
  currency: string;
  locale: string;
}) {
  const [preMoney, setPreMoney] = useState("100000");
  const [investment, setInvestment] = useState("25000");
  const pre = parseMoney(preMoney, currency);
  const inv = parseMoney(investment, currency);
  const before = holdings.map((h) => ({ partnerId: h.partnerId, units: BigInt(h.units) }));
  const totalBefore = sum(before.map((h) => h.units));
  let after: { partnerId: string; units: bigint }[] | null = null;
  if (pre && inv && pre > 0n && inv > 0n && totalBefore > 0n) {
    after = issueUnitsForInvestment(before, NEW_ID, pre, inv);
  }
  const totalAfter = after ? sum(after.map((h) => h.units)) : 0n;
  const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`;
  const names = new Map(holdings.map((h) => [h.partnerId, h.name]));

  return (
    <div className="grid gap-4 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="calc-pre">{t("partners.preMoney")}</Label>
          <Input
            id="calc-pre"
            inputMode="decimal"
            value={preMoney}
            onChange={(e) => setPreMoney(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="calc-inv">{t("partners.investment")}</Label>
          <Input
            id="calc-inv"
            inputMode="decimal"
            value={investment}
            onChange={(e) => setInvestment(e.target.value)}
          />
        </div>
      </div>
      {after ? (
        <table className="w-full text-sm" aria-live="polite">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-medium">{t("partners.name")}</th>
              <th className="py-1 text-right font-medium">{t("partners.before")}</th>
              <th className="py-1 text-right font-medium">{t("partners.after")}</th>
            </tr>
          </thead>
          <tbody>
            {after.map((h) => {
              const prev = before.find((b) => b.partnerId === h.partnerId)?.units ?? 0n;
              return (
                <tr key={h.partnerId} className="border-t">
                  <td className="py-1.5">{names.get(h.partnerId) ?? t("partners.new")}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {pct(shareBasisPoints(prev, totalBefore))}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {pct(shareBasisPoints(h.units, totalAfter))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted-foreground">{t("partners.noOwnership")}</p>
      )}
      {pre && inv ? (
        <p className="text-xs text-muted-foreground">
          {formatMoney(pre, currency, locale)} + {formatMoney(inv, currency, locale)} ={" "}
          {formatMoney(pre + inv, currency, locale)}
        </p>
      ) : null}
    </div>
  );
}
