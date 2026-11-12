import { FilterBar, FilterSearch, FilterSelect, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { NoResults } from "@/components/data/no-results";
import { Pagination } from "@/components/data/pagination";
import { ActionButton } from "@/components/form/action-button";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { CustomFieldInputs } from "@/components/form/custom-field-inputs";
import { SelectField, TextAreaField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, PageHeader, StatCard } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lists } from "@/config";
import { storedCustom } from "@/features/clients";
import {
  archivedLeadCount,
  archiveLeadAction,
  boardLeads,
  convertLeadAction,
  createLeadAction,
  LeadImportDialog,
  leadStageTotals,
  moveLeadAction,
  pageLeads,
  updateLeadAction,
  type LeadFilter,
  type LeadRow,
  pipelineSummary,
} from "@/features/crm";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { appHref, tenantHref } from "@/lib/href";
import { toDecimalString } from "@/lib/money";
import { keepSize, parsePage, queryWith } from "@/lib/pagination";
import { normaliseSearch } from "@/lib/search";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { memberOptions } from "@/server/options";
import { customFieldsFor } from "@/server/shared";
import { hasPermission } from "@/server/tenancy/context";
import Link from "next/link";

type Stage = { key: string; label: string; kind: "open" | "won" | "lost" };
type Defs = Awaited<ReturnType<typeof customFieldsFor>>;
type Option = { value: string; label: string };

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
      <TextField
        name="followUpDate"
        label={t("leads.followUp")}
        hint={t("leads.followUpHint")}
        type="date"
        defaultValue={lead?.followUpDate ?? ""}
      />
      <CustomFieldInputs defs={defs} values={storedCustom(lead?.custom)} />
      <TextAreaField name="notes" label={t("form.notes")} defaultValue={lead?.notes} rows={3} />
    </>
  );
}

type LeadProps = {
  row: LeadRow;
  tenant: string;
  /** Undefined when the lead's stage is no longer in the pipeline. */
  stage: Stage | undefined;
  stages: readonly Stage[];
  members: readonly Option[];
  defs: Defs;
  f: ReturnType<typeof formatters>;
  canWrite: boolean;
  /** Today in the business's time zone (follow-ups on or before it are due). */
  today: string;
  canConvert: boolean;
};

/** Move, edit, convert and archive: on a board card and in a list row. */
function LeadActions({ row, tenant, stage, stages, members, defs, f, canConvert }: LeadProps) {
  const { lead } = row;
  const archived = lead.archivedAt !== null;
  return (
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
  );
}

/** "Follow up 12 Jul": highlighted once the day has come (open leads only). */
function FollowUp({
  lead,
  stage,
  today,
  f,
}: {
  lead: LeadRow["lead"];
  stage: Stage | undefined;
  today: string;
  f: ReturnType<typeof formatters>;
}) {
  if (!lead.followUpDate || lead.archivedAt || (stage && stage.kind !== "open")) return null;
  const due = lead.followUpDate <= today;
  return (
    <Badge variant={due ? "destructive" : "outline"}>
      {t(due ? "leads.followUpDue" : "leads.followUpOn", { date: f.date(lead.followUpDate) })}
    </Badge>
  );
}

