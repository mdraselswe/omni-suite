import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { aiConfig } from "@/config";
import { serverEnv } from "@/config/env";

/** True when a Claude API key is set. Without it, AI features stay hidden. */
export function aiConfigured(): boolean {
  return serverEnv().ANTHROPIC_API_KEY !== "";
}

/** The model declined (safety) or the answer was cut off; nothing usable came back. */
export class AiNoAnswerError extends Error {
  constructor(readonly reason: string) {
    super(`AI returned no usable answer (${reason})`);
    this.name = "AiNoAnswerError";
  }
}

export type Completion = { text: string; inputTokens: number; outputTokens: number };

let client: Anthropic | undefined;

function claude(): Anthropic {
  client ??= new Anthropic({
    apiKey: serverEnv().ANTHROPIC_API_KEY,
    timeout: aiConfig.timeoutMs,
    maxRetries: 1,
  });
  return client;
}

/**
 * One Claude request that must answer with JSON matching `schema`.
 * Prompts can hold business data, so they are never logged.
 */
export async function complete(request: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
}): Promise<Completion> {
  const response = await claude().beta.messages.create({
    model: aiConfig.model,
    max_tokens: aiConfig.maxTokens,
    // A declined request is retried on a suitable model in the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: aiConfig.effort,
      format: { type: "json_schema", schema: request.schema },
    },
    system: request.system,
    messages: [{ role: "user", content: request.prompt }],
  });
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
  };
}
