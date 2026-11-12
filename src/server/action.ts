import "server-only";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { ForbiddenError } from "@/server/tenancy/context";
import { t } from "@/i18n";
import { parseCustomFields, type CustomFieldDef, type CustomValues } from "@/lib/custom-fields";
import { parseMoney } from "@/lib/money";

/** What every form action returns to `useActionState`. */
export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Bumped on success so forms can reset. */
  at?: number;
} | null;

/** An error whose message is safe to show to the user. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

/** Field-level errors found outside zod (e.g. custom fields). */
export class FieldErrors extends Error {
  constructor(public readonly errors: Record<string, string[]>) {
    super("Field errors");
    this.name = "FieldErrors";
  }
}

/**
 * Runs a form action body and converts known errors into an ActionState.
 * Redirects pass through. Unknown errors are logged and shown generically.
 */
export async function runAction(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    // Re-render the current page with fresh data (no caches in this app, ADR 0008).
    refresh();
    return { ok: true, message: message ?? t("form.saved"), at: Date.now() };
  } catch (error) {
    unstable_rethrow(error);
    return errorState(error);
  }
}

/** A known error as an ActionState (also used by route handlers that answer forms). Unknown errors are logged. */
export function errorState(error: unknown): ActionState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, message: t("form.fixErrors"), fieldErrors };
  }
  if (error instanceof FieldErrors)
    return { ok: false, message: t("form.fixErrors"), fieldErrors: error.errors };
  if (error instanceof ForbiddenError) return { ok: false, message: t("form.forbidden") };
  if (error instanceof UserError) return { ok: false, message: error.message };
  console.error(error);
  return { ok: false, message: t("form.failed") };
}

/** FormData → plain object (last value wins; checkboxes give "on"). */
export function formObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  }
  return out;
}

/** Common zod helpers for form input. */
export const fields = {
  /** Fields hidden by the form (conditional inputs) are missing from FormData, so optional helpers accept `undefined`. */
  text: (max = 500) => z.string().trim().max(max).default(""),
  required: (max = 500) => z.string().trim().min(1, t("form.required")).max(max),
  email: () => z.union([z.literal(""), z.email(t("form.email"))]).default(""),
  date: () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t("form.date")),
  optionalDate: () =>
    z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t("form.date"))]).default(""),
  checkbox: () =>
    z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
  id: () => z.uuid(),
  optionalId: () =>
    z
      .union([z.literal(""), z.uuid()])
      .optional()
      .transform((v) => (v === undefined || v === "" ? null : v)),
  /**
   * "1,250.50" → 125050n (minor units). Negatives are rejected unless `allowNegative`
   * (an overdrawn opening balance); `positive` also rejects zero.
   */
  money: (currency: string, opts: { positive?: boolean; optional?: boolean; allowNegative?: boolean } = {}) =>
    z.string().transform((value, c) => {
      if (opts.optional && value.trim() === "") return 0n;
      const parsed = parseMoney(value, currency);
      if (parsed === null || (opts.positive && parsed <= 0n) || (parsed < 0n && !opts.allowNegative)) {
        c.addIssue({ code: "custom", message: t("form.amount") });
        return z.NEVER;
      }
      return parsed;
    }),
  int: (min = 0, max = 1_000_000) => z.coerce.number().int().min(min).max(max),
  /** All values of a repeated field (e.g. several checkboxes with the same name). */
  all: (formData: FormData, name: string) =>
    formData.getAll(name).filter((v): v is string => typeof v === "string"),
};

/** Validated custom-field values from a form, or throws FieldErrors. */
export function customValues(defs: readonly CustomFieldDef[], raw: Record<string, string>): CustomValues {
  const result = parseCustomFields(defs, raw);
  if (result.ok) return result.values;
  throw new FieldErrors(
    Object.fromEntries(
      Object.entries(result.errors).map(([k, v]) => [
        k,
        [v === "required" ? t("form.required") : t("form.invalid")],
      ]),
    ),
  );
}
