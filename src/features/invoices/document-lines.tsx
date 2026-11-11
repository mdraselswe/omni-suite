import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/i18n";
import { computeTotals, type LineItem } from "@/lib/line-items";
import { formatMoney } from "@/lib/money";

/** Read-only line items with totals, for invoices, proposals and the print view. */
export function DocumentLines({
  items,
  currency,
  locale,
  pricesIncludeTax,
  taxName,
  totals,
  extra,
}: {
  items: readonly LineItem[];
  currency: string;
  locale: string;
  pricesIncludeTax: boolean;
  taxName: string;
  totals: { subtotalMinor: bigint; taxMinor: bigint; totalMinor: bigint };
  /** Rows after the total, e.g. paid and balance due. */
  extra?: readonly { label: string; amount: bigint; strong?: boolean }[];
}) {
  const money = (m: bigint) => formatMoney(m, currency, locale);
  const { lineAmounts } = computeTotals([...items], pricesIncludeTax);
  return (
    <Table bare>
      <TableHeader>
        <TableRow>
          <TableHead>{t("items.description")}</TableHead>
          <TableHead className="hidden text-right sm:table-cell">{t("items.quantity")}</TableHead>
          <TableHead className="hidden text-right sm:table-cell">{t("items.price")}</TableHead>
          <TableHead className="hidden text-right md:table-cell">{t("items.tax")}</TableHead>
          <TableHead className="text-right">{t("items.amount")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, i) => (
          <TableRow key={`${i}-${item.description}`}>
            <TableCell className="whitespace-normal">
              {item.description}
              <span className="block text-xs text-muted-foreground sm:hidden">
                {item.quantity} × {money(BigInt(item.unitPriceMinor))}
              </span>
            </TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">{item.quantity}</TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">
              {money(BigInt(item.unitPriceMinor))}
            </TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">
              {item.taxRateBp / 100}%
            </TableCell>
            <TableCell className="text-right tabular-nums">{money(lineAmounts[i] ?? 0n)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        {[
          { label: t("items.subtotal"), amount: totals.subtotalMinor, strong: false },
          { label: taxName, amount: totals.taxMinor, strong: false },
          { label: t("items.total"), amount: totals.totalMinor, strong: true },
          ...(extra ?? []),
        ].map((row) => (
          <TableRow key={row.label} className={row.strong ? "font-semibold" : undefined}>
            <TableCell colSpan={4} className="hidden text-right md:table-cell">
              {row.label}
            </TableCell>
            <TableCell colSpan={3} className="hidden text-right sm:table-cell md:hidden">
              {row.label}
            </TableCell>
            <TableCell className="sm:hidden">{row.label}</TableCell>
            <TableCell className="text-right tabular-nums">{money(row.amount)}</TableCell>
          </TableRow>
        ))}
      </TableFooter>
    </Table>
  );
}
