import Link from "next/link";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionButton } from "@/components/form/action-button";
import { CheckboxField, SelectField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { LineItemsEditor } from "@/components/form/line-items-editor";
import { EmptyState, Section, StatCard } from "@/components/layout/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createRecurringAction,
  listRecurring,
  monthlyRecurring,
  toggleRecurringAction,
} from "@/features/invoices";
import { t } from "@/i18n";
import { addDays, today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { computeTotals } from "@/lib/line-items";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { clientOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

export default async function RecurringInvoicesPage({ params }: PageProps<"/[tenant]/invoices/recurring">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "invoices.read");
  const f = formatters(ctx);
  const settings = ctx.tenant.settings;
  const canWrite = hasPermission(ctx, "invoices.write");
  const database = db();
  const [rows, mrr, clients] = await Promise.all([
    listRecurring(database, ctx.tenant.id),
    monthlyRecurring(database, ctx),
    canWrite ? clientOptions(database, ctx.tenant.id) : Promise.resolve([]),
  ]);
  const active = rows.filter((r) => r.r.active).length;

  return (
    <div className="grid gap-8">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label={t("dash.mrr")} value={f.money(mrr)} hint={t("dash.mrrHint")} />
        <StatCard label={t("invoices.activeSchedules")} value={String(active)} />
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
              <SelectField
                name="clientId"
                label={t("team.client")}
                options={clients}
                placeholder={t("form.choose")}
                required
              />
              <TextField name="name" label={t("invoices.scheduleName")} required />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  name="intervalMonths"
                  label={t("invoices.interval")}
                  type="number"
                  min={1}
                  max={36}
                  defaultValue="1"
                  required
                />
                <TextField
                  name="nextRunDate"
                  label={t("invoices.nextRun")}
                  type="date"
                  defaultValue={addDays(today(settings.timezone), 1)}
                  required
                />
              </div>
              <LineItemsEditor
                currency={settings.currency}
                locale={settings.locale}
                defaultTaxBp={settings.tax.rateBp}
                pricesIncludeTax={settings.tax.pricesIncludeTax}
                taxName={settings.tax.name}
              />
              <CheckboxField name="autoSend" label={t("invoices.autoSend")} />
            </FormDialog>
          ) : null
        }
      >
        {rows.length === 0 ? (
          <EmptyState title={t("invoices.noRecurring")} />
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
                        <ActionButton
                          action={toggleRecurringAction.bind(null, tenant)}
                          values={{ id: r.id, active: r.active ? "false" : "true" }}
                          variant="ghost"
                        >
                          {r.active ? t("invoices.pause") : t("invoices.resume")}
                        </ActionButton>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
