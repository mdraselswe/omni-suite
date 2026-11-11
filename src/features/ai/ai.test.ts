// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";
import {
  insightsPrompt,
  parseInsights,
  parseProposalDraft,
  proposalDraftPrompt,
  type Prompt,
} from "./prompts";

describe("prompts", () => {
  it("puts the brief, client and pricing basis into the proposal prompt", () => {
    const p = proposalDraftPrompt({
      businessName: "OmniScope",
      clientName: "Koala Dental",
      currency: "AUD",
      brief: "New website with booking",
      taxName: "GST",
      pricesIncludeTax: true,
    });
    expect(p.prompt).toContain("Koala Dental");
    expect(p.prompt).toContain("<brief>\nNew website with booking\n</brief>");
    expect(p.prompt).toContain("Prices include GST.");
    expect(p.system).toContain("OmniScope");
    expect(p.schema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("lists only the snapshot facts in the insights prompt", () => {
    const p = insightsPrompt({
      businessName: "OmniScope",
      today: "2026-11-11",
      facts: [{ label: "Cash in accounts", value: "$1,000.00" }],
    });
    expect(p.prompt).toContain("- Cash in accounts: $1,000.00");
  });
});

describe("parsing answers", () => {
  it("turns a draft into line items in minor units with the default tax", () => {
    const draft = parseProposalDraft(
      JSON.stringify({
        title: " Website ",
        intro: "Intro",
        terms: "50% deposit",
        items: [
          { description: "Design", quantity: 1, unitPrice: 1200.5 },
          { description: "Hours", quantity: 2.5, unitPrice: 95 },
          { description: "", quantity: 1, unitPrice: 10 },
          { description: "Bad qty", quantity: 0, unitPrice: 10 },
        ],
      }),
      "AUD",
      1000,
    );
    expect(draft).toEqual({
      title: "Website",
      intro: "Intro",
      terms: "50% deposit",
      items: [
        { description: "Design", quantity: "1", unitPriceMinor: "120050", taxRateBp: 1000 },
        { description: "Hours", quantity: "2.5", unitPriceMinor: "9500", taxRateBp: 1000 },
      ],
    });
  });

  it("uses whole units for zero-decimal currencies", () => {
    const draft = parseProposalDraft(
      JSON.stringify({
        title: "T",
        intro: "",
        terms: "",
        items: [{ description: "A", quantity: 1, unitPrice: 5000 }],
      }),
      "JPY",
      0,
    );
    expect(draft?.items[0]?.unitPriceMinor).toBe("5000");
  });

  it("rejects answers that aren't the expected JSON", () => {
    expect(parseProposalDraft("not json", "AUD", 0)).toBeNull();
    expect(parseProposalDraft(JSON.stringify({ title: "x" }), "AUD", 0)).toBeNull();
    expect(parseInsights(JSON.stringify({ insights: [] }))).toBeNull();
  });

  it("keeps at most five insights", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ title: `T${i}`, detail: "d" }));
    expect(parseInsights(JSON.stringify({ insights: many }))).toHaveLength(5);
  });
});

describe("daily limit", () => {
  let database: Database;
  let ctx: TenantContext;

  beforeAll(async () => {
    const { createTestDb, setupTenant } = await import("@/server/testing/db");
    database = await createTestDb();
    ({ ctx } = await setupTenant(database, "aitest"));
  });

  it("counts requests per business and day and stops at the limit", async () => {
    const { aiUsageOn, reserveAiRequest } = await import("./usage");
    const id = ctx.tenant.id;
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => reserveAiRequest(database, id, "2026-01-01", 3)),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await aiUsageOn(database, id, "2026-01-01")).requests).toBe(3);
    expect(await reserveAiRequest(database, id, "2026-01-02", 3)).toBe(true);
    expect(await reserveAiRequest(database, id, "2026-01-03", 0)).toBe(false);
  });

  it("records tokens on success and gives the request back on failure", async () => {
    const { runAi } = await import("./run");
    const { aiUsageOn } = await import("./usage");
    const { today } = await import("@/lib/dates");
    const day = today(ctx.tenant.settings.timezone);
    const request: Prompt = { system: "s", prompt: "p", schema: {} };

    const ok = vi.fn(async () => ({ text: '{"a":1}', inputTokens: 10, outputTokens: 5 }));
    await expect(runAi(database, ctx, request, (text) => JSON.parse(text) as unknown, ok)).resolves.toEqual({
      a: 1,
    });
    expect(await aiUsageOn(database, ctx.tenant.id, day)).toMatchObject({
      requests: 1,
      inputTokens: 10,
      outputTokens: 5,
    });

    const failing = vi.fn(async () => {
      throw new Error("network down");
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(runAi(database, ctx, request, () => null, failing)).rejects.toThrow(/couldn't answer/);
    quiet.mockRestore();
    expect((await aiUsageOn(database, ctx.tenant.id, day)).requests).toBe(1);

    // A usable call whose answer can't be parsed still counts (the tokens were spent).
    await expect(runAi(database, ctx, request, () => null, ok)).rejects.toThrow(/usable answer/);
    expect((await aiUsageOn(database, ctx.tenant.id, day)).requests).toBe(2);
  });
});
