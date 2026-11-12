"use server";

import { unstable_rethrow } from "next/navigation";
import { t } from "@/i18n";
import { defaultDateFormat, isDateFormat, type ImportPreview, type ImportResult } from "@/lib/csv-import";
import { errorState, runAction } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";
import {
  bankPreview,
  importBankTransactions,
  planBankImport,
  readImportRows,
  type BankImportOptions,
} from "./import";

function optionsOf(formData: FormData, ctx: TenantContext): BankImportOptions {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const dateFormat = text("dateFormat");
  return {
    accountId: text("accountId"),
    dateFormat: isDateFormat(dateFormat) ? dateFormat : defaultDateFormat(ctx.tenant.settings.locale),
    fxRate: text("fxRate") || undefined,
  };
}

/** Checks a bank statement CSV and returns what an import would do, row by row. Writes nothing. */
export async function previewBankImportAction(slug: string, formData: FormData): Promise<ImportPreview> {
  try {
    const { ctx } = await actionContext(slug, "finance.write");
    const rows = await readImportRows(formData);
    return bankPreview(await planBankImport(db(), ctx, rows, optionsOf(formData, ctx)));
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: errorState(error)?.message ?? t("form.failed") };
  }
}

/** Imports the rows of a bank statement CSV that pass (duplicates and rows with errors are skipped). */
export async function importBankAction(slug: string, formData: FormData): Promise<ImportResult> {
  // Filled inside runAction, which only returns a message.
  const result: { counts: Extract<ImportResult, { ok: true }>["counts"] | null } = { counts: null };
  const state = await runAction(async () => {
    const { ctx } = await actionContext(slug, "finance.write");
    const rows = await readImportRows(formData);
    const counts = await importBankTransactions(db(), ctx, rows, optionsOf(formData, ctx));
    result.counts = counts;
    return t("imports.bank.done", { count: counts.imported });
  });
  return state?.ok && result.counts
    ? { ok: true, message: state.message ?? "", counts: result.counts }
    : { ok: false, message: state?.message ?? t("form.failed") };
}