function LeadCard(props: LeadProps) {
  const { row, tenant, stage, f, canWrite, today } = props;
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
        <FollowUp lead={lead} stage={stage} today={today} f={f} />
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
      {canWrite ? <LeadActions {...props} /> : null}
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
  const q = normaliseSearch(param(sp, "q"));
  const showArchived = param(sp, "archived") === "1";
  const now = today(ctx.tenant.settings.timezone);
  const dueOnly = param(sp, "due") === "1";
  // Board: the newest leads of each stage. List: every lead, page by page.
  const listView = param(sp, "view") === "list" || dueOnly;
  const database = db();
  const stages = ctx.tenant.settings.pipelineStages;
  const stageOf = new Map(stages.map((s) => [s.key, s]));
  const stageParam = param(sp, "stage");
  const stage = stageParam === OTHER || stageOf.has(stageParam) ? stageParam : undefined;
  const filter: LeadFilter = { q, archived: showArchived, dueBy: dueOnly ? now : undefined };
  const listFilter: LeadFilter =
    stage === OTHER
      ? { ...filter, notStages: stages.map((s) => s.key) }
      : stage
        ? { ...filter, stages: [stage] }
        : filter;
  const page = parsePage(sp);
  const path = tenantHref(tenant, "leads");
  const [board, list, totals, archivedCount, members, defs, pipeline] = await Promise.all([
    listView ? Promise.resolve([]) : boardLeads(database, ctx, scope, filter, lists.boardColumnSize),
    listView ? pageLeads(database, ctx, scope, listFilter, page) : Promise.resolve(null),
    leadStageTotals(database, ctx, scope, filter),
    archivedLeadCount(database, ctx, scope),
    memberOptions(database, ctx.tenant.id),
    customFieldsFor(database, ctx.tenant.id, "lead"),
    pipelineSummary(database, ctx, now),
  ]);
  // Loaded newest first; shown oldest first inside a column, like a queue.
  const visible = [...board].reverse();

  // Counts and values come from the whole pipeline, not just the leads on the board.
  const sum = (keys: readonly string[]) =>
    keys.reduce(
      (acc, k) => {
        const v = totals.get(k);
        return v ? { count: acc.count + v.count, valueMinor: acc.valueMinor + v.valueMinor } : acc;
      },
      { count: 0, valueMinor: 0n },
    );
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
  const stageOptions = columns.map((c) => ({ value: c.key, label: c.label }));
  const n = new Intl.NumberFormat(f.locale);

  const href = (changes: Record<string, string | null>) => appHref(`${path}${queryWith(sp, changes)}`);
  const cardProps = { tenant, stages, members, defs, f, canWrite, canConvert, today: now };

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("leads.title")}
        description={t("leads.sub")}
        actions={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <LeadImportDialog tenant={tenant} stages={stages} locale={ctx.tenant.settings.locale} />
              <FormDialog
                trigger={t("leads.new")}
                title={t("leads.new")}
                action={createLeadAction.bind(null, tenant)}
                wide
              >
                <LeadFields stages={stages} members={members} defs={defs} currency={f.currency} />
              </FormDialog>
            </div>
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
        <StatCard label={t("leads.wonCount")} value={n.format(won.count)} />
        <StatCard label={t("leads.allCount")} value={n.format(all.count)} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <FilterBar
          keep={{
            archived: showArchived ? "1" : undefined,
            view: listView ? "list" : undefined,
            due: dueOnly ? "1" : undefined,
            ...(listView ? keepSize(page) : {}),
          }}
        >
          {listView ? (
            <FilterSelect name="stage" label={t("leads.stage")} value={stage} options={stageOptions} />
          ) : null}
          <FilterSearch value={q} />
        </FilterBar>
        <div className="flex flex-wrap items-center gap-2">
          {dueOnly ? (
            <ButtonLink href={href({ due: null, page: null })} variant="ghost" size="sm">
              {t("leads.allLeads")}
            </ButtonLink>
          ) : pipeline.dueCount > 0 ? (
            <ButtonLink href={href({ due: "1", view: "list", page: null })} variant="outline" size="sm">
              {t("leads.followUpsDue", { count: pipeline.dueCount })}
            </ButtonLink>
          ) : null}
          {showArchived ? (
            <ButtonLink href={href({ archived: null, page: null })} variant="ghost" size="sm">
              {t("leads.hideArchived")}
            </ButtonLink>
          ) : archivedCount > 0 ? (
            <ButtonLink href={href({ archived: "1", page: null })} variant="ghost" size="sm">
              {t("leads.showArchived", { count: archivedCount })}
            </ButtonLink>
          ) : null}
          <div role="group" aria-label={t("leads.view")} className="flex gap-1 rounded-lg bg-muted p-1">
            <ButtonLink
              href={href({ view: null, stage: null, page: null, size: null })}
              variant={listView ? "ghost" : "outline"}
              size="sm"
              aria-current={listView ? undefined : "page"}
            >
              {t("leads.viewBoard")}
            </ButtonLink>
            <ButtonLink
              href={href({ view: "list", page: null })}
              variant={listView ? "outline" : "ghost"}
              size="sm"
              aria-current={listView ? "page" : undefined}
            >
              {t("leads.viewList")}
            </ButtonLink>
          </div>
        </div>
      </div>

      {list ? (
        <>
          {list.rows.length === 0 ? (
            q ? (
              <NoResults q={q} path={path} searchParams={sp} />
            ) : (
              <EmptyState title={t("leads.noneList")} />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("form.name")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("leads.stage")}</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">{t("leads.value")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("leads.owner")}</TableHead>
                  {canWrite ? <TableHead className="w-0" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((row) => {
                  const { lead } = row;
                  const leadStage = stageOf.get(lead.stage);
                  const stageLabel = leadStage?.label ?? t("leads.unknownStage", { stage: lead.stage });
                  return (
                    <TableRow key={lead.id} className="align-top">
                      <TableCell className="whitespace-normal">
                        <div className="grid gap-0.5">
                          <span className="font-medium">{lead.name}</span>
                          {lead.company ? (
                            <span className="text-xs text-muted-foreground">{lead.company}</span>
                          ) : null}
                          <span className="flex flex-wrap items-center gap-1.5 text-xs">
                            {lead.archivedAt ? <Badge variant="outline">{t("leads.archived")}</Badge> : null}
                            {lead.clientId ? (
                              <Link
                                href={tenantHref(tenant, `clients/${lead.clientId}`)}
                                className="font-medium text-primary underline-offset-4 hover:underline"
                              >
                                {t("leads.converted")}
                              </Link>
                            ) : null}
                            <FollowUp lead={lead} stage={leadStage} today={now} f={f} />
                            <span className="text-muted-foreground md:hidden">{stageLabel}</span>
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline">{stageLabel}</Badge>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {lead.valueMinor !== 0n ? f.money(lead.valueMinor) : "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">{row.ownerName ?? ""}</TableCell>
                      {canWrite ? (
                        <TableCell className="min-w-72">
                          <LeadActions row={row} stage={leadStage} {...cardProps} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <Pagination path={path} searchParams={sp} request={page} paged={list} locale={f.locale} />
        </>
      ) : (
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
                        {t("leads.total", { count: n.format(total.count), value: f.money(total.valueMinor) })}
                      </span>
                    </div>
                    {column.hint ? <p className="text-xs text-muted-foreground">{column.hint}</p> : null}
                    {total.count > items.length ? (
                      <p className="text-xs text-muted-foreground">
                        {t("leads.columnShowing", {
                          shown: n.format(items.length),
                          total: n.format(total.count),
                        })}{" "}
                        <Link
                          href={href({ view: "list", stage: column.key, page: null })}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {t("leads.columnSeeAll")}
                        </Link>
                      </p>
                    ) : null}
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
                        stage={stageOf.get(row.lead.stage)}
                        {...cardProps}
                      />
                    ))
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
