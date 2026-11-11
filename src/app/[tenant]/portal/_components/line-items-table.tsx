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
import { lineAmount, type LineItem } from "@/lib/line-items";

/** Read-only line items with totals for portal documents (invoice, proposal). */
export function LineItemsTable({
  items,
  money,
  subtotalMinor,
  taxMinor,
  totalMinor,
  taxName,
  pricesIncludeTax,
}: {
  items: readonly LineItem[];
  money: (minor: bigint) => string;
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  taxName: string;
  pricesIncludeTax: boolean;
}) {
  return (
    <Table bare>
      <TableHeader>
        <TableRow>
          <TableHead>{t("items.description")}</TableHead>
          <TableHead className="text-right">{t("items.quantity")}</TableHead>
          <TableHead className="hidden text-right sm:table-cell">{t("items.price")}</TableHead>
          <TableHead className="hidden text-right sm:table-cell">{t("items.tax")}</TableHead>
          <TableHead className="text-right">{t("items.amount")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, i) => (
          <TableRow key={i}>
            <TableCell className="whitespace-normal">{item.description}</TableCell>
            <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">
              {money(BigInt(item.unitPriceMinor))}
            </TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">
              {item.taxRateBp / 100}%
            </TableCell>
            <TableCell className="text-right tabular-nums">{money(lineAmount(item))}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={4} className="text-right">
            <span className="sm:hidden">{t("items.subtotal")}</span>
            <span className="hidden sm:inline">
              {t("items.subtotal")} (
              {t(pricesIncludeTax ? "items.taxIncluded" : "items.taxExcluded", { tax: taxName })})
            </span>
          </TableCell>
          <TableCell className="text-right tabular-nums">{money(subtotalMinor)}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell colSpan={4} className="text-right">
            {taxName}
          </TableCell>
          <TableCell className="text-right tabular-nums">{money(taxMinor)}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell colSpan={4} className="text-right font-semibold">
            {t("items.total")}
          </TableCell>
          <TableCell className="text-right font-semibold tabular-nums">{money(totalMinor)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
