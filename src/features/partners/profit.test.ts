import { describe, expect, it } from "vitest";
import {
  calculateProfit,
  combineResults,
  holdingsFromPercentages,
  issueUnitsForInvestment,
  MICRO_MONTH,
  monthsCovered,
  profitRuleSchema,
  splitPeriod,
  transferUnits,
  type PartnerInput,
  type ProfitRule,
} from "./profit";

// Examples agreed in planning: A invests ৳1,00,000, B works. Profit ৳40,000, reserve 10%.
const A: PartnerInput = { partnerId: "A", capitalMinor: 100_000_00n, units: 500_000n, labor: 20n };
const B: PartnerInput = { partnerId: "B", capitalMinor: 0n, units: 500_000n, labor: 80n };
const base = { revenueMinor: 60_000_00n, expenseMinor: 20_000_00n, partners: [A, B] };

function rule(method: ProfitRule["method"], extra: Partial<ProfitRule> = {}): ProfitRule {
  return profitRuleSchema.parse({
    reserveBp: 1000,
    fees: [],
    method,
    lossMethod: "same_as_profit",
    ...extra,
  });
}

describe("calculateProfit", () => {
  it("capital ratio gives everything to the investor", () => {
    const r = calculateProfit({ ...base, rule: rule({ type: "capital_ratio" }) });
    expect(r.profitMinor).toBe(40_000_00n);
    expect(r.reserveMinor).toBe(4_000_00n);
    expect(r.lines.map((l) => l.totalMinor)).toEqual([36_000_00n, 0n]);
  });

  it("fixed percent 50/50", () => {
    const r = calculateProfit({
      ...base,
      rule: rule({
        type: "fixed_percent",
        shares: [
          { partnerId: "A", basisPoints: 5000 },
          { partnerId: "B", basisPoints: 5000 },
        ],
      }),
    });
    expect(r.lines.map((l) => l.totalMinor)).toEqual([18_000_00n, 18_000_00n]);
  });

  it("weighted 50% capital + 50% labour gives 60/40 with 20h vs 80h", () => {
    const r = calculateProfit({
      ...base,
      rule: rule({ type: "weighted", capitalWeightBp: 5000, laborWeightBp: 5000, laborSource: "manual" }),
    });
    expect(r.lines.map((l) => l.totalMinor)).toEqual([21_600_00n, 14_400_00n]);
  });

  it("pays fees before the split and the parts add up", () => {
    const r = calculateProfit({
      revenueMinor: 5_000_00n,
      expenseMinor: 1_500_00n,
      partners: [
        { partnerId: "A", capitalMinor: 6_000_00n, units: 600_000n, labor: 0n },
        { partnerId: "B", capitalMinor: 4_000_00n, units: 400_000n, labor: 0n },
      ],
      rule: rule(
        { type: "ownership_units" },
        { reserveBp: 2000, fees: [{ partnerId: "B", amountMinor: "100000" }] },
      ),
    });
    // profit 3,500 → reserve 700 → fee 1,000 → 1,800 split 60/40
    expect(r.reserveMinor).toBe(700_00n);
    expect(r.feesMinor).toBe(1_000_00n);
    expect(r.lines).toEqual([
      { partnerId: "A", feeMinor: 0n, shareMinor: 1_080_00n, totalMinor: 1_080_00n },
      { partnerId: "B", feeMinor: 1_000_00n, shareMinor: 720_00n, totalMinor: 1_720_00n },
    ]);
    expect(r.reserveMinor + r.lines.reduce((a, l) => a + l.totalMinor, 0n)).toBe(r.profitMinor);
  });

  it("pays fees pro rata when profit is too small", () => {
    const r = calculateProfit({
      revenueMinor: 500n,
      expenseMinor: 0n,
      partners: [A, B],
      rule: rule(
        { type: "ownership_units" },
        {
          reserveBp: 0,
          fees: [
            { partnerId: "A", amountMinor: "1000" },
            { partnerId: "B", amountMinor: "1000" },
          ],
        },
      ),
    });
    expect(r.lines.map((l) => l.feeMinor)).toEqual([250n, 250n]);
    expect(r.distributableMinor).toBe(0n);
  });

  it("shares a loss by ownership when configured", () => {
    const r = calculateProfit({
      revenueMinor: 0n,
      expenseMinor: 1_000_00n,
      partners: [
        { ...A, units: 750_000n },
        { ...B, units: 250_000n },
      ],
      rule: rule({ type: "capital_ratio" }, { lossMethod: "ownership_units" }),
    });
    expect(r.reserveMinor).toBe(0n);
    expect(r.lines.map((l) => l.totalMinor)).toEqual([-750_00n, -250_00n]);
  });

  it("rejects fixed percentages that do not add up to 100", () => {
    expect(() => rule({ type: "fixed_percent", shares: [{ partnerId: "A", basisPoints: 6000 }] })).toThrow();
  });

  it("combines segments", () => {
    const one = calculateProfit({ ...base, rule: rule({ type: "ownership_units" }) });
    const both = combineResults([one, one]);
    expect(both.profitMinor).toBe(80_000_00n);
    expect(both.lines.map((l) => l.totalMinor)).toEqual([36_000_00n, 36_000_00n]);
  });
});

