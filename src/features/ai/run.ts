import "server-only";
import { aiConfig } from "@/config/ai";
import { aiDailyLimit } from "@/features/billing";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { UserError } from "@/server/action";
import { aiConfigured, AiNoAnswerError, complete, type Completer, type Completion } from "@/server/ai";
import type { DbOrTx } from "@/server/db";
import { consume, DAY_MS, release, type Rule } from "@/server/rate-limit";
import type { TenantContext } from "@/server/tenancy/context";
import type { Prompt } from "./prompts";
import { recordAiTokens, releaseAiRequest, reserveAiRequest } from "./usage";

/** The AI call (provider and model picked per feature); tests pass a fake. */
export type { Completer };

/**
 * Runs one AI request against the member's and the business's daily allowances
 * (the business's comes from its plan). A failed call gives the request back.
 * Errors become messages people can read.
 */
export async function runAi<T>(
  database: DbOrTx,
  ctx: Pick<TenantContext, "tenant" | "user">,
  request: Prompt,
  parse: (text: string) => T | null,
  completer: Completer = complete,
): Promise<T> {
  if (completer === complete && !aiConfigured(request.feature)) throw new UserError(t("ai.notConfigured"));
  const day = today(ctx.tenant.settings.timezone);
  const limit = await aiDailyLimit(database, ctx.tenant);
  if (limit <= 0) throw new UserError(t("security.aiPlanOff"));
  // Per member (across businesses), so one person can't spend everyone's allowance.
  const member: Rule = {
    key: `ai:user:${ctx.user.id}`,
    limit: aiConfig.dailyRequestsPerMember,
    windowMs: DAY_MS,
  };
  if (!(await consume(database, member))) {
    throw new UserError(t("security.aiMemberLimit", { limit: member.limit }));
  }
  if (!(await reserveAiRequest(database, ctx.tenant.id, day, limit))) {
    await release(database, member);
    throw new UserError(t("ai.limitReached", { limit }));
  }
  let answer: Completion;
  try {
    answer = await completer(request.feature, {
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
      json: { name: request.feature, schema: request.schema },
    });
  } catch (error) {
    await releaseAiRequest(database, ctx.tenant.id, day);
    await release(database, member);
    // Log the kind of failure only: the prompt holds business data.
    console.error("[ai] request failed:", error instanceof Error ? error.name : "unknown");
    throw new UserError(t(error instanceof AiNoAnswerError ? "ai.noAnswer" : "ai.failed"));
  }
  await recordAiTokens(database, ctx.tenant.id, day, answer);
  const result = parse(answer.text);
  if (result === null) throw new UserError(t("ai.noAnswer"));
  return result;
}
