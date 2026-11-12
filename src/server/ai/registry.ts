import "server-only";
import {
  AI_FEATURES,
  AI_PROVIDERS,
  aiConfig,
  type AiConfig,
  type AiFeature,
  type AiProviderId,
  type ChatProviderId,
} from "@/config";
import { serverEnv, type ServerEnv } from "@/config/env";
import { anthropicProvider } from "./anthropic";
import { openAiCompatibleProvider } from "./openai-compatible";
import { AiProviderError, type AiProvider, type AiRequest, type Completion } from "./types";

/**
 * Picks the provider and model for each AI feature from src/config/ai.ts and
 * hands requests to it, trying `fallbackProviders` when it fails. Adding an
 * OpenAI-style provider: its id in AI_PROVIDERS and its settings (schema.ts, ai.ts),
 * its key in env.ts and below (docs/configuration.md → AI providers).
 */

/** The env variable holding each provider's API key. */
export const API_KEYS = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  xai: "XAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "openai-compatible": "OPENAI_COMPATIBLE_API_KEY",
} as const satisfies Record<AiProviderId, keyof ServerEnv>;

export type AiKeys = Partial<Pick<ServerEnv, (typeof API_KEYS)[AiProviderId]>>;

const hasKey = (id: AiProviderId, keys: AiKeys) => (keys[API_KEYS[id]] ?? "") !== "";

function makeProvider(id: AiProviderId, apiKey: string, config: AiConfig): AiProvider {
  if (id === "anthropic") {
    return anthropicProvider({ apiKey, settings: config.providers.anthropic, timeoutMs: config.timeoutMs });
  }
  return openAiCompatibleProvider({
    id,
    apiKey,
    settings: config.providers[id],
    timeoutMs: config.timeoutMs,
  });
}

export type AiChoice = { provider: AiProviderId; model: string };

/** Provider and model for a feature: its override if any, else the default provider and its model. */
export function resolveAiChoice(feature: AiFeature, config: AiConfig = aiConfig): AiChoice {
  const override = config.features[feature];
  const provider = override?.provider ?? config.defaultProvider;
  return { provider, model: override?.model ?? config.providers[provider].model };
}

/**
 * What a feature tries, in order: its own choice, then each fallback provider with a key
 * (with that provider's own model), never the same provider twice.
 */
export function aiChain(
  feature: AiFeature,
  config: AiConfig = aiConfig,
  keys: AiKeys = serverEnv(),
): AiChoice[] {
  const first = resolveAiChoice(feature, config);
  const chain: AiChoice[] = hasKey(first.provider, keys) ? [first] : [];
  for (const id of config.fallbackProviders) {
    if (id !== first.provider && hasKey(id, keys) && !chain.some((c) => c.provider === id)) {
      chain.push({ provider: id, model: config.providers[id].model });
    }
  }
  return chain;
}

/**
 * True when a feature has a provider it can use (its own or a fallback with a key).
 * Without a feature: true when any feature can run. Features with none stay hidden.
 */
export function aiConfigured(
  feature?: AiFeature,
  config: AiConfig = aiConfig,
  keys: AiKeys = serverEnv(),
): boolean {
  const ready = (f: AiFeature) => aiChain(f, config, keys).length > 0;
  return feature ? ready(feature) : AI_FEATURES.some(ready);
}

const instances = new Map<AiProviderId, AiProvider>();

function aiProvider(id: AiProviderId): AiProvider {
  let provider = instances.get(id);
  if (!provider) {
    provider = makeProvider(id, serverEnv()[API_KEYS[id]], aiConfig);
    instances.set(id, provider);
  }
  return provider;
}

/** What a feature sends; the registry adds the model and (unless given) the length cap. */
export type FeatureRequest = Omit<AiRequest, "model" | "maxTokens"> & { maxTokens?: number };

