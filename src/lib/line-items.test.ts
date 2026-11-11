import { describe, expect, it } from "vitest";
import { parseCustomFields, fieldKey } from "./custom-fields";
import { computeTotals, formatDocNumber, lineAmount } from "./line-items";

describe("line items", () => {
  it("multiplies decimal quantities with half-up rounding", () => {
    expect(lineAmount({ quantity: "1.5", unitPriceMinor: "10001" })).toBe(15002n);
    expect(lineAmount({ quantity: "3", unitPriceMinor: "-500" })).toBe(-1500n);
  });

  it("adds GST on top of exclusive prices", () => {
    const totals = computeTotals(
      [
        { description: "Website", quantity: "1", unitPriceMinor: "250000", taxRateBp: 1000 },
        { description: "Hosting", quantity: "12", unitPriceMinor: "2500", taxRateBp: 1000 },
      ],
      false,
    );
    expect(totals).toMatchObject({ subtotalMinor: 280000n, taxMinor: 28000n, totalMinor: 308000n });
  });

  it("extracts GST from inclusive prices", () => {
    const totals = computeTotals(
      [{ description: "Logo", quantity: "1", unitPriceMinor: "110000", taxRateBp: 1000 }],
      true,
    );
    expect(totals).toMatchObject({ subtotalMinor: 100000n, taxMinor: 10000n, totalMinor: 110000n });
  });

  it("formats document numbers", () => {
    expect(formatDocNumber("INV-", 7)).toBe("INV-0007");
    expect(formatDocNumber("P", 12345)).toBe("P12345");
  });
});

describe("custom fields", () => {
  const defs = [
    { key: "budget", label: "Budget", type: "number" as const, options: [], required: true },
    {
      key: "industry",
      label: "Industry",
      type: "select" as const,
      options: ["Cafe", "Trades"],
      required: false,
    },
    { key: "newsletter", label: "Newsletter", type: "checkbox" as const, options: [], required: false },
  ];

  it("validates and converts values", () => {
    expect(
      parseCustomFields(defs, { cf_budget: "5000", cf_industry: "Cafe", cf_newsletter: "on", other: "x" }),
    ).toEqual({
      ok: true,
      values: { budget: 5000, industry: "Cafe", newsletter: true },
    });
    expect(parseCustomFields(defs, { cf_industry: "Bank" })).toEqual({
      ok: false,
      errors: { cf_budget: "required", cf_industry: "option" },
    });
  });

  it("makes keys from labels", () => {
    expect(fieldKey("Website budget ($)")).toBe("website_budget");
  });
});
