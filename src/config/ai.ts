import { aiSchema, type AiConfig } from "./schema.ts";

/**
 * ✏️ AI assistant settings. API keys live in env (src/config/env.ts): a provider is off
 * until its key is set, and a feature is hidden until a provider it can use is on.
 * Check keys and see each provider's models: `pnpm ai:check` (docs/configuration.md → AI providers).
 *
 * Model ids change often. When a provider renames one, `pnpm ai:check` lists what the
 * key can use; put the new id here.
 */
const ai: AiConfig = {
  defaultProvider: "anthropic",
  providers: {
    anthropic: {
      /** Claude model id (see the Claude API docs for current models). */
      model: "claude-opus-5-5",
      effort: "medium",
    },
    openai: {
      label: "OpenAI (ChatGPT)",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-6.1-terra",
      jsonMode: "json_schema",
      tokenLimitParam: "max_completion_tokens",
      keyUrl: "https://platform.openai.com/api-keys",
      free: "no",
    },
    gemini: {
      label: "Google Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      /** The newest flash model is often "high demand" (503) on the free tier; 3.6 answers more often. */
      model: "gemini-3.6-flash",
      jsonMode: "json_schema",
      tokenLimitParam: "max_tokens",
      keyUrl: "https://aistudio.google.com/apikey",
      free: "yes-trains",
    },
    deepseek: {
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
      jsonMode: "json_object",
      tokenLimitParam: "max_tokens",
      keyUrl: "https://platform.deepseek.com/api_keys",
      free: "no",
    },
    xai: {
      label: "xAI (Grok)",
      baseUrl: "https://api.x.ai/v1",
      model: "grok-4.3",
      jsonMode: "json_object",
      tokenLimitParam: "max_tokens",
      keyUrl: "https://console.x.ai",
      free: "no",
    },
    mistral: {
      label: "Mistral",
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-small-latest",
      jsonMode: "json_object",
      tokenLimitParam: "max_tokens",
      keyUrl: "https://console.mistral.ai/api-keys",
      free: "yes-trains",
    },
    groq: {
      label: "Groq (open models, fast)",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "openai/gpt-oss-120b",
      jsonMode: "json_object",
      tokenLimitParam: "max_completion_tokens",
      keyUrl: "https://console.groq.com/keys",
      free: "yes",
    },
    openrouter: {
      label: "OpenRouter (many models, one key)",
      baseUrl: "https://openrouter.ai/api/v1",
      /** Picks a free model for each request; any OpenRouter model id works here. */
      model: "openrouter/free",
      jsonMode: "none",
      tokenLimitParam: "max_tokens",
      keyUrl: "https://openrouter.ai/settings/keys",
      free: "yes-trains",
    },
    /** Spare slot for any other OpenAI-style service, e.g. a local Ollama (any key value). */
    "openai-compatible": {
      label: "Other (OpenAI-compatible)",
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2",
      jsonMode: "json_object",
      tokenLimitParam: "max_tokens",
      free: "yes",
    },
  },
  /**
   * Per-feature overrides, e.g.
   *   insights: { model: "claude-haiku-5-5" },
   *   proposalDraft: { provider: "gemini" },
   */
  features: {},
  /** e.g. ["openai", "gemini"]: used in order when the chosen provider fails. */
  fallbackProviders: [],
  maxTokens: 16000,
  timeoutMs: 90_000,
  dailyRequestsPerBusiness: 50,
  dailyRequestsPerMember: 20,
  briefMaxLength: 2000,
};

export const aiConfig = aiSchema.parse(ai);
