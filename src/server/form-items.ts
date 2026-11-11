import "server-only";
import { z } from "zod";
import { t } from "@/i18n";
import { lineItemSchema, type LineItem } from "@/lib/line-items";
import { parseMoney, parsePercentBp } from "@/lib/money";
import { FieldErrors } from "@/server/action";

const rawItem = z.object({
  description: z.string(),
  quantity: z.string(),
  unitPrice: z.string(),
  taxPercent: z.string(),
});

/** Parses the `items` JSON field sent by <LineItemsEditor>. */
export function parseItemsField(value: string | undefined, currency: string): LineItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? "[]");
  } catch {
    parsed = [];
  }
  const rows = z.array(rawItem).safeParse(parsed);
  if (!rows.success) throw new FieldErrors({ items: [t("form.invalid")] });
  const items: LineItem[] = [];
  for (const row of rows.data) {
    if (!row.description.trim() && !row.unitPrice.trim()) continue;
    const price = parseMoney(row.unitPrice, currency);
    const tax = parsePercentBp(row.taxPercent || "0");
    const item = lineItemSchema.safeParse({
      description: row.description,
      quantity: row.quantity.trim() || "1",
      unitPriceMinor: price?.toString() ?? "x",
      taxRateBp: tax ?? -1,
    });
    if (!item.success) throw new FieldErrors({ items: [`${t("form.invalid")}: ${row.description || "—"}`] });
    items.push(item.data);
  }
  if (items.length === 0) throw new FieldErrors({ items: [t("invoices.noItems")] });
  return items;
}
