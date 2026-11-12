import { aiSchema, type AiConfig } from "./schema.ts";

/**
 * ✏️ AI assistant settings. API keys live in env (src/config/env.ts): a feature is
 * hidden until the provider it uses has its key. See docs/configuration.md → AI providers.
 */
const ai: AiConfig = {
  defaultProvider: "anthropic",
  providers: {
    anthropic: {
      /** Claude model id (see the Claude API docs for current models). */
      model: "claude-opus-5-5",
      effort: "medium",
    },
    /** Off until OPENAI_COMPATIBLE_API_KEY is set and a feature (or the default) picks it. */
    "openai-compatible": {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5-mini",
      jsonMode: "json_schema",
      tokenLimitParam: "max_completion_tokens",
    },
  },
  /**
   * Per-feature overrides, e.g.
   *   insights: { model: "claude-haiku-5-5" },
   *   proposalDraft: { provider: "openai-compatible", model: "gpt-5-mini" },
   */
  features: {},
  maxTokens: 16000,
  timeoutMs: 90_000,
  dailyRequestsPerBusiness: 50,
  dailyRequestsPerMember: 20,
  briefMaxLength: 2000,
};

export const aiConfig = aiSchema.parse(ai);
