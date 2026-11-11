import type { CustomValues } from "@/lib/custom-fields";

/** Stored custom-field JSON → typed values (drops anything that isn't a string, number or boolean). */
export function storedCustom(value: unknown): CustomValues {
  if (typeof value !== "object" || value === null) return {};
  const out: CustomValues = {};
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[key] = v;
  }
  return out;
}
