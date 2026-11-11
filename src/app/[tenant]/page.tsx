import {
  AlertCircle,
  FolderKanban,
  Hourglass,
  ListTodo,
  Sparkles,
  PiggyBank,
  Receipt,
  Repeat,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AreaChart } from "@/components/data/area-chart";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { EmptyState, PageHeader, Panel, StatCard } from "@/components/layout/page";
import { ButtonLink } from "@/components/ui/button-link";
import { Progress } from "@/components/ui/progress";
import { BusinessInsights, canUseAi } from "@/features/ai";
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
import { cn } from "@/lib/utils";
import { requireTenant } from "@/server/auth/session";
import { db } from "@/server/db";
import { hasPermission, isModuleEnabled } from "@/server/tenancy/context";
import { navFor } from "@/server/tenancy/nav";

const RANGES = [6, 12] as const;

/** Runs `fn` only when allowed; otherwise resolves to null (keeps Promise.all flat). */
function when<T>(allowed: boolean, fn: () => Promise<T>): Promise<T | null> {
  return allowed ? fn() : Promise.resolve(null);
}

const rowLink =
  "-mx-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-3 text-sm outline-none hover:bg-accent focus-visible:bg-accent";

export default async function DashboardPage({ params, searchParams }: PageProps<"/[tenant]">) {
  const { tenant } = await params;
  const ctx = await requireTenant(tenant);
  if (ctx.membership.kind === "client") redirect(tenantHref(tenant, "portal"));
  const range = (await searchParams).range === "12" ? 12 : 6;

  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const database = db();
  const canDash = hasPermission(ctx, "dashboard.read");
  const canFinance = canDash && hasPermission(ctx, "finance.read");
  const canInvoices = canDash && hasPermission(ctx, "invoices.read");
  const canPipeline = canDash && isModuleEnabled(ctx, "crm") && hasPermission(ctx, "leads.read");
  const projectScope = isModuleEnabled(ctx, "projects") ? ctx.permissions.get("projects.read") : undefined;
  const hasTasks = isModuleEnabled(ctx, "projects");

  const trendFrom = monthStart(addMonths(now, -(range - 1)));
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

  const firstName = ctx.user.name.split(/\s+/)[0] ?? ctx.user.name;

  const tasksPanel = hasTasks ? (
    <Panel title={t("dash.dueTasks")}>
      {!tasks || tasks.length === 0 ? (
        <EmptyState title={t("dash.noTasks")} icon={ListTodo} bare />
      ) : (
        <ul className="divide-y">
          {tasks.map(({ task, projectName }) => (
            <li key={task.id}>
              <Link href={tenantHref(tenant, `projects/${task.projectId}`)} className={rowLink}>
                <span className="grid min-w-0">
                  <span className="truncate font-medium">{task.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{projectName}</span>
                </span>
                {task.dueDate ? (
                  <span
                    className={cn(
                      "text-xs",
                      task.dueDate < now ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {t("dash.dueOn", { date: f.date(task.dueDate) })}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  ) : null;

  if (!canDash) {
    const links = navFor(ctx).filter((item) => item.href !== tenantHref(tenant));
    return (
      <div className="grid gap-6">
        <PageHeader
          title={t("dash.welcome", { name: ctx.user.name })}
          description={t("dash.goToSub", { business: ctx.tenant.name })}
        />
        <ul className="grid stagger gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex hover-lift items-center justify-between gap-3 surface p-5 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {item.label}
                <span className="text-xs font-normal text-muted-foreground">{item.group}</span>
              </Link>
            </li>
          ))}
        </ul>
        {tasksPanel}
      </div>
    );
  }

  const cash = (accounts ?? [])
    .filter((a) => a.currency === f.currency)
    .reduce((sum, a) => sum + a.balanceMinor, 0n);
  const spend3 = (spend ?? []).reduce((sum, m) => sum + m.expenseMinor, 0n);
  const avgSpend = spend3 / 3n;
  const runway = avgSpend > 0n ? Number((cash * 10n) / avgSpend) / 10 : null;
  const statuses = ctx.tenant.settings.projectStatuses;
  const doneStatuses = new Set(statuses.filter((s) => s.done).map((s) => s.key));
  const openProjects = (projects ?? []).filter((p) => !doneStatuses.has(p.status));

  // Every month in the window, even ones without transactions.
  const months = Array.from({ length: range }, (_, i) => monthStart(addMonths(trendFrom, i)).slice(0, 7));
  const series = months.map((m) => {
    const row = trend?.find((r) => r.month === m);
    return { month: m, income: row?.incomeMinor ?? 0n, expense: row?.expenseMinor ?? 0n };
  });
  const totalIncome = series.reduce((sum, s) => sum + s.income, 0n);
  const totalSpend = series.reduce((sum, s) => sum + s.expense, 0n);
  const hasTrend = totalIncome > 0n || totalSpend > 0n;
  const major = (v: bigint) => Number(v) / 100;

  const highlights = [
    canFinance ? (
      <StatCard
        key="cash"
        gradient={1}
        icon={Wallet}
        label={t("dash.cash")}
        value={f.money(cash)}
        hint={t("dash.cashHint")}
      />
    ) : null,
    canFinance ? (
      <StatCard
        key="month"
        gradient={2}
        icon={TrendingUp}
        label={t("dash.profitMonth")}
        value={f.money(month?.profitMinor ?? 0n)}
        hint={t("dash.profitHint")}
      />
    ) : null,
    canInvoices ? (
      <StatCard
        key="owed"
        gradient={3}
        icon={Receipt}
        label={t("dash.receivable")}
        value={f.money(owed?.totalMinor ?? 0n)}
        hint={t("dash.overdue", { amount: f.money(owed?.overdueMinor ?? 0n) })}
      />
    ) : null,
    pipeline ? (
      <StatCard
        key="pipeline"
        gradient={4}
        icon={Target}
        label={t("dash.pipeline")}
        value={f.money(pipeline.valueMinor)}
        hint={t("dash.pipelineHint", { count: pipeline.count })}
      />
    ) : null,
  ].filter(Boolean);

  return (
    <div className="grid gap-6">
      <PageHeader title={t("dash.greeting", { name: firstName })} description={t("dash.sub")} />

      <div className={cn("grid gap-6", canFinance && "lg:grid-cols-3")}>
        {canFinance ? (
          <Panel
            className="animate-rise lg:col-span-2"
            title={t("dash.overview")}
            description={t("dash.overviewSub", { months: range })}
            actions={
              <nav aria-label={t("dash.range")} className="flex rounded-lg bg-muted p-1 text-xs">
                {RANGES.map((value) => (
                  <Link
                    key={value}
                    href={`${tenantHref(tenant)}${value === 6 ? "" : "?range=12"}` as Route}
                    aria-current={range === value ? "page" : undefined}
                    scroll={false}
                    className={cn(
                      "rounded-md px-3 py-1.5 font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                      range === value &&
                        "bg-primary text-primary-foreground shadow-sm hover:text-primary-foreground",
                    )}
                  >
                    {t(value === 6 ? "dash.range6" : "dash.range12")}
                  </Link>
                ))}
              </nav>
            }
          >
            <dl className="mb-4 flex flex-wrap gap-x-10 gap-y-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t("dash.income")}</dt>
                <dd className="font-heading text-2xl font-medium tabular-nums">{f.money(totalIncome)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("dash.expense")}</dt>
                <dd className="font-heading text-2xl font-medium tabular-nums">{f.money(totalSpend)}</dd>
              </div>
            </dl>
            {hasTrend ? (
              <AreaChart
                id="dash-trend"
                caption={t("dash.overview")}
                labels={series.map((s) => formatMonth(`${s.month}-01`, f.locale, false))}
                tableLabels={series.map((s) => formatMonth(`${s.month}-01`, f.locale))}
                series={[
                  {
                    name: t("dash.income"),
                    color: 1,
                    values: series.map((s) => major(s.income)),
                    formatted: series.map((s) => f.money(s.income)),
                  },
                  {
                    name: t("dash.expense"),
                    color: 2,
                    values: series.map((s) => major(s.expense)),
                    formatted: series.map((s) => f.money(s.expense)),
                  },
                ]}
              />
            ) : (
              <EmptyState title={t("dash.trendNone")} icon={TrendingUp} bare />
            )}
          </Panel>
        ) : null}

        {highlights.length > 0 ? (
          <div
            className={cn(
              "grid stagger content-start gap-4 sm:grid-cols-2",
              canFinance ? "lg:grid-cols-1" : "xl:grid-cols-4",
            )}
          >
            {highlights}
          </div>
        ) : null}
      </div>

      <div className="grid stagger gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canFinance ? (
          <>
            <StatCard
              icon={PiggyBank}
              label={t("dash.profitFy")}
              value={f.money(fy?.profitMinor ?? 0n)}
              hint={t("dash.profitHint")}
              tone={(fy?.profitMinor ?? 0n) < 0n ? "negative" : "positive"}
            />
            <StatCard
              icon={Hourglass}
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
          <StatCard icon={Repeat} label={t("dash.mrr")} value={f.money(mrr ?? 0n)} hint={t("dash.mrrHint")} />
        ) : null}
        {projects ? (
          <StatCard
            icon={FolderKanban}
            label={t("dash.activeProjects")}
            value={String(openProjects.length)}
            hint={t("dash.activeProjectsHint")}
          />
        ) : null}
      </div>

      {canUseAi(ctx) ? (
        <Panel
          title={t("ai.insights.title")}
          description={t("ai.insights.sub")}
          actions={<Sparkles aria-hidden="true" className="size-5 text-primary" />}
        >
          <BusinessInsights tenant={tenant} />
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {projects ? (
          <Panel
            title={t("dash.projects")}
            actions={
              <ButtonLink href={tenantHref(tenant, "projects")} variant="ghost" size="sm">
                {t("dash.viewAll")}
              </ButtonLink>
            }
          >
            {openProjects.length === 0 ? (
              <EmptyState title={t("dash.noProjects")} icon={FolderKanban} bare />
            ) : (
              <ul className="grid gap-5">
                {openProjects.slice(0, 5).map((p) => {
                  const percent = p.taskCount > 0 ? (p.doneCount / p.taskCount) * 100 : 0;
                  return (
                    <li key={p.id} className="grid gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={tenantHref(tenant, `projects/${p.id}`)}
                          className="grid min-w-0 rounded-sm text-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="truncate font-medium">{p.name}</span>
                          {p.clientName ? (
                            <span className="truncate text-xs text-muted-foreground">{p.clientName}</span>
                          ) : null}
                        </Link>
                        <StatusBadge
                          status={p.status}
                          label={statuses.find((s) => s.key === p.status)?.label ?? p.status}
                        />
                      </div>
                      <Progress
                        value={percent}
                        label={t("dash.progress", { name: p.name, percent: Math.round(percent) })}
                      />
                      <p className="text-xs text-muted-foreground">
                        {p.taskCount > 0
                          ? t("dash.tasksDone", { done: p.doneCount, total: p.taskCount })
                          : t("dash.noTasksYet")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        ) : null}

        {tasksPanel}

        {canInvoices ? (
          <Panel
            title={t("dash.overdueInvoices")}
            actions={
              <ButtonLink href={tenantHref(tenant, "invoices?status=overdue")} variant="ghost" size="sm">
                {t("dash.viewAll")}
              </ButtonLink>
            }
          >
            {!overdue || overdue.length === 0 ? (
              <EmptyState title={t("dash.noOverdue")} icon={AlertCircle} bare />
            ) : (
              <ul className="divide-y">
                {overdue.slice(0, 6).map(({ invoice, clientName }) => (
                  <li key={invoice.id}>
                    <Link href={tenantHref(tenant, `invoices/${invoice.id}`)} className={rowLink}>
                      <span className="grid min-w-0">
                        <span className="truncate font-medium">
                          {invoice.number} · {clientName}
                        </span>
                        <span className="text-xs text-destructive">
                          {t("dash.daysOverdue", { days: daysBetween(invoice.dueDate, now) })}
                        </span>
                      </span>
                      <span className="font-medium tabular-nums">
                        {f.money(invoice.totalMinor - invoice.paidMinor, invoice.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
