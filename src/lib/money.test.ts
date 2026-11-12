import { describe, expect, it } from "vitest";
import {
  allocate,
  allocateShare,
  applyBasisPoints,
  formatMoney,
  parseMoney,
  shareBasisPoints,
  toDecimalString,
} from "./money";

describe("money", () => {
  it("formats minor units", () => {
    expect(formatMoney(123450n, "AUD", "en-AU")).toBe("$1,234.50");
    expect(formatMoney(-5n, "AUD", "en-AU")).toBe("-$0.05");
    expect(toDecimalString(123450n, "AUD")).toBe("1234.50");
    expect(toDecimalString(-7n, "AUD")).toBe("-0.07");
  });

  it("parses user input", () => {
    expect(parseMoney("1,234.5", "AUD")).toBe(123450n);
    expect(parseMoney("10", "BDT")).toBe(1000n);
    expect(parseMoney("0.005", "AUD")).toBe(1n);
    expect(parseMoney("-20.25", "AUD")).toBe(-2025n);
    expect(parseMoney("abc", "AUD")).toBeNull();
    expect(parseMoney("", "AUD")).toBeNull();
  });

  it("applies basis points with half-up rounding", () => {
    expect(applyBasisPoints(10000n, 1000)).toBe(1000n);
    expect(applyBasisPoints(15n, 1000)).toBe(2n);
    expect(applyBasisPoints(-15n, 1000)).toBe(-2n);
  });

  it("allocates exactly", () => {
    expect(allocate(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocate(3600000n, [6n, 4n])).toEqual([2160000n, 1440000n]);
    expect(allocate(-100n, [1n, 1n, 1n])).toEqual([-34n, -33n, -33n]);
    expect(allocate(10n, [0n, 0n])).toEqual([5n, 5n]);
    const parts = allocate(999_999n, [3n, 7n, 11n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(999_999n);
  });

  it("computes shares", () => {
    expect(shareBasisPoints(1n, 4n)).toBe(2500);
    expect(shareBasisPoints(1n, 0n)).toBe(0);
  });
});

describe("parsePercentBp", () => {
  it("parses percentages into basis points", async () => {
    const { parsePercentBp } = await import("./money");
    expect(parsePercentBp("12.5")).toBe(1250);
    expect(parsePercentBp("50%")).toBe(5000);
    expect(parsePercentBp("100")).toBe(10000);
    expect(parsePercentBp("100.01")).toBeNull();
    expect(parsePercentBp("abc")).toBeNull();
    expect(parsePercentBp("0.05")).toBe(5);
  });
});

describe("signs, shares and rounding", () => {
  it("reads a minus before or after a currency symbol, and accounting brackets", () => {
    expect(parseMoney("-$20", "AUD")).toBe(-2000n);
    expect(parseMoney("$-20.50", "AUD")).toBe(-2050n);
    expect(parseMoney("(20)", "AUD")).toBe(-2000n);
    expect(parseMoney("--20", "AUD")).toBeNull();
    expect(parseMoney("(-20)", "AUD")).toBeNull();
    expect(parseMoney("$1,234.56", "AUD")).toBe(123456n);
  });

  it("allocates a share of a total, rounded half up", () => {
    // GST inside a third of a $110 invoice: 10 × 33.33 / 110.
    expect(allocateShare(1000n, 3333n, 11000n)).toBe(303n);
    expect(allocateShare(1000n, 11000n, 11000n)).toBe(1000n);
    expect(allocateShare(1000n, 0n, 11000n)).toBe(0n);
    expect(allocateShare(1000n, 5n, 0n)).toBe(0n);
  });

  it("rounds ownership percentages instead of cutting them", () => {
    // 2 of 3 units = 66.6667% → 6666.67 bp, not 6666.66.
    expect(shareBasisPoints(2n, 3n)).toBe(6666.67);
    expect(shareBasisPoints(1n, 3n)).toBe(3333.33);
  });
});
