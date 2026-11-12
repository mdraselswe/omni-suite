// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { aiConfig, type AiConfig } from "@/config";
import { aiSchema } from "@/config/schema";
import { anthropicProvider, type ClaudeAnswer, type ClaudeCreate } from "./anthropic";
import { openAiCompatibleProvider } from "./openai-compatible";
import { aiConfigured, completeWith, resolveAiChoice } from "./registry";
import { AiNoAnswerError, AiProviderError, type AiProvider, type AiRequest } from "./types";

const request: AiRequest = {
  model: "some-model",
  system: "You are helpful.",
  messages: [{ role: "user", content: "Hi" }],
  maxTokens: 500,
  json: { name: "insights", schema: { type: "object" } },
};

const withOverrides: AiConfig = {
  ...aiConfig,
  defaultProvider: "anthropic",
  features: {
    insights: { model: "claude-haiku-5-5" },
    proposalDraft: { provider: "openai-compatible" },
  },
};

describe("provider registry", () => {
  it("uses the default provider and its model when a feature has no override", () => {
    const config: AiConfig = { ...aiConfig, defaultProvider: "anthropic", features: {} };
    expect(resolveAiChoice("insights", config)).toEqual({
      provider: "anthropic",
      model: config.providers.anthropic.model,
    });
  });

  it("applies a per-feature model or provider override", () => {
    expect(resolveAiChoice("insights", withOverrides)).toEqual({
      provider: "anthropic",
      model: "claude-haiku-5-5",
    });
    expect(resolveAiChoice("proposalDraft", withOverrides)).toEqual({
      provider: "openai-compatible",
      model: withOverrides.providers["openai-compatible"].model,
    });
  });

  it("treats a feature as configured only when its provider has a key", () => {
    const keys = { ANTHROPIC_API_KEY: "sk-test", OPENAI_COMPATIBLE_API_KEY: "" };
    expect(aiConfigured("insights", withOverrides, keys)).toBe(true);
    expect(aiConfigured("proposalDraft", withOverrides, keys)).toBe(false);
    expect(aiConfigured(undefined, withOverrides, keys)).toBe(true);
    const none = { ANTHROPIC_API_KEY: "", OPENAI_COMPATIBLE_API_KEY: "" };
    expect(aiConfigured(undefined, withOverrides, none)).toBe(false);
  });

  it("sends the chosen model and the default length cap to the chosen provider", async () => {
    const seen: { id: string; request: AiRequest }[] = [];
    const fake = (id: AiProvider["id"]): AiProvider => ({
      id,
      complete: async (r) => {
        seen.push({ id, request: r });
        return { text: "ok", inputTokens: 1, outputTokens: 1, model: r.model };
      },
    });
    await completeWith("insights", { system: "s", messages: [] }, withOverrides, fake);
    await completeWith("proposalDraft", { system: "s", messages: [], maxTokens: 7 }, withOverrides, fake);
    expect(seen).toEqual([
      {
        id: "anthropic",
        request: { system: "s", messages: [], model: "claude-haiku-5-5", maxTokens: aiConfig.maxTokens },
      },
      {
        id: "openai-compatible",
        request: {
          system: "s",
          messages: [],
          model: withOverrides.providers["openai-compatible"].model,
          maxTokens: 7,
        },
      },
    ]);
  });

  it("rejects unknown providers and features in the config", () => {
    expect(aiSchema.safeParse({ ...aiConfig, defaultProvider: "nope" }).success).toBe(false);
    expect(aiSchema.safeParse({ ...aiConfig, features: { unknown: { model: "x" } } }).success).toBe(false);
    expect(aiSchema.safeParse({ ...aiConfig, features: { insights: { model: "" } } }).success).toBe(false);
    expect(aiSchema.safeParse(withOverrides).success).toBe(true);
  });
});

