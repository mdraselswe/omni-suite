import { z } from "zod";

/** One line on a proposal or invoice. Money as minor-unit strings (JSON-safe). */
export type LineItem = { description: string; quantity: string; unitPriceMinor: string; taxRateBp: number };

export const lineItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
  unitPriceMinor: z.string().regex(/^-?\d+$/),
  taxRateBp: z.number().int().min(0).max(10000),
});

export type Totals = { subtotalMinor: bigint; taxMinor: bigint; totalMinor: bigint; lineAmounts: bigint[] };

/** quantity (up to 3 decimals) × unit price, rounded half up. */
export function lineAmount(item: Pick<LineItem, "quantity" | "unitPriceMinor">): bigint {
  const [whole = "0", frac = ""] = item.quantity.split(".");
  const qty1000 = BigInt(whole) * 1000n + BigInt(frac.padEnd(3, "0").slice(0, 3));
  const raw = qty1000 * BigInt(item.unitPriceMinor);
  const half = raw >= 0n ? 500n : -500n;
  return (raw + half) / 1000n;
}

function divRound(n: bigint, d: bigint): bigint {
  const half = d / 2n;
  return n >= 0n ? (n + half) / d : -((-n + half) / d);
}

/**
 * Totals with tax per line. When prices include tax (common in Australia for
 * GST-inclusive pricing), tax = amount × rate / (1 + rate).
 */
export function computeTotals(items: readonly LineItem[], pricesIncludeTax: boolean): Totals {
  let net = 0n;
  let tax = 0n;
  const lineAmounts: bigint[] = [];
  for (const item of items) {
    const amount = lineAmount(item);
    lineAmounts.push(amount);
    const rate = BigInt(item.taxRateBp);
    if (pricesIncludeTax) {
      const lineTax = divRound(amount * rate, 10000n + rate);
      tax += lineTax;
      net += amount - lineTax;
    } else {
      tax += divRound(amount * rate, 10000n);
      net += amount;
    }
  }
  return { subtotalMinor: net, taxMinor: tax, totalMinor: net + tax, lineAmounts };
}

/** Number with a prefix and zero padding: ("INV-", 7) → "INV-0007". */
export function formatDocNumber(prefix: string, value: number): string {
  return `${prefix}${String(value).padStart(4, "0")}`;
}
