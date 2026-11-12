"use server";

import { unstable_rethrow } from "next/navigation";
import { t } from "@/i18n";
import { defaultDateFormat, isDateFormat, type ImportPreview, type ImportResult } from "@/lib/csv-import";
import { errorState, runAction } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";
import { importLeads, leadPreview, planLeadImport, readImportRows } from "./import";

function dateFormatOf(formData: FormData, ctx: TenantContext) {
  const value = formData.get("dateFormat");
  return typeof value === "string" && isDateFormat(value)
    ? value
    : defaultDateFormat(ctx.tenant.settings.locale);
}

/** Checks a leads CSV and returns what an import would do, row by row. Writes nothing. */
export async function previewLeadImportAction(slug: string, formData: FormData): Promise<ImportPreview> {
  try {
    const { ctx } = await actionContext(slug, "leads.write");
    const rows = await readImportRows(formData);
    return leadPreview(await planLeadImport(db(), ctx, rows, dateFormatOf(formData, ctx)));
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: errorState(error)?.message ?? t("form.failed") };
  }
}

/** Imports the rows of a leads CSV that pass (duplicates and rows with errors are skipped). */
export async function importLeadsAction(slug: string, formData: FormData): Promise<ImportResult> {
  // Filled inside runAction, which only returns a message.
  const result: { counts: Extract<ImportResult, { ok: true }>["counts"] | null } = { counts: null };
  const state = await runAction(async () => {
    const { ctx } = await actionContext(slug, "leads.write");
    const rows = await readImportRows(formData);
    const counts = await importLeads(db(), ctx, rows, dateFormatOf(formData, ctx));
    result.counts = counts;
    return t("imports.leads.done", { count: counts.imported });
  });
  return state?.ok && result.counts
    ? { ok: true, message: state.message ?? "", counts: result.counts }
    : { ok: false, message: state?.message ?? t("form.failed") };
}
