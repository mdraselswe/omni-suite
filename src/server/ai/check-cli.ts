/**
 * `pnpm ai:check` — which AI providers have a key, whether each key works, and the
 * models it can use (listing models spends no tokens). `pnpm ai:check --ping` also
 * sends one tiny JSON request to each provider with a key (a few tokens each).
 * Keys are read from .env.local and never printed.
 */
import { aiConfig } from "@/config/ai";
import { serverEnv } from "@/config/env";
import { anthropicProvider } from "./anthropic";
import { openAiCompatibleProvider } from "./openai-compatible";
import { API_KEYS, checkProvider, completeWith, providerStatuses, type ProviderStatus } from "./registry";
import { AiNoAnswerError, AiProviderError } from "./types";

/** A command-line tool prints to stdout (console.log is kept out of app code by lint). */
const log = (line: string) =>
  process.stdout.write(`${line}
`);

const FREE = { no: "paid only", yes: "free tier", "yes-trains": "free tier (may train on prompts)" } as const;

function providerFor(s: ProviderStatus) {
  const apiKey = serverEnv()[API_KEYS[s.id]];
  return s.id === "anthropic"
    ? anthropicProvider({ apiKey, settings: aiConfig.providers.anthropic, timeoutMs: aiConfig.timeoutMs })
    : openAiCompatibleProvider({
        id: s.id,
        apiKey,
        settings: aiConfig.providers[s.id],
        timeoutMs: aiConfig.timeoutMs,
      });
}

async function ping(s: ProviderStatus): Promise<string> {
  try {
    const answer = await completeWith(
      "insights",
      {
        system: "You check that an API connection works.",
        messages: [{ role: "user", content: 'Reply with the JSON {"ok": true} and nothing else.' }],
        maxTokens: 200,
        json: {
          name: "ping",
          schema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
          },
        },
      },
      { ...aiConfig, defaultProvider: s.id, features: {}, fallbackProviders: [] },
      () => providerFor(s),
      {},
    );
    const parsed: unknown = JSON.parse(answer.text);
    const good = typeof parsed === "object" && parsed !== null && (parsed as { ok?: unknown }).ok === true;
    return good
      ? `ping ok (${answer.model}, ${answer.inputTokens}+${answer.outputTokens} tokens)`
      : "ping answered, but not the JSON asked for: try another jsonMode";
  } catch (error) {
    if (error instanceof AiProviderError) return `ping failed (HTTP ${String(error.status ?? "-")})`;
    if (error instanceof AiNoAnswerError) return `ping got no usable answer (${error.reason})`;
    return "ping failed (the answer was not JSON: try another jsonMode)";
  }
}

async function main() {
  const withPing = process.argv.includes("--ping");
  const statuses = providerStatuses();
  log("AI providers (src/config/ai.ts; keys in .env.local):\n");
  for (const s of statuses) {
    const role = [
      s.isDefault ? "default" : "",
      s.fallbackOrder ? `fallback #${s.fallbackOrder}` : "",
      s.features.length > 0 ? `used by: ${s.features.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    log(`${s.label} [${s.id}] model ${s.model}${role ? ` · ${role}` : ""}`);
    if (!s.hasKey) {
      log(`  no key: set ${s.keyName}${s.keyUrl ? ` (get one at ${s.keyUrl})` : ""} · ${FREE[s.free]}\n`);
      continue;
    }
    const check = await checkProvider(s.id);
    if (!check.ok) {
      log(
        `  key set, but the check failed (HTTP ${String(check.status ?? "-")}): wrong key or service down\n`,
      );
      continue;
    }
    log(`  key works · ${check.models.length} models · ${FREE[s.free]}`);
    if (!check.modelFound) {
      const sample = check.models.slice(0, 15).join(", ");
      log(`  "${s.model}" is not in its list. Pick one in src/config/ai.ts, e.g.: ${sample}`);
    }
    if (withPing) log(`  ${await ping(s)}`);
    log("");
  }
  if (!statuses.some((s) => s.hasKey)) log("No AI key is set: AI features stay hidden.");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "ai:check failed");
  process.exit(1);
});
