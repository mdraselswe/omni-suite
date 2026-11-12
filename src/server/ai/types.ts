import type { AiProviderId } from "@/config";

/**
 * The shape every AI provider speaks. Features build an `AiRequest`, the registry
 * picks the provider and model, and the provider maps it to its own API.
 */

export type AiMessage = { role: "user" | "assistant"; content: string };

export type AiRequest = {
  /** Model id at the chosen provider. */
  model: string;
  system: string;
  messages: AiMessage[];
  /** Hard cap on the answer's length (tokens). */
  maxTokens: number;
  /** Sampling temperature, for providers that accept one (current Claude models don't). */
  temperature?: number;
  /** Ask for a JSON answer that matches this JSON schema. */
  json?: { name: string; schema: Record<string, unknown> };
};

export type Completion = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Model that actually answered (may differ from the request after a fallback). */
  model: string;
};

export type AiProvider = {
  id: AiProviderId;
  complete(request: AiRequest): Promise<Completion>;
};

/** The model declined (safety) or the answer was cut off; nothing usable came back. */
export class AiNoAnswerError extends Error {
  constructor(readonly reason: string) {
    super(`AI returned no usable answer (${reason})`);
    this.name = "AiNoAnswerError";
  }
}

/**
 * The provider answered with an HTTP error or a shape we don't understand.
 * The message holds the status only, never the request or response body.
 */
export class AiProviderError extends Error {
  constructor(
    readonly provider: AiProviderId,
    readonly status: number | null,
  ) {
    super(`AI provider ${provider} failed${status === null ? "" : ` (HTTP ${status})`}`);
    this.name = "AiProviderError";
  }
}
