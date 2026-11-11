import { formatters } from "@/components/data/format";
import { ActionButton } from "@/components/form/action-button";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { CustomFieldInputs } from "@/components/form/custom-field-inputs";
import { SelectField, TextAreaField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { PageHeader, StatCard } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { storedCustom } from "@/features/clients";
import {
  convertLeadAction,
  createLeadAction,
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

function LeadFields({
  stages,
  members,
  defs,
  lead,
  currency,
}: {
  stages: readonly Stage[];
  members: readonly { value: string; label: string }[];
  defs: Awaited<ReturnType<typeof customFieldsFor>>;
  lead?: LeadRow["lead"];
  currency: string;
}) {
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
          defaultValue={lead?.stage ?? stages[0]?.key}
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

export default async function LeadsPage({ params }: PageProps<"/[tenant]/leads">) {
  const { tenant } = await params;
  const { ctx, scope } = await requireTenantPermission(tenant, "leads.read");
  const f = formatters(ctx);
  const canWrite = hasPermission(ctx, "leads.write");
  const canConvert = canWrite && hasPermission(ctx, "clients.write");
  const database = db();
  const stages = ctx.tenant.settings.pipelineStages;
  const [rows, members, defs] = await Promise.all([
    listLeads(database, ctx, scope),
    memberOptions(database, ctx.tenant.id),
    customFieldsFor(database, ctx.tenant.id, "lead"),
  ]);
  const openKeys = new Set(stages.filter((s) => s.kind === "open").map((s) => s.key));
  const open = rows.filter((r) => openKeys.has(r.lead.stage));
  const openValue = open.reduce((acc, r) => acc + r.lead.valueMinor, 0n);
  const wonKeys = new Set(stages.filter((s) => s.kind === "won").map((s) => s.key));
  const won = rows.filter((r) => wonKeys.has(r.lead.stage));
  const stageOptions = stages.map((s) => ({ value: s.key, label: s.label }));

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
          value={f.money(openValue)}
          hint={t("leads.openCount", { count: open.length })}
        />
        <StatCard label={t("leads.wonCount")} value={String(won.length)} />
        <StatCard label={t("leads.allCount")} value={String(rows.length)} />
      </div>

      <div
        className="-mx-4 overflow-x-auto px-4 pb-2"
        role="region"
        aria-label={t("leads.board")}
        tabIndex={0}
      >
        <div className="flex gap-3">
          {stages.map((stage) => {
            const items = rows.filter((r) => r.lead.stage === stage.key);
            const total = items.reduce((acc, r) => acc + r.lead.valueMinor, 0n);
            return (
              <section
                key={stage.key}
                aria-labelledby={`stage-${stage.key}`}
                className="grid w-72 shrink-0 content-start gap-2 rounded-xl bg-muted p-2"
              >
                <header className="flex items-baseline justify-between gap-2 px-1">
                  <h2 id={`stage-${stage.key}`} className="text-sm font-semibold">
                    {stage.label}
                  </h2>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t("leads.total", { count: String(items.length), value: f.money(total) })}
                  </span>
                </header>
                {items.length === 0 ? (
                  <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                    {t("leads.empty")}
                  </p>
                ) : (
                  items.map(({ lead, ownerName }) => (
                    <article key={lead.id} className="grid gap-2 surface p-3 text-sm">
                      <div className="grid gap-0.5">
                        <p className="font-medium">{lead.name}</p>
                        {lead.company ? (
                          <p className="text-xs text-muted-foreground">{lead.company}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
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
                              defaultValue={lead.stage}
                              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-xs dark:bg-input/30"
                            >
                              {stageOptions.map((o) => (
                                <option key={o.value} value={o.value}>
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
                            <LeadFields
                              stages={stages}
                              members={members}
                              defs={defs}
                              lead={lead}
                              currency={f.currency}
                            />
                          </FormDialog>
                          {canConvert && !lead.clientId && stage.kind !== "lost" ? (
                            <ActionButton
                              action={convertLeadAction.bind(null, tenant)}
                              values={{ id: lead.id }}
                            >
                              {t("leads.convert")}
                            </ActionButton>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  ))
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
