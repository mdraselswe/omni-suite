import type { LineItem } from "@/lib/line-items";

type Entry = { membershipId: string; minutes: number; hourlyRateMinor: bigint };

/** Minutes → hours as an invoice quantity with up to 3 decimals ("1.5", "0.333"). */
export function hoursQuantity(minutes: number): string {
  const thousandths = Math.round((minutes * 1000) / 60);
  const whole = Math.floor(thousandths / 1000);
  const frac = String(thousandths % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/**
 * Invoice lines for time entries: one line per person and hourly rate (a rate change
 * mid-project gives that person two lines), in the order people first appear.
 */
export function timeInvoiceLines(
  entries: readonly Entry[],
  options: { taxRateBp: number; describe: (membershipId: string) => string },
): LineItem[] {
  const groups = new Map<string, { membershipId: string; rate: bigint; minutes: number }>();
  for (const e of entries) {
    const key = `${e.membershipId}:${e.hourlyRateMinor}`;
    const group = groups.get(key);
    if (group) group.minutes += e.minutes;
    else groups.set(key, { membershipId: e.membershipId, rate: e.hourlyRateMinor, minutes: e.minutes });
  }
  return [...groups.values()].map((g) => ({
    description: options.describe(g.membershipId).slice(0, 500),
    quantity: hoursQuantity(g.minutes),
    unitPriceMinor: g.rate.toString(),
    taxRateBp: options.taxRateBp,
  }));
}
