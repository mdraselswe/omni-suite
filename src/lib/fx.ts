import { minorDigits, parseMoney } from "./money";

/**
 * Exchange-rate helpers. A rate is a decimal string: units of the base currency
 * for 1 unit of the foreign currency, up to 8 decimals (what the ledger stores).
 */

export const RATE_DECIMALS = 8;
const RATE_PATTERN = /^\d+(\.\d{1,8})?$/;

/** "0.01273" → true; "", "0", "abc", "1.123456789" → false. */
export function isRate(input: string): boolean {
  return RATE_PATTERN.test(input) && Number(input) > 0;
}

/** 0.012734567891 → "0.01273457"; null if it isn't a positive rate that fits 8 decimals. */
export function formatRate(rate: number): string | null {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const fixed = rate.toFixed(RATE_DECIMALS).replace(/\.?0+$/, "");
  return isRate(fixed) ? fixed : null;
}

/** 1 / rate, for providers that quote the other direction. */
export function invertRate(rate: number): number | null {
  return Number.isFinite(rate) && rate > 0 ? 1 / rate : null;
}

/**
 * Converts minor units of `from` into minor units of `to` at `rate`
 * (base per 1 foreign unit), rounding half away from zero. Handles currencies
 * with different decimals (JPY 0, AUD 2, KWD 3).
 */
export function convertMinor(amountMinor: bigint, rate: string, from: string, to: string): bigint {
  const [whole = "0", frac = ""] = rate.split(".");
  const scaledRate = BigInt(whole + frac.padEnd(RATE_DECIMALS, "0").slice(0, RATE_DECIMALS));
  const numerator = amountMinor * scaledRate * 10n ** BigInt(minorDigits(to));
  const denominator = 10n ** BigInt(RATE_DECIMALS + minorDigits(from));
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const rounded = (abs * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}

/** Typed amount + typed rate → base amount in minor units, or null while either is incomplete. */
export function previewConversion(
  amountInput: string,
  rateInput: string,
  from: string,
  to: string,
): { amountMinor: bigint; baseMinor: bigint } | null {
  const rate = rateInput.trim();
  if (!isRate(rate)) return null;
  const amountMinor = parseMoney(amountInput, from);
  if (amountMinor === null || amountMinor <= 0n) return null;
  return { amountMinor, baseMinor: convertMinor(amountMinor, rate, from, to) };
}
