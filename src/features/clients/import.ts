import "server-only";
import { z } from "zod";
import { parseCustomFields, type CustomFieldDef } from "@/lib/custom-fields";
import { fields } from "@/server/action";
import type { ClientInput } from "./service";

export const clientSchema = z.object({
  name: fields.required(200),
  email: fields.email(),
  phone: fields.text(50),
  website: fields.text(300),
  address: fields.text(500),
  notes: fields.text(5000),
  status: z.enum(["active", "inactive"]).default("active"),
});

/**
 * CSV rows → clients to create. Columns: name, email, phone, website, address, notes,
 * plus `cf_<key>` for custom fields (validated like the form). Rows that fail are
 * reported by number (1 = first row under the header) instead of being dropped silently.
 */
export function parseClientImport(
  rows: readonly Record<string, string>[],
  defs: readonly CustomFieldDef[],
): { clients: ClientInput[]; skippedRows: number[] } {
  const clients: ClientInput[] = [];
  const skippedRows: number[] = [];
  rows.forEach((row, i) => {
    const parsed = clientSchema.safeParse({ ...row, status: "active" });
    const custom = parseCustomFields(defs, row);
    if (!parsed.success || !custom.ok) {
      skippedRows.push(i + 1);
      return;
    }
    clients.push({ ...parsed.data, custom: custom.values });
  });
  return { clients, skippedRows };
}
