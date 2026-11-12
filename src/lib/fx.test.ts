import { describe, expect, it } from "vitest";
import { convertMinor, formatRate, invertRate, isRate, previewConversion } from "./fx";

describe("isRate / formatRate", () => {
  it("accepts positive decimals with up to 8 places", () => {
    expect(isRate("1")).toBe(true);
    expect(isRate("0.01273457")).toBe(true);
    expect(isRate("0")).toBe(false);
    expect(isRate("")).toBe(false);
    expect(isRate("-1")).toBe(false);
    expect(isRate("1.123456789")).toBe(false);
    expect(isRate("1,5")).toBe(false);
  });

  it("rounds to 8 decimals and trims zeros", () => {
    expect(formatRate(0.012734567891)).toBe("0.01273457");
    expect(formatRate(1.5)).toBe("1.5");
    expect(formatRate(2)).toBe("2");
    expect(formatRate(0)).toBeNull();
    expect(formatRate(Number.NaN)).toBeNull();
    expect(formatRate(1e-10)).toBeNull();
  });

  it("inverts a quote", () => {
    expect(invertRate(4)).toBe(0.25);
    expect(invertRate(0)).toBeNull();
  });
});

describe("convertMinor", () => {
  it("matches the ledger's rounding for same-decimal currencies", () => {
    expect(convertMinor(10000n, "1.52345678", "USD", "AUD")).toBe(15235n);
    expect(convertMinor(333n, "0.5", "USD", "AUD")).toBe(167n);
    expect(convertMinor(1_200_000n, "0.0127", "BDT", "AUD")).toBe(15240n);
  });

  it("scales between currencies with different decimals", () => {
    // ¥1,000 at 0.0105 AUD per yen = A$10.50
    expect(convertMinor(1000n, "0.0105", "JPY", "AUD")).toBe(1050n);
    // A$10.00 at 95.2381 yen per dollar = ¥952
    expect(convertMinor(1000n, "95.2381", "AUD", "JPY")).toBe(952n);
  });

  it("rounds negatives away from zero", () => {
    expect(convertMinor(-333n, "0.5", "USD", "AUD")).toBe(-167n);
  });
});

describe("previewConversion", () => {
  it("returns both amounts once amount and rate are valid", () => {
    expect(previewConversion("12,000", "0.0127", "BDT", "AUD")).toEqual({
      amountMinor: 1_200_000n,
      baseMinor: 15240n,
    });
  });

  it("is null while input is incomplete", () => {
    expect(previewConversion("", "0.0127", "BDT", "AUD")).toBeNull();
    expect(previewConversion("100", "", "BDT", "AUD")).toBeNull();
    expect(previewConversion("abc", "1", "BDT", "AUD")).toBeNull();
    expect(previewConversion("0", "1", "BDT", "AUD")).toBeNull();
  });
});