describe("openai-compatible provider", () => {
  const settings: AiConfig["providers"]["openai-compatible"] = {
    baseUrl: "https://api.example.com/v1/",
    model: "m",
    jsonMode: "json_schema",
    tokenLimitParam: "max_completion_tokens",
  };

  function setup(body: unknown, status = 200, overrides: Partial<typeof settings> = {}, apiKey = "key-1") {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );
    const provider = openAiCompatibleProvider({
      apiKey,
      settings: { ...settings, ...overrides },
      timeoutMs: 1000,
      fetch: fetchMock,
    });
    const sent = () => {
      const [url, init] = fetchMock.mock.calls[0] ?? [];
      return {
        url,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      };
    };
    return { provider, sent };
  }

  const answer = {
    model: "m-2026",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: '{"a":1}' } }],
    usage: { prompt_tokens: 12, completion_tokens: 3 },
  };

  it("posts a Chat Completions request with a strict JSON schema", async () => {
    const { provider, sent } = setup(answer);
    await expect(provider.complete({ ...request, temperature: 0.2 })).resolves.toEqual({
      text: '{"a":1}',
      inputTokens: 12,
      outputTokens: 3,
      model: "m-2026",
    });
    const { url, headers, body } = sent();
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(headers.get("authorization")).toBe("Bearer key-1");
    expect(body).toEqual({
      model: "some-model",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
      max_completion_tokens: 500,
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: { name: "insights", schema: { type: "object" }, strict: true },
      },
    });
  });

  it("puts the schema into the instructions for json_object and none modes", async () => {
    const objectMode = setup(answer, 200, { jsonMode: "json_object", tokenLimitParam: "max_tokens" });
    await objectMode.provider.complete(request);
    const sentObject = objectMode.sent().body;
    expect(sentObject.response_format).toEqual({ type: "json_object" });
    expect(sentObject.max_tokens).toBe(500);
    expect(JSON.stringify(sentObject.messages)).toContain("matching this JSON schema");

    const plain = setup(
      { choices: [{ finish_reason: "stop", message: { content: '```json\n{"a":1}\n```' } }] },
      200,
      { jsonMode: "none" },
      "",
    );
    await expect(plain.provider.complete(request)).resolves.toEqual({
      text: '{"a":1}',
      inputTokens: 0,
      outputTokens: 0,
      model: "some-model",
    });
    expect(plain.sent().body).not.toHaveProperty("response_format");
    expect(plain.sent().headers.has("authorization")).toBe(false);
  });

  it("maps cut-off, refused and failed answers to errors without the body", async () => {
    const cut = setup({ choices: [{ finish_reason: "length", message: { content: '{"a"' } }] });
    await expect(cut.provider.complete(request)).rejects.toThrow(AiNoAnswerError);
    const refused = setup({
      choices: [{ finish_reason: "stop", message: { content: null, refusal: "no" } }],
    });
    await expect(refused.provider.complete(request)).rejects.toMatchObject({ reason: "refusal" });
    const failed = setup({ error: { message: "secret prompt echoed" } }, 500);
    const error: unknown = await failed.provider.complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect(String(error)).toContain("HTTP 500");
    expect(String(error)).not.toContain("secret");
    const odd = setup({ unexpected: true });
    await expect(odd.provider.complete(request)).rejects.toThrow(AiProviderError);
  });
});

describe("anthropic provider", () => {
  const settings = { model: "claude-opus-5-5", effort: "medium" } as const;
  const reply = (over: Partial<ClaudeAnswer> = {}): ClaudeAnswer => ({
    content: [{ type: "text", text: ' {"a":1} ', citations: null }],
    stop_reason: "end_turn",
    model: "claude-opus-5-5",
    usage: { input_tokens: 20, output_tokens: 4 },
    ...over,
  });

  it("sends a Messages API request with structured output and fallbacks", async () => {
    const create = vi.fn<ClaudeCreate>(async () => reply());
    const provider = anthropicProvider({ apiKey: "k", settings, timeoutMs: 1000, create });
    await expect(provider.complete({ ...request, temperature: 0.5 })).resolves.toEqual({
      text: '{"a":1}',
      inputTokens: 20,
      outputTokens: 4,
      model: "claude-opus-5-5",
    });
    expect(create).toHaveBeenCalledWith({
      model: "some-model",
      max_tokens: 500,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: { type: "object" } } },
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hi" }],
    });
  });

  it("throws AiNoAnswerError on a refusal, a cut-off or an empty answer", async () => {
    for (const answer of [
      reply({ stop_reason: "refusal" }),
      reply({ stop_reason: "max_tokens" }),
      reply({ content: [] }),
    ]) {
      const provider = anthropicProvider({
        apiKey: "k",
        settings,
        timeoutMs: 1000,
        create: async () => answer,
      });
      await expect(provider.complete(request)).rejects.toThrow(AiNoAnswerError);
    }
  });
});
