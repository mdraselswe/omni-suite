import { z } from "zod";
import { allocate, applyBasisPoints, sum } from "@/lib/money";

/**
 * Configurable profit sharing (ADR 0006). Pure functions: no database access.
 *
 * Waterfall for a positive profit:
 *   1. reserve (basis points of profit) stays in the business
 *   2. fixed partner fees (pro rata if the profit can't cover them all)
 *   3. the rest is split by the chosen method
 * A loss (profit ≤ 0) skips reserve and fees and is shared by `lossMethod`.
 */

const bigintString = z.string().regex(/^\d+$/, "Whole minor units");

export const splitMethodSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("capital_ratio") }),
  z.object({ type: z.literal("ownership_units") }),
  z.object({
    type: z.literal("fixed_percent"),
    shares: z
      .array(z.object({ partnerId: z.string().min(1), basisPoints: z.number().int().min(0).max(10000) }))
      .min(1)
      .refine((s) => s.reduce((a, b) => a + b.basisPoints, 0) === 10000, "Shares must add up to 100%"),
  }),
  z
    .object({
      type: z.literal("weighted"),
      capitalWeightBp: z.number().int().min(0).max(10000),
      laborWeightBp: z.number().int().min(0).max(10000),
      laborSource: z.enum(["time_entries", "manual"]),
    })
    .refine((m) => m.capitalWeightBp + m.laborWeightBp === 10000, "Weights must add up to 100%"),
]);

export const profitRuleSchema = z.object({
  reserveBp: z.number().int().min(0).max(10000),
  fees: z.array(z.object({ partnerId: z.string().min(1), amountMinor: bigintString })),
  method: splitMethodSchema,
  lossMethod: z.enum(["same_as_profit", "ownership_units"]),
});

export type ProfitRule = z.infer<typeof profitRuleSchema>;
export type SplitMethod = z.infer<typeof splitMethodSchema>;

export type PartnerInput = {
  partnerId: string;
  /** Capital contributed up to the end of the segment (base currency minor units). */
  capitalMinor: bigint;
  /** Ownership units held during the segment. */
  units: bigint;
  /** Labour measure for the weighted method (minutes logged, or points). */
  labor: bigint;
};

export type ProfitLine = {
  partnerId: string;
  feeMinor: bigint;
  shareMinor: bigint;
  totalMinor: bigint;
};

export type ProfitResult = {
  profitMinor: bigint;
  reserveMinor: bigint;
  feesMinor: bigint;
  distributableMinor: bigint;
  lines: ProfitLine[];
};

/** Weights for each partner (same order as `partners`) under a split method. */
export function splitWeights(method: SplitMethod, partners: readonly PartnerInput[]): bigint[] {
  switch (method.type) {
    case "capital_ratio":
      return partners.map((p) => p.capitalMinor);
    case "ownership_units":
      return partners.map((p) => p.units);
    case "fixed_percent":
      return partners.map((p) =>
        BigInt(method.shares.find((s) => s.partnerId === p.partnerId)?.basisPoints ?? 0),
      );
    case "weighted": {
      // weight_i = capW · cap_i/C + labW · lab_i/L, scaled by C·L to stay in integers.
      const C = sum(partners.map((p) => p.capitalMinor));
      const L = sum(partners.map((p) => p.labor));
      const capW = BigInt(method.capitalWeightBp);
      const labW = BigInt(method.laborWeightBp);
      if (C === 0n && L === 0n) return partners.map(() => 0n);
      if (C === 0n) return partners.map((p) => p.labor);
      if (L === 0n) return partners.map((p) => p.capitalMinor);
      return partners.map((p) => capW * p.capitalMinor * L + labW * p.labor * C);
    }
  }
}

export function calculateProfit(input: {
  revenueMinor: bigint;
  expenseMinor: bigint;
  partners: readonly PartnerInput[];
  rule: ProfitRule;
}): ProfitResult {
  const { partners, rule } = input;
  const profitMinor = input.revenueMinor - input.expenseMinor;
  const zeroLines = () =>
    partners.map((p) => ({ partnerId: p.partnerId, feeMinor: 0n, shareMinor: 0n, totalMinor: 0n }));

  if (partners.length === 0) {
    return { profitMinor, reserveMinor: 0n, feesMinor: 0n, distributableMinor: 0n, lines: [] };
  }

  if (profitMinor <= 0n) {
    const method: SplitMethod =
      rule.lossMethod === "ownership_units" ? { type: "ownership_units" } : rule.method;
    const shares = allocate(profitMinor, splitWeights(method, partners));
    return {
      profitMinor,
      reserveMinor: 0n,
      feesMinor: 0n,
      distributableMinor: profitMinor,
      lines: zeroLines().map((l, i) => ({
        ...l,
        shareMinor: shares[i] ?? 0n,
        totalMinor: shares[i] ?? 0n,
      })),
    };
  }

  const reserveMinor = applyBasisPoints(profitMinor, rule.reserveBp);
  const afterReserve = profitMinor - reserveMinor;

  const wantedFees = partners.map((p) =>
    sum(rule.fees.filter((f) => f.partnerId === p.partnerId).map((f) => BigInt(f.amountMinor))),
  );
  const wantedTotal = sum(wantedFees);
  const fees = wantedTotal <= afterReserve ? wantedFees : allocate(afterReserve, wantedFees);
  const feesMinor = sum(fees);
  const distributableMinor = afterReserve - feesMinor;
  const shares = allocate(distributableMinor, splitWeights(rule.method, partners));

  return {
    profitMinor,
    reserveMinor,
    feesMinor,
    distributableMinor,
    lines: partners.map((p, i) => {
      const feeMinor = fees[i] ?? 0n;
      const shareMinor = shares[i] ?? 0n;
      return { partnerId: p.partnerId, feeMinor, shareMinor, totalMinor: feeMinor + shareMinor };
    }),
  };
}

