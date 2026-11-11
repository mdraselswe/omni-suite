import { FilterBar, FilterDate, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { Section, StatCard } from "@/components/layout/page";
import { ButtonAnchor } from "@/components/ui/button-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { monthlyTotals, profitAndLoss } from "@/features/finance";
import { gstSummary } from "@/features/invoices";
import { t } from "@/i18n";
import { fiscalYearStart, formatMonth, isIsoDate, today } from "@/lib/dates";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { hasPermission } from "@/server/tenancy/context";

export default async function ReportPage({ params, searchParams }: PageProps<"/[tenant]/finance/report">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "finance.read");
  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const from = isIsoDate(param(sp, "from"))
    ? param(sp, "from")
    : fiscalYearStart(now, ctx.tenant.settings.fiscalYearStartMonth);
  const to = isIsoDate(param(sp, "to")) ? param(sp, "to") : now;
  const [pnl, months, gst] = await Promise.all([
    profitAndLoss(db(), ctx.tenant.id, from, to),
    monthlyTotals(db(), ctx.tenant.id, from, to),
    gstSummary(db(), ctx.tenant.id, from, to),
  ]);
  const income = pnl.lines.filter((l) => l.kind === "income");
  const expense = pnl.lines.filter((l) => l.kind === "expense");
  const csv = `/api/t/${tenant}/export/transactions.csv?from=${from}&to=${to}`;

  return (
    <div className="grid gap-8">
      <FilterBar>
        <FilterDate name="from" label={t("finance.from")} value={from} />
        <FilterDate name="to" label={t("finance.to")} value={to} />
      </FilterBar>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("finance.totalIncome")} value={f.money(pnl.incomeMinor)} />
        <StatCard label={t("finance.totalExpense")} value={f.money(pnl.expenseMinor)} />
        <StatCard
          label={t("finance.netProfit")}
          value={f.money(pnl.profitMinor)}
          tone={pnl.profitMinor < 0n ? "negative" : "positive"}
        />
        <StatCard
          label={`${ctx.tenant.settings.tax.name} · ${t("finance.gstCollected")}`}
          value={f.money(gst.taxMinor)}
          hint={t("finance.gstNote")}
        />
      </div>

      <Section
        title={t("finance.report")}
        description={t("finance.reportSub")}
        actions={
          hasPermission(ctx, "finance.export") ? (
            <ButtonAnchor href={csv} variant="outline" size="sm">
              {t("finance.export")}
            </ButtonAnchor>
          ) : null
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          {[
            { title: t("finance.kind.income"), lines: income, total: pnl.incomeMinor },
            { title: t("finance.kind.expense"), lines: expense, total: pnl.expenseMinor },
          ].map((block) => (
            <Table key={block.title}>
              <TableHeader>
                <TableRow>
                  <TableHead>{block.title}</TableHead>
                  <TableHead className="text-right">{t("finance.amount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {block.lines.map((l) => (
                  <TableRow key={`${l.kind}-${l.categoryId ?? "none"}`}>
                    <TableCell>{l.categoryName}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.money(l.totalMinor)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>{t("dist.total")}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.money(block.total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ))}
        </div>
      </Section>

      <Section title={t("dash.trend")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("form.date.label")}</TableHead>
              <TableHead className="text-right">{t("dash.income")}</TableHead>
              <TableHead className="text-right">{t("dash.expense")}</TableHead>
              <TableHead className="text-right">{t("dist.profit")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((m) => (
              <TableRow key={m.month}>
                <TableCell>{formatMonth(`${m.month}-01`, f.locale)}</TableCell>
                <TableCell className="text-right tabular-nums">{f.money(m.incomeMinor)}</TableCell>
                <TableCell className="text-right tabular-nums">{f.money(m.expenseMinor)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {f.money(m.incomeMinor - m.expenseMinor)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </div>
  );
}
