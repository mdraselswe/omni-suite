import Link from "next/link";
import { FilterBar, FilterSearch, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { NoResults } from "@/components/data/no-results";
import { Pagination } from "@/components/data/pagination";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionButton } from "@/components/form/action-button";
import { CheckboxField, SelectField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { LineItemsEditor } from "@/components/form/line-items-editor";
import { EmptyState, Section, StatCard } from "@/components/layout/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  activeRecurringCount,
  createRecurringAction,
  deleteRecurringAction,
  monthlyRecurring,
  pageRecurring,
  toggleRecurringAction,
  updateRecurringAction,
} from "@/features/invoices";
import { t } from "@/i18n";
import { addDays, today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { computeTotals, type LineItem } from "@/lib/line-items";
import { keepSize, parsePage } from "@/lib/pagination";
import { normaliseSearch } from "@/lib/search";
import type { TenantSettings } from "@/lib/tenant-settings";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { clientOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

export default async function RecurringInvoicesPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/invoices/recurring">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "invoices.read");
  const f = formatters(ctx);
  const settings = ctx.tenant.settings;
  const canWrite = hasPermission(ctx, "invoices.write");
  const q = normaliseSearch(param(sp, "q"));
  const page = parsePage(sp);
  const path = tenantHref(tenant, "invoices/recurring");
  const database = db();
  const [found, active, mrr, clients] = await Promise.all([
    pageRecurring(database, ctx.tenant.id, { q }, page),
    activeRecurringCount(database, ctx.tenant.id),
    monthlyRecurring(database, ctx),
    canWrite ? clientOptions(database, ctx.tenant.id) : Promise.resolve([]),
  ]);
  const rows = found.rows;

  return (
    <div className="grid gap-8">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label={t("dash.mrr")} value={f.money(mrr)} hint={t("dash.mrrHint")} />
        <StatCard
          label={t("invoices.activeSchedules")}
          value={new Intl.NumberFormat(f.locale).format(active)}
        />
      </div>

      <Section
        title={t("invoices.recurring")}
        description={t("invoices.recurringSub")}
        actions={
          canWrite ? (
            <FormDialog
              trigger={t("invoices.newRecurring")}
              title={t("invoices.newRecurring")}
              action={createRecurringAction.bind(null, tenant)}
              wide
            >
              <ScheduleFields clients={clients} settings={settings} />
            </FormDialog>
          ) : null
        }
      >
        <FilterBar keep={keepSize(page)}>
          <FilterSearch value={q} />
        </FilterBar>
        {rows.length === 0 ? (
          q ? (
            <NoResults q={q} path={path} searchParams={sp} />
          ) : (
            <EmptyState title={t("invoices.noRecurring")} />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("invoices.scheduleName")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("team.client")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("invoices.interval")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("invoices.nextRun")}</TableHead>
                <TableHead className="text-right">{t("items.total")}</TableHead>
                {canWrite ? <TableHead className="w-0" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ r, clientName }) => {
                const total = computeTotals(r.items, settings.tax.pricesIncludeTax).totalMinor;
                return (
                  <TableRow key={r.id} className={r.active ? undefined : "text-muted-foreground"}>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{r.name}</span>
                        <StatusBadge
                          status={r.active ? "active" : "draft"}
                          label={r.active ? t("invoices.scheduleActive") : t("invoices.schedulePaused")}
                        />
                        {r.autoSend ? <span className="text-xs">· {t("invoices.autoSend")}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Link
                        href={tenantHref(tenant, `clients/${r.clientId}`)}
                        className="underline-offset-4 hover:underline"
                      >
                        {clientName}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {t("invoices.everyMonths", { count: String(r.intervalMonths) })}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap sm:table-cell">
                      {f.date(r.nextRunDate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{f.money(total, r.currency)}</TableCell>
                    {canWrite ? (
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <FormDialog
                            trigger={t("form.edit")}
                            title={r.name}
                            action={updateRecurringAction.bind(null, tenant)}
                            variant="ghost"
                            icon={false}
                            wide
                          >
                            <input type="hidden" name="id" value={r.id} />
                            <ScheduleFields clients={clients} settings={settings} schedule={r} />
                          </FormDialog>
                          <ActionButton
                            action={toggleRecurringAction.bind(null, tenant)}
                            values={{ id: r.id, active: r.active ? "false" : "true" }}
                            variant="ghost"
                          >
                            {r.active ? t("invoices.pause") : t("invoices.resume")}
                          </ActionButton>
                          <ActionButton
                            action={deleteRecurringAction.bind(null, tenant)}
                            values={{ id: r.id }}
                            confirm={t("invoices.recurringDeleteConfirm")}
                            variant="ghost"
                          >
                            {t("form.delete")}
                          </ActionButton>
                        </div>
                      </TableCell>
                    ) : null}
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

/** Fields of a recurring schedule, empty for a new one or filled from `schedule`. */
function ScheduleFields({
  clients,
  settings,
  schedule,
}: {
  clients: { value: string; label: string }[];
  settings: TenantSettings;
  schedule?: {
    clientId: string;
    name: string;
    intervalMonths: number;
    nextRunDate: string;
    items: LineItem[];
    autoSend: boolean;
  };
}) {
  return (
    <>
      <SelectField
        name="clientId"
        label={t("team.client")}
        options={clients}
        placeholder={t("form.choose")}
        defaultValue={schedule?.clientId}
        required
      />
      <TextField name="name" label={t("invoices.scheduleName")} defaultValue={schedule?.name} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="intervalMonths"
          label={t("invoices.interval")}
          type="number"
          min={1}
          max={36}
          defaultValue={String(schedule?.intervalMonths ?? 1)}
          required
        />
        <TextField
          name="nextRunDate"
          label={t("invoices.nextRun")}
          type="date"
          defaultValue={schedule?.nextRunDate ?? addDays(today(settings.timezone), 1)}
          required
        />
      </div>
      <LineItemsEditor
        initial={schedule?.items}
        currency={settings.currency}
        locale={settings.locale}
        defaultTaxBp={settings.tax.rateBp}
        pricesIncludeTax={settings.tax.pricesIncludeTax}
        taxName={settings.tax.name}
      />
      <CheckboxField name="autoSend" label={t("invoices.autoSend")} defaultChecked={schedule?.autoSend} />
    </>
  );
}