describe("ownership", () => {
  it("dilutes on a new investment (60/40 → 45/30/25)", () => {
    const start = holdingsFromPercentages([
      { partnerId: "A", basisPoints: 6000 },
      { partnerId: "B", basisPoints: 4000 },
    ]);
    const after = issueUnitsForInvestment(start, "C", 30_000_00n, 10_000_00n);
    const total = after.reduce((a, h) => a + h.units, 0n);
    const pct = (id: string) =>
      Math.round(Number(((after.find((h) => h.partnerId === id)?.units ?? 0n) * 10000n) / total) / 100);
    expect([pct("A"), pct("B"), pct("C")]).toEqual([45, 30, 25]);
  });

  it("transfers units between partners", () => {
    const after = transferUnits(
      [
        { partnerId: "A", units: 600n },
        { partnerId: "B", units: 400n },
      ],
      "A",
      "C",
      100n,
    );
    expect(after).toEqual([
      { partnerId: "A", units: 500n },
      { partnerId: "B", units: 400n },
      { partnerId: "C", units: 100n },
    ]);
    expect(() => transferUnits(after, "B", "C", 1000n)).toThrow();
  });

  it("splits a period at change dates", () => {
    expect(splitPeriod("2026-01-01", "2026-12-31", ["2026-07-01"])).toEqual([
      ["2026-01-01", "2026-06-30"],
      ["2026-07-01", "2026-12-31"],
    ]);
    expect(splitPeriod("2026-01-01", "2026-01-31", ["2025-12-01", "2026-03-01"])).toEqual([
      ["2026-01-01", "2026-01-31"],
    ]);
  });
});

describe("monthly fees and empty periods", () => {
  it("counts whole months exactly and part months by days", () => {
    expect(monthsCovered("2026-01-01", "2026-01-31")).toBe(MICRO_MONTH);
    expect(monthsCovered("2026-01-01", "2026-03-31")).toBe(3n * MICRO_MONTH);
    // 14 of February's 28 days.
    expect(monthsCovered("2026-02-01", "2026-02-14")).toBe(MICRO_MONTH / 2n);
    expect(monthsCovered("2026-03-10", "2026-03-01")).toBe(0n);
  });

  it("pays a monthly fee for each month a distribution covers", () => {
    const withFee = rule({ type: "ownership_units" }, { fees: [{ partnerId: "B", amountMinor: "100000" }] });
    const quarter = calculateProfit({ ...base, rule: withFee, feeMonths: 3n * MICRO_MONTH });
    expect(quarter.feesMinor).toBe(300_000n);
    const halfMonth = calculateProfit({ ...base, rule: withFee, feeMonths: MICRO_MONTH / 2n });
    expect(halfMonth.feesMinor).toBe(50_000n);
  });

  it("keeps a period's profit as reserve when no partner was in it", () => {
    const r = calculateProfit({ ...base, partners: [], rule: rule({ type: "ownership_units" }) });
    expect(r.reserveMinor).toBe(r.profitMinor);
    expect(r.lines).toEqual([]);
  });
});
