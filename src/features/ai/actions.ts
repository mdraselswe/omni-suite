"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { aiConfig } from "@/config";
import { t } from "@/i18n";
import { UserError } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { ForbiddenError, requirePermission } from "@/server/tenancy/context";
import type { Insight, ProposalDraft } from "./prompts";
import { businessInsights, draftProposal } from "./service";

export type AiResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function guarded<T>(fn: () => Promise<T>): Promise<AiResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof UserError) return { ok: false, message: error.message };
    if (error instanceof ForbiddenError) return { ok: false, message: t("form.forbidden") };
    if (error instanceof z.ZodError) return { ok: false, message: t("ai.briefInvalid") };
    console.error("[ai] action failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, message: t("ai.failed") };
  }
}

const draftInput = z.object({
  brief: z.string().trim().min(10).max(aiConfig.briefMaxLength),
  clientId: z.uuid().nullable(),
});

/** Drafts proposal text and line items from a short brief. Nothing is saved. */
export async function draftProposalAction(
  slug: string,
  input: { brief: string; clientId: string | null },
): Promise<AiResult<ProposalDraft>> {
  return guarded(async () => {
    const { ctx } = await actionContext(slug, "ai.use");
    requirePermission(ctx, "proposals.write");
    return draftProposal(db(), ctx, draftInput.parse(input));
  });
}

/** Three to five recommendations from the dashboard's numbers. */
export async function businessInsightsAction(slug: string): Promise<AiResult<Insight[]>> {
  return guarded(async () => {
    const { ctx } = await actionContext(slug, "ai.use");
    requirePermission(ctx, "dashboard.read");
    return businessInsights(db(), ctx);
  });
}
