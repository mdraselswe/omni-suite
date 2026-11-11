import Link from "next/link";
import { redirect } from "next/navigation";
import { formatters } from "@/components/data/format";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/layout/page";
import { ButtonLink } from "@/components/ui/button-link";
import { pipelineSummary } from "@/features/crm";
import { listAccounts, monthlyTotals, profitAndLoss } from "@/features/finance";
import { listInvoices, monthlyRecurring, receivables } from "@/features/invoices";
import { listProjects, myDueTasks } from "@/features/projects";
import { t } from "@/i18n";
import {
  addDays,
  addMonths,
  daysBetween,
  fiscalYearStart,
  formatMonth,
  monthStart,
  today,
} from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { requireTenant } from "@/server/auth/session";
import { db } from "@/server/db";
import { hasPermission, isModuleEnabled } from "@/server/tenancy/context";
import { navFor } from "@/server/tenancy/nav";

const TREND_MONTHS = 6;

/** Runs `fn` only when allowed; otherwise resolves to null (keeps Promise.all flat). */
function when<T>(allowed: boolean, fn: () => Promise<T>): Promise<T | null> {
  return allowed ? fn() : Promise.resolve(null);
}

export default async function DashboardPage({ params }: PageProps<"/[tenant]">) {
  const { tenant } = await params;
  const ctx = await requireTenant(tenant);
  if (ctx.membership.kind === "client") redirect(tenantHref(tenant, "portal"));

  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const database = db();
  const canDash = hasPermission(ctx, "dashboard.read");
  const canFinance = canDash && hasPermission(ctx, "finance.read");
  const canInvoices = canDash && hasPermission(ctx, "invoices.read");
  const canPipeline = canDash && isModuleEnabled(ctx, "crm") && hasPermission(ctx, "leads.read");
  const projectScope = isModuleEnabled(ctx, "projects") ? ctx.permissions.get("projects.read") : undefined;
  const hasTasks = isModuleEnabled(ctx, "projects");

  const trendFrom = monthStart(addMonths(now, -(TREND_MONTHS - 1)));
  const runwayFrom = monthStart(addMonths(now, -3));
  const runwayTo = addDays(monthStart(now), -1);

  const [accounts, month, fy, trend, spend, owed, mrr, overdue, pipeline, tasks, projects] =
    await Promise.all([
      when(canFinance, () => listAccounts(database, ctx.tenant.id)),
      when(canFinance, () => profitAndLoss(database, ctx.tenant.id, monthStart(now), now)),
      when(canFinance, () =>
        profitAndLoss(
          database,
          ctx.tenant.id,
          fiscalYearStart(now, ctx.tenant.settings.fiscalYearStartMonth),
          now,
        ),
      ),
      when(canFinance, () => monthlyTotals(database, ctx.tenant.id, trendFrom, now)),
      when(canFinance, () => monthlyTotals(database, ctx.tenant.id, runwayFrom, runwayTo)),
      when(canInvoices, () => receivables(database, ctx.tenant.id, now)),
      when(canInvoices, () => monthlyRecurring(database, ctx)),
      when(canInvoices, () => listInvoices(database, ctx.tenant.id, { status: "overdue", today: now })),
      when(canPipeline, () => pipelineSummary(database, ctx)),
      when(hasTasks, () => myDueTasks(database, ctx, addDays(now, 7))),
      when(canDash && projectScope !== undefined, () => listProjects(database, ctx, projectScope ?? "own")),
    ]);

  const tasksBlock = hasTasks ? (
    <Section title={t("dash.dueTasks")}>
      {!tasks || tasks.length === 0 ? (
        <EmptyState title={t("dash.noTasks")} />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {tasks.map(({ task, projectName }) => (
            <li key={task.id}>
              <Link
                href={tenantHref(tenant, `projects/${task.projectId}`)}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="grid min-w-0">
                  <span className="truncate font-medium">{task.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{projectName}</span>
                </span>
                {task.dueDate ? (
                  <span
                    className={
                      task.dueDate < now ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                    }
                  >
                    {t("dash.dueOn", { date: f.date(task.dueDate) })}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  ) : null;

  if (!canDash) {
    const links = navFor(ctx).filter((item) => item.href !== tenantHref(tenant));
    return (
      <div className="grid gap-8">
        <PageHeader title={t("dash.welcome", { name: ctx.user.name })} />
        <Section title={t("dash.goTo")} description={t("dash.goToSub", { business: ctx.tenant.name })}>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {links.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-lg border bg-card p-4 font-medium hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
        {tasksBlock}
      </div>
    );
  }

  const cash = (accounts ?? [])
    .filter((a) => a.currency === f.currency)
    .reduce((sum, a) => sum + a.balanceMinor, 0n);
  const spend3 = (spend ?? []).reduce((sum, m) => sum + m.expenseMinor, 0n);
  const avgSpend = spend3 / 3n;
  const runway = avgSpend > 0n ? Number((cash * 10n) / avgSpend) / 10 : null;
  const doneStatuses = new Set(ctx.tenant.settings.projectStatuses.filter((s) => s.done).map((s) => s.key));
  const activeProjects = projects?.filter((p) => !doneStatuses.has(p.status)).length;

  // Every month in the window, even ones without transactions.
  const months = Array.from({ length: TREND_MONTHS }, (_, i) =>
    monthStart(addMonths(trendFrom, i)).slice(0, 7),
  );
  const series = months.map((m) => {
    const row = trend?.find((r) => r.month === m);
    return { month: m, income: row?.incomeMinor ?? 0n, expense: row?.expenseMinor ?? 0n };
  });
  const max = series.reduce((acc, s) => (s.income > acc ? s.income : s.expense > acc ? s.expense : acc), 0n);
  const pct = (v: bigint) => (max > 0n && v > 0n ? Math.max(2, Number((v * 1000n) / max) / 10) : 0);

  return (
    <div className="grid gap-8">
      <PageHeader title={t("dash.title")} description={t("dash.sub")} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {canFinance ? (
          <>
            <StatCard
              label={t("dash.cash")}
              value={f.money(cash)}
              hint={t("dash.cashHint")}
              tone={cash < 0n ? "negative" : "default"}
            />
            <StatCard
              label={t("dash.profitMonth")}
              value={f.money(month?.profitMinor ?? 0n)}
              hint={t("dash.profitHint")}
              tone={(month?.profitMinor ?? 0n) < 0n ? "negative" : "positive"}
            />
            <StatCard
              label={t("dash.profitFy")}
              value={f.money(fy?.profitMinor ?? 0n)}
              hint={t("dash.profitHint")}
              tone={(fy?.profitMinor ?? 0n) < 0n ? "negative" : "positive"}
            />
            <StatCard
              label={t("dash.runway")}
              value={
                runway === null
                  ? t("dash.runwayNone")
                  : t("dash.runwayValue", { months: runway.toLocaleString(f.locale) })
              }
              hint={t("dash.runwayHint")}
              tone={runway !== null && runway < 3 ? "negative" : "default"}
            />
          </>
        ) : null}
        {canInvoices ? (
          <>
            <StatCard
              label={t("dash.receivable")}
              value={f.money(owed?.totalMinor ?? 0n)}
              hint={t("dash.overdue", { amount: f.money(owed?.overdueMinor ?? 0n) })}
              tone={(owed?.overdueMinor ?? 0n) > 0n ? "negative" : "default"}
            />
            <StatCard label={t("dash.mrr")} value={f.money(mrr ?? 0n)} hint={t("dash.mrrHint")} />
          </>
        ) : null}
        {pipeline ? (
          <StatCard
            label={t("dash.pipeline")}
            value={f.money(pipeline.valueMinor)}
            hint={t("dash.pipelineHint", { count: pipeline.count })}
          />
        ) : null}
        {activeProjects !== undefined ? (
          <StatCard
            label={t("dash.activeProjects")}
            value={String(activeProjects)}
            hint={t("dash.activeProjectsHint")}
          />
        ) : null}
      </div>

      {canFinance ? (
        <Section title={t("dash.trend")}>
          {max === 0n ? (
            <EmptyState title={t("dash.trendNone")} />
          ) : (
            <figure className="grid gap-3 rounded-lg border bg-card p-4">
              <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden="true">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-primary" />
                  {t("dash.income")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-muted-foreground/40" />
                  {t("dash.expense")}
                </span>
              </div>
              <div className="grid h-44 grid-cols-6 items-end gap-2 sm:gap-4" aria-hidden="true">
                {series.map((s) => (
                  <div key={s.month} className="grid h-full grid-rows-[1fr_auto] gap-1">
                    <div className="flex h-full items-end justify-center gap-0.5 sm:gap-1">
                      <div
                        className="w-full max-w-6 rounded-t-sm bg-primary"
                        style={{ height: `${pct(s.income)}%` }}
                        title={`${t("dash.income")}: ${f.money(s.income)}`}
                      />
                      <div
                        className="w-full max-w-6 rounded-t-sm bg-muted-foreground/40"
                        style={{ height: `${pct(s.expense)}%` }}
                        title={`${t("dash.expense")}: ${f.money(s.expense)}`}
                      />
                    </div>
                    <span className="truncate text-center text-[11px] text-muted-foreground">
                      {formatMonth(`${s.month}-01`, f.locale)}
                    </span>
                  </div>
                ))}
              </div>
              <figcaption className="sr-only">
                <table>
                  <caption>{t("dash.trend")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("dash.month")}</th>
                      <th scope="col">{t("dash.income")}</th>
                      <th scope="col">{t("dash.expense")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {series.map((s) => (
                      <tr key={s.month}>
                        <th scope="row">{formatMonth(`${s.month}-01`, f.locale)}</th>
                        <td>{f.money(s.income)}</td>
                        <td>{f.money(s.expense)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </figcaption>
            </figure>
          )}
        </Section>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        {tasksBlock}
        {canInvoices ? (
          <Section
            title={t("dash.overdueInvoices")}
            actions={
              <ButtonLink href={tenantHref(tenant, "invoices?status=overdue")} variant="ghost" size="sm">
                {t("dash.viewAll")}
              </ButtonLink>
            }
          >
            {!overdue || overdue.length === 0 ? (
              <EmptyState title={t("dash.noOverdue")} />
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {overdue.slice(0, 8).map(({ invoice, clientName }) => (
                  <li key={invoice.id}>
                    <Link
                      href={tenantHref(tenant, `invoices/${invoice.id}`)}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <span className="grid min-w-0">
                        <span className="truncate font-medium">
                          {invoice.number} · {clientName}
                        </span>
                        <span className="text-xs text-destructive">
                          {t("dash.daysOverdue", { days: daysBetween(invoice.dueDate, now) })}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {f.money(invoice.totalMinor - invoice.paidMinor, invoice.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}
      </div>
    </div>
  );
}
