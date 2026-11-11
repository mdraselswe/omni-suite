import { isIsoDate } from "./dates";

/** A tenant-defined extra field (ADR 0009). */
export type CustomFieldDef = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "checkbox";
  options: string[];
  required: boolean;
};

export type CustomValues = Record<string, string | number | boolean>;

/** Form field name for a custom field. */
export const customFieldName = (key: string) => `cf_${key}`;

/**
 * Reads `cf_<key>` values from a form object and validates them against the
 * definitions. Unknown keys are dropped. Returns values or per-field errors.
 */
export function parseCustomFields(
  defs: readonly CustomFieldDef[],
  raw: Record<string, string>,
): { ok: true; values: CustomValues } | { ok: false; errors: Record<string, string> } {
  const values: CustomValues = {};
  const errors: Record<string, string> = {};
  for (const def of defs) {
    const name = customFieldName(def.key);
    const input = (raw[name] ?? "").trim();
    if (def.type === "checkbox") {
      values[def.key] = input === "on" || input === "true";
      continue;
    }
    if (input === "") {
      if (def.required) errors[name] = "required";
      continue;
    }
    switch (def.type) {
      case "number": {
        const n = Number(input);
        if (!Number.isFinite(n)) errors[name] = "number";
        else values[def.key] = n;
        break;
      }
      case "date":
        if (!isIsoDate(input)) errors[name] = "date";
        else values[def.key] = input;
        break;
      case "select":
        if (!def.options.includes(input)) errors[name] = "option";
        else values[def.key] = input;
        break;
      default:
        values[def.key] = input.slice(0, 1000);
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** "Website budget" → "website_budget". */
export function fieldKey(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field"
  );
}
