import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AiConfig } from "@/config";
import { AiNoAnswerError, type AiProvider, type AiRequest, type Completion } from "./types";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

/** The parts of a Claude answer this provider reads. */
export type ClaudeAnswer = Pick<Message, "content" | "stop_reason" | "model"> & {
  usage: Pick<Message["usage"], "input_tokens" | "output_tokens">;
};

/** Sends one Messages API request. Tests pass a fake instead of the SDK. */
export type ClaudeCreate = (params: Params) => Promise<ClaudeAnswer>;

type Settings = AiConfig["providers"]["anthropic"];

/** Builds the Messages API request (pure, so it is unit-tested). */
export function claudeParams(request: AiRequest, settings: Pick<Settings, "effort">): Params {
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    // A declined request is retried on a suitable model in the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // Current Claude models reject sampling settings, so `temperature` is not sent;
    // `effort` controls depth instead.
    output_config: {
      effort: settings.effort,
      ...(request.json ? { format: { type: "json_schema", schema: request.json.schema } } : {}),
    },
    system: request.system,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
  };
}

/** Turns a Claude answer into a Completion, or throws when nothing usable came back. */
export function claudeCompletion(response: ClaudeAnswer): Completion {
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
    throw new AiNoAnswerError(response.stop_reason);
  }
  const text = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
  if (!text) throw new AiNoAnswerError("empty");
  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: response.model,
  };
}

/** Claude through the official SDK. */
export function anthropicProvider(options: {
  apiKey: string;
  settings: Settings;
  timeoutMs: number;
  create?: ClaudeCreate;
}): AiProvider {
  let create = options.create;
  const send: ClaudeCreate = (params) => {
    if (!create) {
      const client = new Anthropic({
        apiKey: options.apiKey,
        baseURL: options.settings.baseUrl,
        timeout: options.timeoutMs,
        maxRetries: 1,
      });
      create = (p) => client.beta.messages.create(p);
    }
    return create(params);
  };
  return {
    id: "anthropic",
    complete: async (request) => claudeCompletion(await send(claudeParams(request, options.settings))),
  };
}
