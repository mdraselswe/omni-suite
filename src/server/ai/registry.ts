import "server-only";
import { AI_FEATURES, aiConfig, type AiConfig, type AiFeature, type AiProviderId } from "@/config";
import { serverEnv, type ServerEnv } from "@/config/env";
import { anthropicProvider } from "./anthropic";
import { openAiCompatibleProvider } from "./openai-compatible";
import type { AiProvider, AiRequest, Completion } from "./types";

/**
 * Picks the provider and model for each AI feature from src/config/ai.ts and
 * hands requests to it. Adding a provider: a factory below, its settings in the
 * config schema, and its key in env.ts (docs/configuration.md → AI providers).
 */

/** The env variable holding each provider's API key. */
const API_KEYS = {
  anthropic: "ANTHROPIC_API_KEY",
  "openai-compatible": "OPENAI_COMPATIBLE_API_KEY",
} as const satisfies Record<AiProviderId, keyof ServerEnv>;

export type AiKeys = Pick<ServerEnv, (typeof API_KEYS)[AiProviderId]>;

const factories: Record<AiProviderId, (apiKey: string, config: AiConfig) => AiProvider> = {
  anthropic: (apiKey, config) =>
    anthropicProvider({ apiKey, settings: config.providers.anthropic, timeoutMs: config.timeoutMs }),
  "openai-compatible": (apiKey, config) =>
    openAiCompatibleProvider({
      apiKey,
      settings: config.providers["openai-compatible"],
      timeoutMs: config.timeoutMs,
    }),
};

export type AiChoice = { provider: AiProviderId; model: string };

/** Provider and model for a feature: its override if any, else the default provider and its model. */
export function resolveAiChoice(feature: AiFeature, config: AiConfig = aiConfig): AiChoice {
  const override = config.features[feature];
  const provider = override?.provider ?? config.defaultProvider;
  return { provider, model: override?.model ?? config.providers[provider].model };
}

/**
 * True when the provider a feature uses has its API key. Without a feature: true
 * when any feature can run. Features whose provider has no key stay hidden.
 */
export function aiConfigured(
  feature?: AiFeature,
  config: AiConfig = aiConfig,
  keys: AiKeys = serverEnv(),
): boolean {
  const ready = (f: AiFeature) => keys[API_KEYS[resolveAiChoice(f, config).provider]] !== "";
  return feature ? ready(feature) : AI_FEATURES.some(ready);
}

const instances = new Map<AiProviderId, AiProvider>();

function aiProvider(id: AiProviderId): AiProvider {
  let provider = instances.get(id);
  if (!provider) {
    provider = factories[id](serverEnv()[API_KEYS[id]], aiConfig);
    instances.set(id, provider);
  }
  return provider;
}

/** What a feature sends; the registry adds the model and (unless given) the length cap. */
export type FeatureRequest = Omit<AiRequest, "model" | "maxTokens"> & { maxTokens?: number };

/** One AI call for a feature. Tests and runAi accept any function of this shape. */
export type Completer = (feature: AiFeature, request: FeatureRequest) => Promise<Completion>;

/** Routes a feature's request to its provider and model (providers injectable for tests). */
export function completeWith(
  feature: AiFeature,
  request: FeatureRequest,
  config: AiConfig,
  provider: (id: AiProviderId) => AiProvider,
): Promise<Completion> {
  const choice = resolveAiChoice(feature, config);
  return provider(choice.provider).complete({
    ...request,
    model: choice.model,
    maxTokens: request.maxTokens ?? config.maxTokens,
  });
}

/**
 * One AI request for `feature`, sent to the provider and model the config picks.
 * Prompts can hold business data, so they are never logged.
 */
export const complete: Completer = (feature, request) => completeWith(feature, request, aiConfig, aiProvider);
