import { FilterBar, FilterDate, FilterSearch, FilterSelect, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { NoResults } from "@/components/data/no-results";
import { Pagination } from "@/components/data/pagination";
import { ActionButton } from "@/components/form/action-button";
import { CheckboxField, SelectField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteTimeAction, listRates, logTimeAction, pageTime, setRateAction } from "@/features/projects";
import { t } from "@/i18n";
import { isIsoDate, monthStart, today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { toDecimalString } from "@/lib/money";
import { keepSize, parsePage } from "@/lib/pagination";
import { normaliseSearch } from "@/lib/search";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { memberOptions, projectOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

const UUID = /^[0-9a-f-]{36}$/;

export default async function TimePage({ params, searchParams }: PageProps<"/[tenant]/time">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx, scope } = await requireTenantPermission(tenant, "time.read");
  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const from = isIsoDate(param(sp, "from")) ? param(sp, "from") : monthStart(now);
  const to = isIsoDate(param(sp, "to")) ? param(sp, "to") : now;
  const projectId = UUID.test(param(sp, "project")) ? param(sp, "project") : undefined;
  const membershipId = scope === "all" && UUID.test(param(sp, "member")) ? param(sp, "member") : undefined;
  const q = normaliseSearch(param(sp, "q"));
  const page = parsePage(sp);
  const path = tenantHref(tenant, "time");
  const writeScope = ctx.permissions.get("time.write");
  const canRates = hasPermission(ctx, "members.manage", "all");
  const database = db();
  const currency = ctx.tenant.settings.currency;

  const [found, projects, members, rates] = await Promise.all([
    pageTime(database, ctx, scope, { from, to, projectId, membershipId, q }, page),
    projectOptions(database, ctx.tenant.id),
    memberOptions(database, ctx.tenant.id),
    canRates ? listRates(database, ctx.tenant.id) : Promise.resolve([]),
  ]);
  const entries = found.rows;
  // Totals cover every entry the filters match, not just this page.
  const { minutes: total, billable, unbilled } = found.totals;

  return (
    <div className="grid gap-8">
      <PageHeader
        title={t("time.title")}
        description={t("time.sub")}
        actions={
          writeScope ? (
            <FormDialog
              trigger={t("time.log")}
              title={t("time.log")}
              action={logTimeAction.bind(null, tenant)}
            >
              <SelectField name="projectId" label={t("time.project")} options={projects} required />
              {writeScope === "all" ? (
                <SelectField
                  name="membershipId"
                  label={t("time.member")}
                  options={members}
                  defaultValue={ctx.membership.id}
                />
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField name="date" label={t("form.date.label")} type="date" defaultValue={now} required />
                <TextField
                  name="duration"
                  label={t("time.duration")}
                  hint={t("time.durationHint")}
                  required
                />
              </div>
              <TextField name="note" label={t("time.note")} />
              <CheckboxField name="billable" label={t("time.billable")} defaultChecked />
            </FormDialog>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={t("time.total")}
          value={f.minutes(total)}
          hint={t("time.entries", { count: new Intl.NumberFormat(f.locale).format(found.total) })}
        />
        <StatCard label={t("time.billableTotal")} value={f.minutes(billable)} />
        <StatCard label={t("time.unbilled")} value={f.minutes(unbilled)} />
      </div>

      <Section title={t("time.title")}>
        <FilterBar keep={keepSize(page)}>
          <FilterDate name="from" label={t("finance.from")} value={from} />
          <FilterDate name="to" label={t("finance.to")} value={to} />
          <FilterSelect name="project" label={t("time.project")} value={projectId} options={projects} />
          {scope === "all" ? (
            <FilterSelect name="member" label={t("time.member")} value={membershipId} options={members} />
          ) : null}
          <FilterSearch value={q} />
        </FilterBar>
        {entries.length === 0 ? (
          q ? (
            <NoResults q={q} path={path} searchParams={sp} />
          ) : (
            <EmptyState title={t("time.none")} />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("form.date.label")}</TableHead>
                <TableHead>{t("time.project")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("time.member")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("time.note")}</TableHead>
                <TableHead className="text-right">{t("time.duration")}</TableHead>
                {writeScope ? <TableHead className="w-0" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(({ entry, projectName, memberName }) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">{f.date(entry.date)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{projectName}</span>
                      {entry.billable ? <Badge variant="outline">{t("time.billable")}</Badge> : null}
                      {entry.billable ? (
                        entry.invoiceId ? (
                          <Badge variant="secondary">{t("time.billed")}</Badge>
                        ) : (
                          <Badge variant="outline">{t("time.unbilled")}</Badge>
                        )
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{memberName}</TableCell>
                  <TableCell className="hidden md:table-cell">{entry.note}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.minutes(entry.minutes)}</TableCell>
                  {writeScope ? (
                    <TableCell>
                      {!entry.invoiceId &&
                      (writeScope === "all" || entry.membershipId === ctx.membership.id) ? (
                        <ActionButton
                          action={deleteTimeAction.bind(null, tenant)}
                          values={{ id: entry.id }}
                          confirm={t("form.confirm")}
                          variant="ghost"
                        >
                          {t("time.delete")}
                        </ActionButton>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination path={path} searchParams={sp} request={page} paged={found} locale={f.locale} />
      </Section>

      {canRates ? (
        <Section title={t("time.rates")} description={t("time.ratesSub")}>
          {rates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("time.noRates")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("time.member")}</TableHead>
                  <TableHead className="text-right">{t("time.costRate")}</TableHead>
                  <TableHead className="text-right">{t("time.billRate")}</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((r) => (
                  <TableRow key={r.membershipId}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.cost ? f.money(r.cost) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.bill ? f.money(r.bill) : "—"}
                    </TableCell>
                    <TableCell>
                      <FormDialog
                        trigger={t("form.edit")}
                        title={r.name}
                        description={t("time.ratesSub")}
                        action={setRateAction.bind(null, tenant)}
                        variant="ghost"
                        size="sm"
                        icon={false}
                      >
                        <input type="hidden" name="membershipId" value={r.membershipId} />
                        <TextField
                          name="cost"
                          label={t("time.costRate")}
                          inputMode="decimal"
                          defaultValue={r.cost ? toDecimalString(r.cost, currency) : ""}
                        />
                        <TextField
                          name="bill"
                          label={t("time.billRate")}
                          inputMode="decimal"
                          defaultValue={r.bill ? toDecimalString(r.bill, currency) : ""}
                        />
                      </FormDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      ) : null}
    </div>
  );
}
