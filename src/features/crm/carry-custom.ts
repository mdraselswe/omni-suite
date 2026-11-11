import {
  customFieldName,
  parseCustomFields,
  type CustomFieldDef,
  type CustomValues,
} from "@/lib/custom-fields";

/**
 * Custom values from one record (a lead) for another entity's fields (a client):
 * only keys that exist in `defs`, and only values that pass that field's checks.
 * Missing or invalid values are left out instead of blocking the conversion.
 */
export function carryCustomValues(defs: readonly CustomFieldDef[], source: unknown): CustomValues {
  if (typeof source !== "object" || source === null) return {};
  const values: Record<string, unknown> = { ...source };
  const out: CustomValues = {};
  for (const def of defs) {
    if (!(def.key in values)) continue;
    const v = values[def.key];
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    const raw = def.type === "checkbox" ? (v === true || v === "true" || v === "on" ? "on" : "") : String(v);
    const parsed = parseCustomFields([{ ...def, required: false }], { [customFieldName(def.key)]: raw });
    if (parsed.ok && def.key in parsed.values) {
      const value = parsed.values[def.key];
      if (value !== undefined) out[def.key] = value;
    }
  }
  return out;
}