/** One AI call for a feature. Tests and runAi accept any function of this shape. */
export type Completer = (feature: AiFeature, request: FeatureRequest) => Promise<Completion>;

/**
 * Failures worth trying another provider for: rate limits and running out of credit
 * (429, 402), bad or missing keys (401, 403), the service being down (5xx), timeouts
 * and network errors. A refusal or a cut-off answer is not retried elsewhere.
 */
function worthFallback(error: unknown): boolean {
  if (!(error instanceof AiProviderError)) return false;
  const s = error.status;
  return s === null || s === 401 || s === 402 || s === 403 || s === 408 || s === 429 || s >= 500;
}

/** Routes a feature's request along its chain (providers and keys injectable for tests). */
export async function completeWith(
  feature: AiFeature,
  request: FeatureRequest,
  config: AiConfig,
  provider: (id: AiProviderId) => AiProvider,
  keys: AiKeys = serverEnv(),
): Promise<Completion> {
  const chain = aiChain(feature, config, keys);
  // No key anywhere: the chosen provider answers (and fails) as before.
  const steps = chain.length > 0 ? chain : [resolveAiChoice(feature, config)];
  let lastError: unknown;
  for (const [i, choice] of steps.entries()) {
    try {
      return await provider(choice.provider).complete({
        ...request,
        model: choice.model,
        maxTokens: request.maxTokens ?? config.maxTokens,
      });
    } catch (error) {
      lastError = error;
      if (i === steps.length - 1 || !worthFallback(error)) throw error;
      // The provider and status only: the prompt holds business data.
      console.warn(
        `[ai] ${choice.provider} failed (${String((error as AiProviderError).status)}), trying the next`,
      );
    }
  }
  throw lastError;
}

/**
 * One AI request for `feature`, sent to the provider and model the config picks.
 * Prompts can hold business data, so they are never logged.
 */
export const complete: Completer = (feature, request) => completeWith(feature, request, aiConfig, aiProvider);

export type ProviderStatus = {
  id: AiProviderId;
  label: string;
  model: string;
  hasKey: boolean;
  keyName: string;
  keyUrl: string | null;
  free: "no" | "yes" | "yes-trains";
  isDefault: boolean;
  fallbackOrder: number | null;
  /** Features that use it as their own choice. */
  features: AiFeature[];
};

/** Every provider with its key state and how the config uses it (no secrets). */
export function providerStatuses(config: AiConfig = aiConfig, keys: AiKeys = serverEnv()): ProviderStatus[] {
  return AI_PROVIDERS.map((id) => {
    const settings = config.providers[id];
    const chat = id === "anthropic" ? null : config.providers[id as ChatProviderId];
    const order = config.fallbackProviders.indexOf(id);
    return {
      id,
      label: chat?.label ?? "Anthropic (Claude)",
      model: settings.model,
      hasKey: hasKey(id, keys),
      keyName: API_KEYS[id],
      keyUrl: chat ? (chat.keyUrl ?? null) : "https://platform.claude.com/settings/keys",
      free: chat?.free ?? "no",
      isDefault: config.defaultProvider === id,
      fallbackOrder: order < 0 ? null : order + 1,
      features: AI_FEATURES.filter((f) => resolveAiChoice(f, config).provider === id),
    };
  });
}

export type ProviderCheck =
  | { id: AiProviderId; ok: true; models: string[]; modelFound: boolean }
  | { id: AiProviderId; ok: false; status: number | null };

/** Checks a provider's key by listing its models (no tokens spent). */
export async function checkProvider(id: AiProviderId, config: AiConfig = aiConfig): Promise<ProviderCheck> {
  const p = aiProvider(id);
  if (!p.listModels) return { id, ok: false, status: null };
  try {
    const models = await p.listModels();
    return { id, ok: true, models, modelFound: models.includes(config.providers[id].model) };
  } catch (error) {
    return { id, ok: false, status: error instanceof AiProviderError ? error.status : null };
  }
}
