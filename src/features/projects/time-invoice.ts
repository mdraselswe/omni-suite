import { lineAmount, type LineItem } from "@/lib/line-items";

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
  return [...groups.values()].map((g) => {
    // Hours with 3 decimals are exact only for multiples of 3 minutes (20 min = 0.333 h would
    // under-bill). Otherwise bill one line at the exact amount, with the hours in the text.
    const exact = (g.minutes * 1000) % 60 === 0;
    const description = options.describe(g.membershipId);
    if (exact) {
      return {
        description: description.slice(0, 500),
        quantity: hoursQuantity(g.minutes),
        unitPriceMinor: g.rate.toString(),
        taxRateBp: options.taxRateBp,
      };
    }
    const minutes = BigInt(g.minutes);
    const amount = (minutes * g.rate * 2n + 60n) / 120n;
    return {
      description: `${description} · ${hoursQuantity(g.minutes)} h`.slice(0, 500),
      quantity: "1",
      unitPriceMinor: amount.toString(),
      taxRateBp: options.taxRateBp,
    };
  });
}

/** What the time will be invoiced at (before tax): the same lines the invoice gets. */
export function timeValue(entries: readonly Entry[]): bigint {
  return timeInvoiceLines(entries, { taxRateBp: 0, describe: () => "" }).reduce(
    (sum, line) => sum + lineAmount(line),
    0n,
  );
}
