import "server-only";
import { z } from "zod";
import type { AiConfig, ChatProviderId } from "@/config";
import { AiNoAnswerError, AiProviderError, type AiProvider, type AiRequest, type Completion } from "./types";

/**
 * Any server that speaks OpenAI's Chat Completions API (`POST <baseUrl>/chat/completions`):
 * OpenAI, Gemini's OpenAI endpoint, DeepSeek, xAI, Mistral, Groq, OpenRouter, Ollama.
 * Plain fetch, no SDK, so a new service is a config change.
 */

type Settings = AiConfig["providers"]["openai-compatible"];

const answerSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .nullish(),
});

/** Builds the request body (pure, so it is unit-tested). */
export function chatCompletionsBody(
  request: AiRequest,
  settings: Pick<Settings, "jsonMode" | "tokenLimitParam">,
): Record<string, unknown> {
  const { json } = request;
  // Without a strict schema the model only learns the shape from the instructions.
  const shapeHint =
    json && settings.jsonMode !== "json_schema"
      ? `\n\nAnswer with one JSON object only, no other text, matching this JSON schema:\n${JSON.stringify(json.schema)}`
      : "";
  return {
    model: request.model,
    messages: [{ role: "system", content: request.system + shapeHint }, ...request.messages],
    [settings.tokenLimitParam]: request.maxTokens,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(!json || settings.jsonMode === "none"
      ? {}
      : settings.jsonMode === "json_object"
        ? { response_format: { type: "json_object" } }
        : {
            response_format: {
              type: "json_schema",
              json_schema: { name: json.name, schema: json.schema, strict: true },
            },
          }),
  };
}

/** Turns a Chat Completions answer into a Completion, or throws when nothing usable came back. */
export function chatCompletion(
  body: unknown,
  requestedModel: string,
  id: ChatProviderId = "openai-compatible",
): Completion {
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) throw new AiProviderError(id, null);
  const [choice] = parsed.data.choices;
  if (!choice) throw new AiProviderError(id, null);
  if (choice.message.refusal || choice.finish_reason === "content_filter") {
    throw new AiNoAnswerError("refusal");
  }
  if (choice.finish_reason === "length") throw new AiNoAnswerError("max_tokens");
  const text = stripCodeFence(choice.message.content ?? "");
  if (!text) throw new AiNoAnswerError("empty");
  return {
    text,
    inputTokens: parsed.data.usage?.prompt_tokens ?? 0,
    outputTokens: parsed.data.usage?.completion_tokens ?? 0,
    model: parsed.data.model ?? requestedModel,
  };
}

/** Some models wrap JSON in a ```json fence even when asked not to. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

const modelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

export function openAiCompatibleProvider(options: {
  id?: ChatProviderId;
  apiKey: string;
  settings: Settings;
  timeoutMs: number;
  fetch?: typeof fetch;
}): AiProvider {
  const id = options.id ?? "openai-compatible";
  const send = options.fetch ?? fetch;
  const base = options.settings.baseUrl.replace(/\/+$/, "");
  const headers = {
    "content-type": "application/json",
    ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
  };
  /** One HTTP call; network failures and timeouts become AiProviderError (status null). */
  async function call(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    let response: Response;
    try {
      response = await send(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new AiProviderError(id, null);
    }
    // The body may echo the request, so it is never read into an error.
    if (!response.ok) throw new AiProviderError(id, response.status);
    try {
      return await response.json();
    } catch {
      throw new AiProviderError(id, response.status);
    }
  }
  return {
    id,
    complete: async (request) => {
      const body = await call(
        "/chat/completions",
        { method: "POST", body: JSON.stringify(chatCompletionsBody(request, options.settings)) },
        options.timeoutMs,
      );
      return chatCompletion(body, request.model, id);
    },
    listModels: async () => {
      const parsed = modelsSchema.safeParse(await call("/models", { method: "GET" }, 20_000));
      if (!parsed.success) throw new AiProviderError(id, null);
      // Some services (Gemini) prefix ids with "models/"; the API takes them without.
      return parsed.data.data.map((m) => m.id.replace(/^models\//, "")).sort();
    },
  };
}
