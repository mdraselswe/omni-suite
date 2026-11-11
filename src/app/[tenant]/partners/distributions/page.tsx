import { FilterBar, FilterDate, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionButton } from "@/components/form/action-button";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { CheckboxField } from "@/components/form/field";
import { EmptyState, Section, StatCard } from "@/components/layout/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  computeDistribution,
  deleteDistributionAction,
  finaliseDistributionAction,
  listDistributions,
  listPartners,
  listRules,
  ruleFor,
  saveDistributionAction,
} from "@/features/partners";
import { t } from "@/i18n";
import { addDays, isIsoDate, monthStart, today } from "@/lib/dates";
import { requireTenantPermission } from "@/server/auth/session";
import { UserError } from "@/server/action";
import { db } from "@/server/db";
import { hasPermission } from "@/server/tenancy/context";

export default async function DistributionsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/partners/distributions">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "partners.read");
  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const lastMonthEnd = addDays(monthStart(now), -1);
  const start = isIsoDate(param(sp, "start")) ? param(sp, "start") : monthStart(lastMonthEnd);
  const end = isIsoDate(param(sp, "end")) ? param(sp, "end") : lastMonthEnd;
  const canRun = hasPermission(ctx, "distributions.run", "all");
  const [runs, partners, rules] = await Promise.all([
    listDistributions(db(), ctx.tenant.id),
    listPartners(db(), ctx.tenant.id, now),
    listRules(db(), ctx.tenant.id),
  ]);
  const rule = ruleFor(rules, start);
  const manual = rule?.config.method.type === "weighted" && rule.config.method.laborSource === "manual";
  const manualLabor = Object.fromEntries(
    partners.flatMap((p) => {
      const v = param(sp, `labor_${p.id}`);
      return /^\d+$/.test(v) ? [[p.id, BigInt(v)]] : [];
    }),
  );

  let preview: Awaited<ReturnType<typeof computeDistribution>> | null = null;
  let error = "";
  try {
    preview = await computeDistribution(db(), ctx.tenant.id, { start, end, manualLabor });
  } catch (e) {
    if (e instanceof UserError) error = e.message;
    else throw e;
  }

  return (
    <div className="grid gap-10">
      <Section title={t("dist.new")} description={t("dist.sub")}>
        <FilterBar>
          <FilterDate name="start" label={t("dist.periodStart")} value={start} />
          <FilterDate name="end" label={t("dist.periodEnd")} value={end} />
          {manual
            ? partners.map((p) => (
                <label key={p.id} className="grid gap-1 text-xs text-muted-foreground">
                  {t("dist.manualLabor", { name: p.name })}
                  <input
                    name={`labor_${p.id}`}
                    inputMode="numeric"
                    defaultValue={manualLabor[p.id]?.toString() ?? ""}
                    className="h-9 w-28 rounded-md border bg-transparent px-2 text-sm"
                  />
                </label>
              ))
            : null}
        </FilterBar>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {preview ? (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label={t("dist.profit")}
                value={f.money(preview.total.profitMinor)}
                tone={preview.total.profitMinor < 0n ? "negative" : "positive"}
              />
              <StatCard label={t("dist.reserve")} value={f.money(preview.total.reserveMinor)} />
              <StatCard label={t("dist.fees")} value={f.money(preview.total.feesMinor)} />
              <StatCard label={t("dist.distributable")} value={f.money(preview.total.distributableMinor)} />
            </div>
            {preview.segments.length > 1 ? (
              <p className="text-sm text-muted-foreground">
                {t("dist.segments", { count: preview.segments.length })}
              </p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("partners.name")}</TableHead>
                  <TableHead className="text-right">{t("dist.fee")}</TableHead>
                  <TableHead className="text-right">{t("dist.shareCol")}</TableHead>
                  <TableHead className="text-right">{t("dist.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.total.lines.map((l) => (
                  <TableRow key={l.partnerId}>
                    <TableCell>{preview.partnerNames[l.partnerId]}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.money(l.feeMinor)}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.money(l.shareMinor)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {f.money(l.totalMinor)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {canRun ? (
              <ActionForm
                action={saveDistributionAction.bind(null, tenant)}
                className="flex flex-wrap items-center gap-4"
              >
                <input type="hidden" name="start" value={start} />
                <input type="hidden" name="end" value={end} />
                {Object.entries(manualLabor).map(([id, v]) => (
                  <input key={id} type="hidden" name={`labor_${id}`} value={v.toString()} />
                ))}
                <CheckboxField name="final" label={t("dist.finalise")} />
                <SubmitButton pendingLabel={t("form.saving")}>{t("form.save")}</SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section title={t("dist.title")}>
        {runs.length === 0 ? (
          <EmptyState title={t("dist.none")} />
        ) : (
          <ul className="grid gap-3">
            {runs.map((run) => (
              <li key={run.id} className="grid gap-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {f.date(run.periodStart)} – {f.date(run.periodEnd)}
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge
                      status={run.status}
                      label={run.status === "final" ? t("dist.finalised") : t("dist.draft")}
                    />
                    {canRun && run.status === "draft" ? (
                      <>
                        <ActionButton
                          action={finaliseDistributionAction.bind(null, tenant)}
                          values={{ id: run.id }}
                          confirm={t("form.confirm")}
                          variant="default"
                        >
                          {t("dist.finalise")}
                        </ActionButton>
                        <ActionButton
                          action={deleteDistributionAction.bind(null, tenant)}
                          values={{ id: run.id }}
                          confirm={t("form.confirm")}
                        >
                          {t("dist.delete")}
                        </ActionButton>
                      </>
                    ) : null}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("dist.profit")} {f.money(run.result.profitMinor)} · {t("dist.distributable")}{" "}
                  {f.money(run.result.distributableMinor)}
                </p>
                <p className="text-sm">
                  {run.result.lines
                    .map((l) => `${run.result.partnerNames[l.partnerId] ?? "?"}: ${f.money(l.totalMinor)}`)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
