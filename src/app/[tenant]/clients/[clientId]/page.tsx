import Link from "next/link";
import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { CustomFieldInputs, CustomFieldValues } from "@/components/form/custom-field-inputs";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getClient,
  listTemplates,
  onboardingForClient,
  sendOnboardingAction,
  storedCustom,
  updateChecklistAction,
  updateClientAction,
} from "@/features/clients";
import { formatBytes, listFiles } from "@/features/files";
import { displayStatus, listInvoices } from "@/features/invoices";
import { listProjects } from "@/features/projects";
import { listProposals } from "@/features/proposals";
import { inviteAction, listMembers, listRoles } from "@/features/team";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import type { Scope } from "@/server/rbac/resolve";
import { customFieldsFor } from "@/server/shared";
import { hasPermission, requirePermission, type TenantContext } from "@/server/tenancy/context";

function scopeOf(ctx: TenantContext, permission: string): Scope | null {
  try {
    return requirePermission(ctx, permission);
  } catch {
    return null;
  }
}

const link = "font-medium underline-offset-4 hover:underline";

export default async function ClientPage({ params }: PageProps<"/[tenant]/clients/[clientId]">) {
  const { tenant, clientId } = await params;
  const { ctx, scope } = await requireTenantPermission(tenant, "clients.read");
  const database = db();
  const client = await getClient(database, ctx, scope, clientId);
  if (!client) notFound();

  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const canWrite = hasPermission(ctx, "clients.write");
  const canOnboard = hasPermission(ctx, "onboarding.manage");
  const canInvite = hasPermission(ctx, "members.invite");
  const projectScope = scopeOf(ctx, "projects.read");
  const fileScope = scopeOf(ctx, "files.read");
  const canInvoices = hasPermission(ctx, "invoices.read");
  const canProposals = hasPermission(ctx, "proposals.read");

  const [defs, onboarding, templates, members, roles, projects, invoices, proposals, files] =
    await Promise.all([
      customFieldsFor(database, ctx.tenant.id, "client"),
      onboardingForClient(database, ctx.tenant.id, client.id),
      canOnboard ? listTemplates(database, ctx.tenant.id) : Promise.resolve([]),
      canInvite || canWrite ? listMembers(database, ctx.tenant.id) : Promise.resolve([]),
      canInvite ? listRoles(database, ctx.tenant.id) : Promise.resolve([]),
      projectScope ? listProjects(database, ctx, projectScope, { clientId: client.id }) : Promise.resolve([]),
      canInvoices ? listInvoices(database, ctx.tenant.id, { clientId: client.id }) : Promise.resolve([]),
      canProposals ? listProposals(database, ctx.tenant.id, { clientId: client.id }) : Promise.resolve([]),
      fileScope
        ? listFiles(database, ctx, fileScope, { entityType: "client", entityId: client.id })
        : Promise.resolve([]),
    ]);
  const custom = storedCustom(client.custom);
  const portalUsers = members.filter((m) => m.kind === "client" && m.clientId === client.id);
  const clientRoles = roles.filter((r) => r.audience === "client");

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-xl font-semibold">{client.name}</h2>
            <StatusBadge status={client.status} label={t(`clients.status.${client.status}`)} />
          </div>
          <Link
            href={tenantHref(tenant, "clients")}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {t("form.back")}
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasPermission(ctx, "proposals.write") ? (
            <ButtonLink
              href={tenantHref(tenant, `proposals/new?client=${client.id}`)}
              variant="outline"
              size="sm"
            >
              {t("proposals.new")}
            </ButtonLink>
          ) : null}
          {hasPermission(ctx, "invoices.write") ? (
            <ButtonLink
              href={tenantHref(tenant, `invoices/new?client=${client.id}`)}
              variant="outline"
              size="sm"
            >
              {t("invoices.new")}
            </ButtonLink>
          ) : null}
          {canWrite ? (
            <FormDialog
              trigger={t("form.edit")}
              title={client.name}
              action={updateClientAction.bind(null, tenant)}
              size="sm"
              icon={false}
              wide
            >
              <input type="hidden" name="id" value={client.id} />
              <TextField name="name" label={t("clients.name")} defaultValue={client.name} required />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  name="email"
                  label={t("form.email.label")}
                  type="email"
                  defaultValue={client.email}
                />
                <TextField name="phone" label={t("form.phone")} type="tel" defaultValue={client.phone} />
              </div>
              <TextField
                name="website"
                label={t("clients.website")}
                type="url"
                defaultValue={client.website}
              />
              <TextAreaField
                name="address"
                label={t("clients.address")}
                rows={2}
                defaultValue={client.address}
              />
              <SelectField
                name="status"
                label={t("form.status")}
                defaultValue={client.status}
                options={[
                  { value: "active", label: t("clients.status.active") },
                  { value: "inactive", label: t("clients.status.inactive") },
                ]}
              />
              <CustomFieldInputs defs={defs} values={custom} />
              <TextAreaField name="notes" label={t("form.notes")} rows={3} defaultValue={client.notes} />
            </FormDialog>
          ) : null}
        </div>
      </div>

      <Section title={t("clients.details")}>
        <dl className="grid gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2">
          {[
            [t("form.email.label"), client.email],
            [t("form.phone"), client.phone],
            [t("clients.website"), client.website],
            [t("clients.address"), client.address],
          ].map(([label, value]) => (
            <div key={label} className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="break-words whitespace-pre-line">{value || "—"}</dd>
            </div>
          ))}
          {client.notes ? (
            <div className="grid gap-0.5 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">{t("form.notes")}</dt>
              <dd className="whitespace-pre-line">{client.notes}</dd>
            </div>
          ) : null}
        </dl>
        <CustomFieldValues defs={defs} values={custom} />
      </Section>

      <Section
        title={t("onboarding.title")}
        actions={
          canOnboard && templates.length > 0 ? (
            <FormDialog
              trigger={t("onboarding.send")}
              title={t("onboarding.send")}
              action={sendOnboardingAction.bind(null, tenant)}
              submitLabel={t("onboarding.send")}
              size="sm"
            >
              <input type="hidden" name="clientId" value={client.id} />
              <SelectField
                name="templateId"
                label={t("onboarding.template")}
                options={templates.map((tp) => ({ value: tp.id, label: tp.name }))}
              />
            </FormDialog>
          ) : null
        }
      >
        {canOnboard && templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("onboarding.needTemplate")}{" "}
            <Link href={tenantHref(tenant, "clients/onboarding")} className={link}>
              {t("onboarding.templates")}
            </Link>
          </p>
        ) : null}
        {onboarding.length === 0 ? (
          <EmptyState title={t("onboarding.none")} />
        ) : (
          <div className="grid gap-3">
            {onboarding.map((req) => (
              <article key={req.id} className="grid gap-4 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{req.templateName}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {t("onboarding.sentOn", { date: f.date(req.createdAt.toISOString().slice(0, 10)) })}
                    </span>
                    <StatusBadge status={req.status} label={t(`onboarding.status.${req.status}`)} />
                  </div>
                </div>
                {req.fields.length > 0 ? (
                  <div className="grid gap-2">
                    <h3 className="text-sm font-semibold">{t("onboarding.answers")}</h3>
                    <dl className="grid gap-2 text-sm">
                      {req.fields.map((field) => {
                        const answer = req.answers[field.key];
                        return (
                          <div key={field.key} className="grid gap-0.5">
                            <dt className="text-xs text-muted-foreground">{field.label}</dt>
                            <dd className="whitespace-pre-line">
                              {typeof answer === "string" && answer ? (
                                answer
                              ) : (
                                <span className="text-muted-foreground">{t("onboarding.noAnswer")}</span>
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </div>
                ) : null}
                {req.checklist.length > 0 || canOnboard ? (
                  canOnboard && req.status !== "completed" ? (
                    <ActionForm
                      action={updateChecklistAction.bind(null, tenant)}
                      keepValues
                      className="gap-3"
                    >
                      <input type="hidden" name="id" value={req.id} />
                      <fieldset className="grid gap-2">
                        <legend className="mb-1 text-sm font-semibold">{t("onboarding.checklist")}</legend>
                        {req.checklist.map((item) => (
                          <label key={item} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              name="done"
                              value={item}
                              defaultChecked={req.checklistDone.includes(item)}
                              className="size-4 rounded border-input accent-primary"
                            />
                            {item}
                          </label>
                        ))}
                      </fieldset>
                      <CheckboxField name="complete" label={t("onboarding.markComplete")} />
                      <SubmitButton variant="outline" size="sm" className="justify-self-start">
                        {t("onboarding.saveChecklist")}
                      </SubmitButton>
                    </ActionForm>
                  ) : (
                    <ul className="grid gap-1 text-sm">
                      {req.checklist.map((item) => (
                        <li
                          key={item}
                          className={
                            req.checklistDone.includes(item)
                              ? "text-muted-foreground line-through"
                              : undefined
                          }
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Section>

      {canInvite || canWrite ? (
        <Section
          title={t("clients.portalUsers")}
          actions={
            canInvite && clientRoles.length > 0 ? (
              <FormDialog
                trigger={t("clients.invitePortal")}
                title={t("clients.invitePortal")}
                description={t("clients.inviteHint")}
                action={inviteAction.bind(null, tenant)}
                submitLabel={t("team.invite")}
                size="sm"
              >
                <input type="hidden" name="kind" value="client" />
                <input type="hidden" name="clientId" value={client.id} />
                <TextField
                  name="email"
                  label={t("form.email.label")}
                  type="email"
                  defaultValue={client.email}
                  required
                />
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">{t("team.roles")}</legend>
                  {clientRoles.map((role) => (
                    <label key={role.id} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="roleIds"
                        value={role.id}
                        defaultChecked={role.key === "client_owner"}
                        className="mt-0.5 size-4 rounded border-input accent-primary"
                      />
                      <span className="grid">
                        <span>{role.name}</span>
                        {role.description ? (
                          <span className="text-xs text-muted-foreground">{role.description}</span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </FormDialog>
            ) : null
          }
        >
          {portalUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("clients.noPortalUsers")}</p>
          ) : (
            <ul className="grid gap-2">
              {portalUsers.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span className="grid">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-xs text-muted-foreground">{m.email}</span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {m.roles.map((r) => (
                      <Badge key={r.roleId} variant="outline">
                        {r.name}
                      </Badge>
                    ))}
                    {m.status === "disabled" ? (
                      <StatusBadge status="disabled" label={t("team.statusDisabled")} />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {projectScope ? (
        <Section title={t("clients.projects")}>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("projects.none")}</p>
          ) : (
            <ul className="grid gap-2">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <Link href={tenantHref(tenant, `projects/${p.id}`)} className={link}>
                    {p.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {t("projects.progress", { done: String(p.doneCount), total: String(p.taskCount) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {canProposals ? (
        <Section title={t("clients.proposals")}>
          {proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("proposals.none")}</p>
          ) : (
            <Table>
              <TableBody>
                {proposals.map(({ proposal: p }) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={tenantHref(tenant, `proposals/${p.id}`)} className={link}>
                        {p.number}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{p.title}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} label={t(`proposals.status.${p.status}`)} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.money(p.totalMinor, p.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      ) : null}

      {canInvoices ? (
        <Section title={t("clients.invoices")}>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("invoices.none")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("invoices.number")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("invoices.dueDate")}</TableHead>
                  <TableHead>{t("form.status")}</TableHead>
                  <TableHead className="text-right">{t("invoices.balance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map(({ invoice: inv }) => {
                  const status = displayStatus(inv, now);
                  return (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <Link href={tenantHref(tenant, `invoices/${inv.id}`)} className={link}>
                          {inv.number}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{f.date(inv.dueDate)}</TableCell>
                      <TableCell>
                        <StatusBadge status={status} label={t(`invoices.status.${status}`)} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.money(inv.totalMinor - inv.paidMinor, inv.currency)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Section>
      ) : null}

      {fileScope ? (
        <Section title={t("clients.files")}>
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("files.none")}</p>
          ) : (
            <ul className="grid gap-2">
              {files.map(({ file }) => (
                <li
                  key={file.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <a href={`/api/t/${tenant}/files/${file.id}/`} className={link}>
                    {file.name}
                  </a>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {file.clientVisible ? (
                      <Badge variant="secondary">{t("files.clientVisible")}</Badge>
                    ) : null}
                    {formatBytes(file.size)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
    </div>
  );
}
