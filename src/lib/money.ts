/**
 * Money is always an integer number of minor units (cents, paisa) as bigint,
 * together with an ISO 4217 currency code. Never use floats for amounts.
 */

/** Number of minor digits for a currency (AUD 2, JPY 0). */
export function minorDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** 123450n AUD → "$1,234.50" (locale-aware). */
export function formatMoney(minor: bigint, currency: string, locale = "en-AU"): string {
  const digits = minorDigits(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const unit = 10n ** BigInt(digits);
  const whole = abs / unit;
  const frac = abs % unit;
  const value = Number(`${whole}.${frac.toString().padStart(digits, "0")}`);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(negative ? -value : value);
}

/** Plain decimal string for inputs and exports: 123450n → "1234.50". */
export function toDecimalString(minor: bigint, currency: string): string {
  const digits = minorDigits(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  if (digits === 0) return `${negative ? "-" : ""}${abs}`;
  const unit = 10n ** BigInt(digits);
  return `${negative ? "-" : ""}${abs / unit}.${(abs % unit).toString().padStart(digits, "0")}`;
}

/**
 * Parses user input ("1,234.5", "1234", "-20.25") into minor units.
 * Returns null for anything that is not a plain number. Extra decimals round half up.
 */
export function parseMoney(input: string, currency: string): bigint | null {
  const cleaned = input.replace(/[,\s]/g, "").replace(/^[^\d.-]+/, "");
  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === "" || cleaned === "-" || cleaned === ".") {
    return null;
  }
  const digits = minorDigits(currency);
  const negative = cleaned.startsWith("-");
  const [wholeRaw = "0", fracRaw = ""] = cleaned.replace("-", "").split(".");
  const whole = BigInt(wholeRaw === "" ? "0" : wholeRaw);
  const padded = (fracRaw + "0".repeat(digits + 1)).slice(0, digits + 1);
  const kept = digits === 0 ? 0n : BigInt(padded.slice(0, digits));
  const roundDigit = Number(padded.slice(digits, digits + 1));
  let minor = whole * 10n ** BigInt(digits) + kept + (roundDigit >= 5 ? 1n : 0n);
  if (negative) minor = -minor;
  return minor;
}

/** amount × basisPoints / 10000, rounded half up (away from zero). 1000 bp = 10%. */
export function applyBasisPoints(amount: bigint, basisPoints: number): bigint {
  const bp = BigInt(basisPoints);
  const product = amount * bp;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + 5000n) / 10000n;
  return negative ? -rounded : rounded;
}

/**
 * Splits `total` across `weights` so the parts add up exactly to `total`
 * (largest remainder method). Zero total weight gives equal parts.
 */
export function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) return [];
  if (weights.some((w) => w < 0n)) throw new Error("Weights must not be negative");
  const sum = weights.reduce((a, b) => a + b, 0n);
  const effective = sum === 0n ? weights.map(() => 1n) : weights;
  const totalWeight = sum === 0n ? BigInt(weights.length) : sum;
  const negative = total < 0n;
  const abs = negative ? -total : total;

  const parts = effective.map((w) => (abs * w) / totalWeight);
  const remainders = effective.map((w, i) => ({ i, r: (abs * w) % totalWeight }));
  let leftover = abs - parts.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    parts[i] = (parts[i] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return negative ? parts.map((p) => -p) : parts;
}

/** Share of `part` in `whole` as basis points (2500 = 25.00%). */
export function shareBasisPoints(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  return Number((part * 1_000_000n) / whole) / 100;
}

/** Sum of bigints. */
export function sum(values: readonly bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}

/** "12.5" or "12.5%" → 1250 basis points. Up to two decimals; null if invalid or outside 0–100. */
export function parsePercentBp(input: string): number | null {
  const s = input.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return bp <= 10000 ? bp : null;
}
