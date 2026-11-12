import { z } from "zod";
import type { AiFeature } from "@/config";
import type { LineItem } from "@/lib/line-items";
import { parseMoney } from "@/lib/money";

/**
 * Prompts and answer parsing for the AI assistant. Pure functions (no network),
 * so they are unit-tested directly. Answers come back as JSON that matches the
 * schemas below (structured outputs), and are validated again here.
 */

export type Prompt = {
  /** Which feature asks; picks the provider and model (src/config/ai.ts). */
  feature: AiFeature;
  system: string;
  prompt: string;
  /** JSON schema the answer must follow. */
  schema: Record<string, unknown>;
  /** Earlier turns of a conversation, sent before `prompt` (oldest first). */
  history?: readonly ChatTurn[];
};

/** One message of a conversation (portal assistant). */
export type ChatTurn = { role: "user" | "assistant"; content: string };

const SHARED_RULES =
  "Write in plain, friendly English for a small business. Be concrete and brief. " +
  "Never invent facts about the client, prices you were not given, or legal guarantees.";

/* ─── Proposal draft ───────────────────────────────────────────── */

export type ProposalDraftInput = {
  businessName: string;
  clientName: string;
  currency: string;
  brief: string;
  taxName: string;
  pricesIncludeTax: boolean;
};

export type ProposalDraft = {
  title: string;
  intro: string;
  terms: string;
  items: LineItem[];
};

const PROPOSAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "intro", "terms", "items"],
  properties: {
    title: { type: "string", description: "Short proposal title, under 80 characters." },
    intro: {
      type: "string",
      description: "Two or three short paragraphs: the client's goal, what we will do, the outcome.",
    },
    terms: {
      type: "string",
      description: "Short payment and delivery terms as plain lines (deposit, timeline, revisions).",
    },
    items: {
      type: "array",
      description: "Two to eight priced line items. Empty if no price can be estimated.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unitPrice"],
        properties: {
          description: { type: "string" },
          quantity: { type: "number", description: "Positive number, up to 3 decimals." },
          unitPrice: { type: "number", description: "Price for one unit in major currency units." },
        },
      },
    },
  },
} as const;

export function proposalDraftPrompt(input: ProposalDraftInput): Prompt {
  const pricing = input.pricesIncludeTax
    ? `Prices include ${input.taxName}.`
    : `Prices exclude ${input.taxName}.`;
  return {
    feature: "proposalDraft",
    system:
      `You help ${input.businessName} write sales proposals. ${SHARED_RULES} ` +
      "Line item prices are estimates the business will review, so keep them realistic and round.",
    prompt: [
      `Client: ${input.clientName || "(not chosen yet)"}`,
      `Currency: ${input.currency}. ${pricing}`,
      "What the client needs, in the business's own words:",
      "<brief>",
      input.brief,
      "</brief>",
      "Draft the proposal title, introduction, terms and line items.",
    ].join("\n"),
    schema: PROPOSAL_SCHEMA,
  };
}

const draftAnswer = z.object({
  title: z.string(),
  intro: z.string(),
  terms: z.string(),
  items: z.array(z.object({ description: z.string(), quantity: z.number(), unitPrice: z.number() })).max(20),
});

/** Validates the answer and turns prices into line items. Null when the answer is unusable. */
export function parseProposalDraft(text: string, currency: string, taxRateBp: number): ProposalDraft | null {
  const parsed = draftAnswer.safeParse(safeJson(text));
  if (!parsed.success) return null;
  const items: LineItem[] = [];
  for (const item of parsed.data.items) {
    const description = item.description.trim().slice(0, 500);
    const quantity = Math.round(item.quantity * 1000) / 1000;
    const price = parseMoney(item.unitPrice.toFixed(6), currency);
    if (!description || !(quantity > 0) || price === null || price < 0n) continue;
    items.push({ description, quantity: String(quantity), unitPriceMinor: String(price), taxRateBp });
  }
  return {
    title: parsed.data.title.trim().slice(0, 200),
    intro: parsed.data.intro.trim().slice(0, 10000),
    terms: parsed.data.terms.trim().slice(0, 10000),
    items,
  };
}

/* ─── Business insights ────────────────────────────────────────── */

/** Aggregated numbers only (no names or personal data), already formatted for people. */
export type BusinessSnapshot = {
  businessName: string;
  today: string;
  facts: readonly { label: string; value: string }[];
};

export type Insight = { title: string; detail: string };

const INSIGHTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["insights"],
  properties: {
    insights: {
      type: "array",
      description: "Three to five recommendations, most important first.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail"],
        properties: {
          title: { type: "string", description: "A short action, under 60 characters." },
          detail: { type: "string", description: "One or two sentences that cite the numbers." },
        },
      },
    },
  },
} as const;

export function insightsPrompt(snapshot: BusinessSnapshot): Prompt {
  return {
    feature: "insights",
    system:
      "You are a practical small-business advisor reading a dashboard. " +
      `${SHARED_RULES} Base every point on the numbers given; if data is missing, say what to track.`,
    prompt: [
      `Business: ${snapshot.businessName}. Today: ${snapshot.today}.`,
      "Dashboard numbers:",
      ...snapshot.facts.map((f) => `- ${f.label}: ${f.value}`),
      "Give 3 to 5 short, practical recommendations for the next 30 days.",
    ].join("\n"),
    schema: INSIGHTS_SCHEMA,
  };
}

const insightsAnswer = z.object({
  insights: z.array(z.object({ title: z.string(), detail: z.string() })),
});

export function parseInsights(text: string): Insight[] | null {
  const parsed = insightsAnswer.safeParse(safeJson(text));
  if (!parsed.success) return null;
  const list = parsed.data.insights
    .map((i) => ({ title: i.title.trim().slice(0, 120), detail: i.detail.trim().slice(0, 600) }))
    .filter((i) => i.title !== "")
    .slice(0, 5);
  return list.length > 0 ? list : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
