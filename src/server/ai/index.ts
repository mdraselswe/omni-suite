import "server-only";

/** AI providers behind one interface. Which one each feature uses: src/config/ai.ts. */
export {
  aiConfigured,
  complete,
  completeWith,
  resolveAiChoice,
  type AiChoice,
  type AiKeys,
  type Completer,
  type FeatureRequest,
} from "./registry";
export {
  AiNoAnswerError,
  AiProviderError,
  type AiMessage,
  type AiProvider,
  type AiRequest,
  type Completion,
} from "./types";
