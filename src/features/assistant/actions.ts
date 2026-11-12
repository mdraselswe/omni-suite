"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { aiConfig } from "@/config/ai";
import type { AiResult } from "@/features/ai";
import { t } from "@/i18n";
import { PORTAL_ASSISTANT_MODES } from "@/lib/tenant-settings";
import { formObject, runAction, UserError, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { ForbiddenError, PORTAL_ASSISTANT } from "@/server/tenancy/context";
import type { AssistantAnswer } from "./prompts";
import { askAssistant, sendToTeam, setPortalAssistant } from "./service";

const limits = aiConfig.portalAssistant;

async function guarded<T>(fn: () => Promise<T>): Promise<AiResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof UserError) return { ok: false, message: error.message };
    if (error instanceof ForbiddenError) return { ok: false, message: t("assistant.off") };
    if (error instanceof z.ZodError) return { ok: false, message: t("assistant.tooLong") };
    console.error("[assistant] action failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, message: t("ai.failed") };
  }
}

const question = z.string().trim().min(2).max(limits.questionMaxLength);

const askInput = z.object({
  question,
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(limits.questionMaxLength * 2),
      }),
    )
    .max(100),
});

/** A client's question to the portal assistant. Nothing is stored except usage counts. */
export async function askAssistantAction(
  slug: string,
  input: z.input<typeof askInput>,
): Promise<AiResult<AssistantAnswer>> {
  return guarded(async () => {
    const { ctx } = await actionContext(slug, PORTAL_ASSISTANT);
    return askAssistant(db(), ctx, askInput.parse(input));
  });
}

/** Passes the client's question to the team (notification and email). */
export async function sendToTeamAction(slug: string, text: string): Promise<AiResult<true>> {
  return guarded(async () => {
    const { ctx } = await actionContext(slug, PORTAL_ASSISTANT);
    await sendToTeam(db(), ctx, question.parse(text));
    return true as const;
  });
}

/** Settings → AI assistant: off, every client, or the clients ticked. */
export async function setPortalAssistantAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "settings.manage");
    const { mode } = z.object({ mode: z.enum(PORTAL_ASSISTANT_MODES) }).parse(formObject(formData));
    const clientIds = z.array(z.uuid()).max(10_000).parse(formData.getAll("clientIds"));
    await setPortalAssistant(db(), ctx, { mode, clientIds });
    return t("assistant.settings.saved");
  });
}
