import Link from "next/link";
import { formatters } from "@/components/data/format";
import { EmptyState, Section } from "@/components/layout/page";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AGE_BUCKETS, agedReceivables, agedTotals } from "@/features/invoices";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { cn } from "@/lib/utils";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { hasPermission } from "@/server/tenancy/context";

/** Aged receivables: what each client owes, by how late it is (one table per currency). */
export default async function AgedReceivablesPage({ params }: PageProps<"/[tenant]/invoices/aged">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "invoices.read");
  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const rows = await agedReceivables(db(), ctx.tenant.id, now);
  const totals = agedTotals(rows);
  const base = ctx.tenant.settings.currency;
  const currencies = [...totals.keys()].sort((a, b) =>
    a === base ? -1 : b === base ? 1 : a.localeCompare(b),
  );
  const canSeeClients = hasPermission(ctx, "clients.read");
  const late = (bucket: string) => bucket !== "current";

  if (rows.length === 0) return <EmptyState title={t("aged.none")} body={t("aged.sub")} />;

  return (
    <div className="grid gap-8">
      <p className="text-sm text-muted-foreground">{t("aged.sub")}</p>
      {currencies.map((currency) => {
        const sum = totals.get(currency);
        return (
          <Section key={currency} title={currencies.length > 1 ? currency : t("aged.title")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("aged.client")}</TableHead>
                  {AGE_BUCKETS.map((bucket) => (
                    <TableHead key={bucket} className="text-right whitespace-nowrap">
                      {t(`aged.${bucket}`)}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">{t("aged.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows
                  .filter((r) => r.currency === currency)
                  .map((r) => (
                    <TableRow key={`${r.clientId}-${r.currency}`}>
                      <TableCell>
                        {canSeeClients ? (
                          <Link
                            href={tenantHref(tenant, `clients/${r.clientId}/statement`)}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {r.clientName}
                          </Link>
                        ) : (
                          r.clientName
                        )}
                      </TableCell>
                      {AGE_BUCKETS.map((bucket) => (
                        <TableCell
                          key={bucket}
                          className={cn(
                            "text-right whitespace-nowrap tabular-nums",
                            late(bucket) && r.buckets[bucket] > 0n && "text-destructive",
                            r.buckets[bucket] === 0n && "text-muted-foreground",
                          )}
                        >
                          {r.buckets[bucket] === 0n ? "–" : f.money(r.buckets[bucket], currency)}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                        {f.money(r.totalMinor, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
              {sum ? (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-medium">{t("aged.totals")}</TableCell>
                    {AGE_BUCKETS.map((bucket) => (
                      <TableCell key={bucket} className="text-right whitespace-nowrap tabular-nums">
                        {f.money(sum[bucket], currency)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
                      {f.money(sum.totalMinor, currency)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </Section>
        );
      })}
    </div>
  );
}
