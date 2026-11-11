import "server-only";
import { aiConfig } from "@/config/ai";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { UserError } from "@/server/action";
import { aiConfigured, AiNoAnswerError, complete, type Completion } from "@/server/ai";
import type { DbOrTx } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";
import type { Prompt } from "./prompts";
import { recordAiTokens, releaseAiRequest, reserveAiRequest } from "./usage";

/** The Claude call; tests pass a fake. */
export type Completer = (request: Prompt) => Promise<Completion>;

/**
 * Runs one AI request against the business's daily allowance. A failed call
 * gives the request back. Errors become messages people can read.
 */
export async function runAi<T>(
  database: DbOrTx,
  ctx: Pick<TenantContext, "tenant">,
  request: Prompt,
  parse: (text: string) => T | null,
  completer: Completer = complete,
): Promise<T> {
  if (completer === complete && !aiConfigured()) throw new UserError(t("ai.notConfigured"));
  const day = today(ctx.tenant.settings.timezone);
  const limit = aiConfig.dailyRequestsPerBusiness;
  if (!(await reserveAiRequest(database, ctx.tenant.id, day, limit))) {
    throw new UserError(t("ai.limitReached", { limit }));
  }
  let answer: Completion;
  try {
    answer = await completer(request);
  } catch (error) {
    await releaseAiRequest(database, ctx.tenant.id, day);
    // Log the kind of failure only: the prompt holds business data.
    console.error("[ai] request failed:", error instanceof Error ? error.name : "unknown");
    throw new UserError(t(error instanceof AiNoAnswerError ? "ai.noAnswer" : "ai.failed"));
  }
  await recordAiTokens(database, ctx.tenant.id, day, answer);
  const result = parse(answer.text);
  if (result === null) throw new UserError(t("ai.noAnswer"));
  return result;
}