/** Adds results of several segments (e.g. before and after a partner joined). */
export function combineResults(results: readonly ProfitResult[]): ProfitResult {
  const lines = new Map<string, ProfitLine>();
  for (const r of results) {
    for (const l of r.lines) {
      const prev = lines.get(l.partnerId);
      lines.set(
        l.partnerId,
        prev
          ? {
              partnerId: l.partnerId,
              feeMinor: prev.feeMinor + l.feeMinor,
              shareMinor: prev.shareMinor + l.shareMinor,
              totalMinor: prev.totalMinor + l.totalMinor,
            }
          : { ...l },
      );
    }
  }
  return {
    profitMinor: sum(results.map((r) => r.profitMinor)),
    reserveMinor: sum(results.map((r) => r.reserveMinor)),
    feesMinor: sum(results.map((r) => r.feesMinor)),
    distributableMinor: sum(results.map((r) => r.distributableMinor)),
    lines: [...lines.values()],
  };
}

export type Holding = { partnerId: string; units: bigint };

/**
 * A new partner invests new money at an agreed pre-money valuation.
 * Existing units stay; the newcomer receives units so that
 * newUnits / (total + newUnits) = investment / (preMoney + investment).
 */
export function issueUnitsForInvestment(
  holdings: readonly Holding[],
  newPartnerId: string,
  preMoneyMinor: bigint,
  investmentMinor: bigint,
): Holding[] {
  if (preMoneyMinor <= 0n) throw new Error("Pre-money valuation must be positive");
  if (investmentMinor <= 0n) throw new Error("Investment must be positive");
  const total = sum(holdings.map((h) => h.units));
  const newUnits = (total * investmentMinor * 2n + preMoneyMinor) / (preMoneyMinor * 2n);
  const existing = holdings.find((h) => h.partnerId === newPartnerId);
  const others = holdings.filter((h) => h.partnerId !== newPartnerId).map((h) => ({ ...h }));
  return [...others, { partnerId: newPartnerId, units: (existing?.units ?? 0n) + newUnits }];
}

/** Moves units from one holder to another (a partner sells part of their stake). */
export function transferUnits(
  holdings: readonly Holding[],
  fromPartnerId: string,
  toPartnerId: string,
  units: bigint,
): Holding[] {
  const from = holdings.find((h) => h.partnerId === fromPartnerId);
  if (!from || from.units < units || units <= 0n) throw new Error("Not enough units to transfer");
  const result = holdings.map((h) =>
    h.partnerId === fromPartnerId ? { ...h, units: h.units - units } : { ...h },
  );
  const to = result.find((h) => h.partnerId === toPartnerId);
  if (to) to.units += units;
  else result.push({ partnerId: toPartnerId, units });
  return result.filter((h) => h.units > 0n);
}

/** Initial holdings from percentages (basis points), on a 1,000,000-unit base. */
export function holdingsFromPercentages(
  shares: readonly { partnerId: string; basisPoints: number }[],
): Holding[] {
  const total = shares.reduce((a, b) => a + b.basisPoints, 0);
  if (total !== 10000) throw new Error("Shares must add up to 100%");
  const units = allocate(
    1_000_000n,
    shares.map((s) => BigInt(s.basisPoints)),
  );
  return shares.map((s, i) => ({ partnerId: s.partnerId, units: units[i] ?? 0n }));
}

/**
 * Splits [start, end] (inclusive ISO dates) at the given boundary dates, each
 * boundary starting a new segment. Used when ownership or the rule changes mid-period.
 */
export function splitPeriod(start: string, end: string, boundaries: readonly string[]): [string, string][] {
  const cuts = [...new Set(boundaries)].filter((d) => d > start && d <= end).sort();
  const segments: [string, string][] = [];
  let from = start;
  for (const cut of cuts) {
    segments.push([from, previousDay(cut)]);
    from = cut;
  }
  segments.push([from, end]);
  return segments;
}

function previousDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
