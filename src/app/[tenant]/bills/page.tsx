import { ReceiptText } from "lucide-react";
import Link from "next/link";
import { FilterBar, FilterSearch, FilterSelect, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { NoResults } from "@/components/data/no-results";
import { Pagination } from "@/components/data/pagination";
import { StatusBadge } from "@/components/data/status-badge";
import { EmptyState, Section, StatCard } from "@/components/layout/page";
import { ButtonLink } from "@/components/ui/button-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BILL_FILTERS,
  billBalance,
  billDisplayStatus,
  DueText,
  pageBills,
  payables,
  type BillFilterStatus,
} from "@/features/bills";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { keepSize, parsePage } from "@/lib/pagination";
import { normaliseSearch } from "@/lib/search";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { hasPermission } from "@/server/tenancy/context";

export default async function BillsPage({ params, searchParams }: PageProps<"/[tenant]/bills">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "bills.read");
  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const statusParam = param(sp, "status");
  const status: BillFilterStatus | undefined = BILL_FILTERS.find((s) => s === statusParam);
  const q = normaliseSearch(param(sp, "q"));
  const page = parsePage(sp);
  const path = tenantHref(tenant, "bills");
  const canWrite = hasPermission(ctx, "bills.write");
  const database = db();
  const [found, owed] = await Promise.all([
    pageBills(database, ctx.tenant.id, { status, q, today: now }, page),
    payables(database, ctx.tenant.id, now, ctx.tenant.settings.currency),
  ]);
  const rows = found.rows;
  const newBill = canWrite ? (
    <ButtonLink href={tenantHref(tenant, "bills/new")}>{t("bills.new")}</ButtonLink>
  ) : null;

  return (
    <div className="grid gap-8">
      <section aria-labelledby="bills-owed" className="grid gap-3">
        <h2 id="bills-owed" className="sr-only">
          {t("bills.toPay")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {owed.byCurrency.length === 0 ? (
            <StatCard label={t("bills.toPay")} value={f.money(0n)} hint={t("bills.nothingOwed")} />
          ) : (
            owed.byCurrency.map((p) => (
              <StatCard
                key={p.currency}
                label={t("bills.toPayIn", { currency: p.currency })}
                value={f.money(p.owedMinor, p.currency)}
                tone={p.overdueMinor > 0n ? "negative" : "default"}
                hint={
                  p.overdueCount > 0
                    ? t("bills.owedHintOverdue", {
                        count: p.count,
                        overdue: f.money(p.overdueMinor, p.currency),
                        overdueCount: p.overdueCount,
                      })
                    : t("bills.owedHint", { count: p.count })
                }
              />
            ))
          )}
        </div>
      </section>

      <Section title={t("bills.list")} actions={newBill}>
        <FilterBar keep={keepSize(page)}>
          <FilterSelect
            name="status"
            label={t("form.status")}
            value={status}
            options={BILL_FILTERS.map((s) => ({ value: s, label: t(`bills.filter.${s}`) }))}
          />
          <FilterSearch value={q} />
        </FilterBar>

        {rows.length === 0 ? (
          q ? (
            <NoResults q={q} path={path} searchParams={sp} />
          ) : (
            <EmptyState
              icon={ReceiptText}
              title={status ? t("bills.noneFiltered") : t("bills.none")}
              body={status ? undefined : t("bills.noneBody")}
              action={status ? undefined : newBill}
            />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("bills.supplier")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("bills.issueDate")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("bills.dueDate")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("form.status")}</TableHead>
                <TableHead className="hidden text-right lg:table-cell">{t("bills.total")}</TableHead>
                <TableHead className="text-right">{t("bills.balance")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ bill, categoryName }) => {
                const shown = billDisplayStatus(bill, now);
                const balance = billBalance(bill);
                const due = (
                  <DueText
                    dueDate={bill.dueDate}
                    today={now}
                    formatted={f.date(bill.dueDate)}
                    owing={balance > 0n}
                  />
                );
                return (
                  <TableRow key={bill.id}>
                    <TableCell className="whitespace-normal">
                      <div className="grid gap-0.5">
                        <Link
                          href={tenantHref(tenant, `bills/${bill.id}`)}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {bill.supplier}
                        </Link>
                        {bill.reference || categoryName ? (
                          <span className="text-xs text-muted-foreground">
                            {[bill.reference, categoryName].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                        {/* Small screens: due date and status in words under the name. */}
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:hidden">
                          {due}
                          {shown === "overdue" || shown === "open" ? null : (
                            <StatusBadge status={shown} label={t(`bills.status.${shown}`)} />
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap md:table-cell">
                      {f.date(bill.issueDate)}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap sm:table-cell">
                      <div className="grid">
                        <span>{f.date(bill.dueDate)}</span>
                        {balance > 0n && bill.dueDate <= now ? (
                          <DueText
                            dueDate={bill.dueDate}
                            today={now}
                            formatted={f.date(bill.dueDate)}
                            owing
                            className="text-xs"
                          />
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <StatusBadge status={shown} label={t(`bills.status.${shown}`)} />
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {f.money(bill.totalMinor, bill.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.money(balance, bill.currency)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pagination path={path} searchParams={sp} request={page} paged={found} locale={f.locale} />
      </Section>
    </div>
  );
}
