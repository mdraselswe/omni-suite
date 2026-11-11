import { FilterBar, FilterSearch, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { ActionButton } from "@/components/form/action-button";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { CustomFieldInputs } from "@/components/form/custom-field-inputs";
import { SelectField, TextAreaField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { PageHeader, StatCard } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button-link";
import { storedCustom } from "@/features/clients";
import {
  archivedLeadCount,
  archiveLeadAction,
  convertLeadAction,
  createLeadAction,
  leadStageTotals,
  listLeads,
  moveLeadAction,
  updateLeadAction,
} from "@/features/crm";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { toDecimalString } from "@/lib/money";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { memberOptions } from "@/server/options";
import { customFieldsFor } from "@/server/shared";
import { hasPermission } from "@/server/tenancy/context";
import Link from "next/link";

type Stage = { key: string; label: string; kind: "open" | "won" | "lost" };
type LeadRow = Awaited<ReturnType<typeof listLeads>>[number];
type Defs = Awaited<ReturnType<typeof customFieldsFor>>;
type Option = { value: string; label: string };

/** Board page size: the newest leads; "Show more" loads the next batch. */
const PAGE = 200;
/** Column key for leads whose stage was removed from the pipeline in settings. */
const OTHER = "__other";

function LeadFields({
  stages,
  members,
  defs,
  lead,
  currency,
}: {
  stages: readonly Stage[];
  members: readonly Option[];
  defs: Defs;
  lead?: LeadRow["lead"];
  currency: string;
}) {
  const known = lead ? stages.some((s) => s.key === lead.stage) : false;
  return (
    <>
      {lead ? <input type="hidden" name="id" value={lead.id} /> : null}
      <TextField name="name" label={t("form.name")} defaultValue={lead?.name} required />
      <TextField name="company" label={t("leads.company")} defaultValue={lead?.company} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="email" label={t("form.email.label")} type="email" defaultValue={lead?.email} />
        <TextField name="phone" label={t("form.phone")} type="tel" defaultValue={lead?.phone} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="stage"
          label={t("leads.stage")}
          options={stages.map((s) => ({ value: s.key, label: s.label }))}
          defaultValue={lead && known ? lead.stage : stages[0]?.key}
        />
        <TextField
          name="value"
          label={t("leads.value")}
          inputMode="decimal"
          defaultValue={lead && lead.valueMinor !== 0n ? toDecimalString(lead.valueMinor, currency) : ""}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="source" label={t("leads.source")} defaultValue={lead?.source} />
        <SelectField
          name="ownerMembershipId"
          label={t("leads.owner")}
          options={members}
          placeholder={t("form.none")}
          defaultValue={lead?.ownerMembershipId ?? ""}
        />
      </div>
      <CustomFieldInputs defs={defs} values={storedCustom(lead?.custom)} />
      <TextAreaField name="notes" label={t("form.notes")} defaultValue={lead?.notes} rows={3} />
    </>
  );
}

function LeadCard({
  row,
  tenant,
  stage,
  stages,
  members,
  defs,
  f,
  canWrite,
  canConvert,
}: {
  row: LeadRow;
  tenant: string;
  /** Undefined when the lead's stage is no longer in the pipeline. */
  stage: Stage | undefined;
  stages: readonly Stage[];
  members: readonly Option[];
  defs: Defs;
  f: ReturnType<typeof formatters>;
  canWrite: boolean;
  canConvert: boolean;
}) {
  const { lead, ownerName } = row;
  const archived = lead.archivedAt !== null;
  return (
    <article className="grid gap-2 surface p-3 text-sm">
      <div className="grid gap-0.5">
        <p className="font-medium">{lead.name}</p>
        {lead.company ? <p className="text-xs text-muted-foreground">{lead.company}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {archived ? <Badge variant="outline">{t("leads.archived")}</Badge> : null}
        {stage ? null : <Badge variant="outline">{t("leads.unknownStage", { stage: lead.stage })}</Badge>}
        {lead.valueMinor !== 0n ? (
          <Badge variant="secondary" className="tabular-nums">
            {f.money(lead.valueMinor)}
          </Badge>
        ) : null}
        {ownerName ? <span className="text-muted-foreground">{ownerName}</span> : null}
        {lead.source ? <span className="text-muted-foreground">· {lead.source}</span> : null}
      </div>
      {lead.clientId ? (
        <Link
          href={tenantHref(tenant, `clients/${lead.clientId}`)}
          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("leads.converted")}
        </Link>
      ) : null}
      {canWrite ? (
        <div className="flex flex-wrap items-end gap-2">
          <ActionForm
            action={moveLeadAction.bind(null, tenant)}
            keepValues
            className="flex flex-1 items-end gap-1.5"
          >
            <input type="hidden" name="id" value={lead.id} />
            <label className="sr-only" htmlFor={`stage-select-${lead.id}`}>
              {t("leads.stage")}
            </label>
            <select
              id={`stage-select-${lead.id}`}
              name="stage"
              defaultValue={stage ? lead.stage : (stages[0]?.key ?? "")}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-xs dark:bg-input/30"
            >
              {stages.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <SubmitButton variant="outline" size="sm">
              {t("leads.move")}
            </SubmitButton>
          </ActionForm>
          <FormDialog
            trigger={t("form.edit")}
            title={lead.name}
            action={updateLeadAction.bind(null, tenant)}
            variant="ghost"
            size="sm"
            icon={false}
            wide
          >
            <LeadFields stages={stages} members={members} defs={defs} lead={lead} currency={f.currency} />
          </FormDialog>
          {canConvert && !lead.clientId && !archived && stage?.kind !== "lost" ? (
            <ActionButton action={convertLeadAction.bind(null, tenant)} values={{ id: lead.id }}>
              {t("leads.convert")}
            </ActionButton>
          ) : null}
          <ActionButton
            action={archiveLeadAction.bind(null, tenant)}
            values={{ id: lead.id, archived: archived ? "false" : "true" }}
            variant="ghost"
            confirm={archived ? undefined : t("leads.archiveConfirm")}
          >
            {archived ? t("leads.unarchive") : t("leads.archive")}
          </ActionButton>
        </div>
      ) : null}
    </article>
  );
}

export default async function LeadsPage({ params, searchParams }: PageProps<"/[tenant]/leads">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx, scope } = await requireTenantPermission(tenant, "leads.read");
  const f = formatters(ctx);
  const canWrite = hasPermission(ctx, "leads.write");
  const canConvert = canWrite && hasPermission(ctx, "clients.write");
  const q = param(sp, "q").trim() || undefined;
  const showArchived = param(sp, "archived") === "1";
  const limit = Math.min(Number(param(sp, "limit")) || PAGE, 5000);
  const database = db();
  const stages = ctx.tenant.settings.pipelineStages;
  const filter = { q, archived: showArchived };
  const [rows, totals, archivedCount, members, defs] = await Promise.all([
    listLeads(database, ctx, scope, { ...filter, limit: limit + 1 }),
    leadStageTotals(database, ctx, scope, filter),
    archivedLeadCount(database, ctx, scope),
    memberOptions(database, ctx.tenant.id),
    customFieldsFor(database, ctx.tenant.id, "lead"),
  ]);
  const hasMore = rows.length > limit;
  // Loaded newest first; shown oldest first inside a column, like a queue.
  const visible = rows.slice(0, limit).reverse();

  // Counts and values come from the whole pipeline, not just the loaded page.
  const sum = (keys: readonly string[]) =>
    keys.reduce(
      (acc, k) => {
        const v = totals.get(k);
        return v ? { count: acc.count + v.count, valueMinor: acc.valueMinor + v.valueMinor } : acc;
      },
      { count: 0, valueMinor: 0n },
    );
  const stageOf = new Map(stages.map((s) => [s.key, s]));
  const open = sum(stages.filter((s) => s.kind === "open").map((s) => s.key));
  const won = sum(stages.filter((s) => s.kind === "won").map((s) => s.key));
  const all = sum([...totals.keys()]);
  const otherKeys = [...totals.keys()].filter((k) => !stageOf.has(k));
  const columns: { key: string; label: string; hint?: string; keys: string[] }[] = [
    ...stages.map((s) => ({ key: s.key, label: s.label, keys: [s.key] })),
    ...(otherKeys.length > 0
      ? [{ key: OTHER, label: t("leads.otherStage"), hint: t("leads.otherStageHint"), keys: otherKeys }]
      : []),
  ];

  const href = (extra: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, archived: showArchived ? "1" : undefined, ...extra }))
      if (v) next.set(k, v);
    const query = next.toString();
    return tenantHref(tenant, query ? `leads?${query}` : "leads");
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("leads.title")}
        description={t("leads.sub")}
        actions={
          canWrite ? (
            <FormDialog
              trigger={t("leads.new")}
              title={t("leads.new")}
              action={createLeadAction.bind(null, tenant)}
              wide
            >
              <LeadFields stages={stages} members={members} defs={defs} currency={f.currency} />
            </FormDialog>
          ) : null
        }
        className="mb-0"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={t("leads.openPipeline")}
          value={f.money(open.valueMinor)}
          hint={t("leads.openCount", { count: open.count })}
        />
        <StatCard label={t("leads.wonCount")} value={String(won.count)} />
        <StatCard label={t("leads.allCount")} value={String(all.count)} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <FilterBar>
          {showArchived ? <input type="hidden" name="archived" value="1" /> : null}
          <FilterSearch value={q} />
        </FilterBar>
        {showArchived ? (
          <ButtonLink href={href({ archived: undefined })} variant="ghost" size="sm">
            {t("leads.hideArchived")}
          </ButtonLink>
        ) : archivedCount > 0 ? (
          <ButtonLink href={href({ archived: "1" })} variant="ghost" size="sm">
            {t("leads.showArchived", { count: archivedCount })}
          </ButtonLink>
        ) : null}
      </div>

      <div
        className="-mx-4 overflow-x-auto px-4 pb-2"
        role="region"
        aria-label={t("leads.board")}
        tabIndex={0}
      >
        <div className="flex gap-3">
          {columns.map((column) => {
            const keys = new Set(column.keys);
            const items = visible.filter((r) => keys.has(r.lead.stage));
            const total = sum(column.keys);
            return (
              <section
                key={column.key}
                aria-labelledby={`stage-${column.key}`}
                className="grid w-72 shrink-0 content-start gap-2 rounded-xl bg-muted p-2"
              >
                <header className="grid gap-1 px-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 id={`stage-${column.key}`} className="text-sm font-semibold">
                      {column.label}
                    </h2>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t("leads.total", { count: String(total.count), value: f.money(total.valueMinor) })}
                    </span>
                  </div>
                  {column.hint ? <p className="text-xs text-muted-foreground">{column.hint}</p> : null}
                </header>
                {items.length === 0 ? (
                  <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                    {t("leads.empty")}
                  </p>
                ) : (
                  items.map((row) => (
                    <LeadCard
                      key={row.lead.id}
                      row={row}
                      tenant={tenant}
                      stage={stageOf.get(row.lead.stage)}
                      stages={stages}
                      members={members}
                      defs={defs}
                      f={f}
                      canWrite={canWrite}
                      canConvert={canConvert}
                    />
                  ))
                )}
              </section>
            );
          })}
        </div>
      </div>

      {hasMore ? (
        <ButtonLink
          href={href({ limit: String(limit + PAGE) })}
          variant="outline"
          className="justify-self-center"
        >
          {t("list.loadMore")}
        </ButtonLink>
      ) : null}
    </div>
  );
}
