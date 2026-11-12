import "server-only";

/** AI providers behind one interface. Which one each feature uses: src/config/ai.ts. */
export {
  aiChain,
  aiConfigured,
  API_KEYS,
  checkProvider,
  complete,
  completeWith,
  providerStatuses,
  resolveAiChoice,
  type AiChoice,
  type AiKeys,
  type Completer,
  type FeatureRequest,
  type ProviderCheck,
  type ProviderStatus,
} from "./registry";
export {
  AiNoAnswerError,
  AiProviderError,
  type AiMessage,
  type AiProvider,
  type AiRequest,
  type Completion,
} from "./types";
