import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { lists } from "@/config";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { CustomFieldInputs, CustomFieldValues } from "@/components/form/custom-field-inputs";
import { SelectField, TextAreaField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getClient,
  listTemplates,
  onboardingForClient,
  storedCustom,
  updateClientAction,
} from "@/features/clients";
import { formatBytes, pageFiles } from "@/features/files";
import { displayStatus, invoiceBalance, pageInvoices } from "@/features/invoices";
import { pageProjects } from "@/features/projects";
import { pageProposals } from "@/features/proposals";
import { listMembers, listRoles } from "@/features/team";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { firstPage } from "@/lib/pagination";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import type { Scope } from "@/server/rbac/resolve";
import { customFieldsFor } from "@/server/shared";
import { hasPermission, requirePermission, type TenantContext } from "@/server/tenancy/context";
import { ClientOnboardingSection } from "./_components/client-onboarding";
import { ClientPortalUsersSection } from "./_components/client-portal-users";

function scopeOf(ctx: TenantContext, permission: string): Scope | null {
  try {
    return requirePermission(ctx, permission);
  } catch {
    return null;
  }
}

const link = "font-medium underline-offset-4 hover:underline";

/** Nothing to show (no permission): same shape as a page of rows. */
const noRows = { rows: [], total: 0, page: 1, size: 0 };

/** "View all (N)" next to a short list, when the client has more than it shows. */
function ViewAll({ href, total, shown }: { href: Route; total: number; shown: number }) {
  return total > shown ? (
    <Link href={href} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
      {t("list.viewAll", { count: total })}
    </Link>
  ) : null;
}

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
  // Short lists: the newest few, with a link to the full list filtered to this client.
  const preview = firstPage(lists.previewSize);

  const [defs, onboarding, templates, members, roles, projects, invoices, proposals, files] =
    await Promise.all([
      customFieldsFor(database, ctx.tenant.id, "client"),
      onboardingForClient(database, ctx.tenant.id, client.id),
      canOnboard ? listTemplates(database, ctx.tenant.id) : Promise.resolve([]),
      canInvite || canWrite ? listMembers(database, ctx.tenant.id) : Promise.resolve([]),
      canInvite ? listRoles(database, ctx.tenant.id) : Promise.resolve([]),
      projectScope
        ? pageProjects(database, ctx, projectScope, { clientId: client.id }, preview)
        : Promise.resolve(noRows),
      canInvoices
        ? pageInvoices(database, ctx.tenant.id, { clientId: client.id }, preview)
        : Promise.resolve(noRows),
      canProposals
        ? pageProposals(database, ctx.tenant.id, { clientId: client.id }, preview)
        : Promise.resolve(noRows),
      fileScope
        ? pageFiles(database, ctx, fileScope, { entityType: "client", entityId: client.id }, preview)
        : Promise.resolve(noRows),
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
                <TextField
                  name="contactName"
                  label={t("clients.contactName")}
                  defaultValue={client.contactName}
                />
                <TextField
                  name="billingEmail"
                  label={t("clients.billingEmail")}
                  hint={t("clients.billingEmailHint")}
                  type="email"
                  defaultValue={client.billingEmail}
                />
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
        <dl className="grid gap-3 surface p-4 text-sm sm:grid-cols-2">
          {[
            [t("form.email.label"), client.email],
            [t("clients.contactName"), client.contactName],
            [t("clients.billingEmail"), client.billingEmail],
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

      <ClientOnboardingSection
        ctx={ctx}
        tenant={tenant}
        client={client}
        onboarding={onboarding}
        templates={templates}
        canOnboard={canOnboard}
        canInvite={canInvite}
      />

      {canInvite || canWrite ? (
        <ClientPortalUsersSection
          ctx={ctx}
          tenant={tenant}
          client={client}
          portalUsers={portalUsers}
          clientRoles={clientRoles}
          canInvite={canInvite}
        />
      ) : null}

      {projectScope ? (
        <Section
          title={t("clients.projects")}
          actions={
            <ViewAll
              href={tenantHref(tenant, `projects?client=${client.id}`)}
              total={projects.total}
              shown={projects.rows.length}
            />
          }
        >
          {projects.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("projects.none")}</p>
          ) : (
            <ul className="grid gap-2">
              {projects.rows.map((p) => (
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
        <Section
          title={t("clients.proposals")}
          actions={
            <ViewAll
              href={tenantHref(tenant, `proposals?client=${client.id}`)}
              total={proposals.total}
              shown={proposals.rows.length}
            />
          }
        >
          {proposals.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("proposals.none")}</p>
          ) : (
            <Table>
              <TableBody>
                {proposals.rows.map(({ proposal: p }) => (
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
        <Section
          title={t("clients.invoices")}
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={tenantHref(tenant, `clients/${client.id}/statement`)}
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {t("statement.title")}
              </Link>
              <ViewAll
                href={tenantHref(tenant, `invoices?client=${client.id}`)}
                total={invoices.total}
                shown={invoices.rows.length}
              />
            </div>
          }
        >
          {invoices.rows.length === 0 ? (
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
                {invoices.rows.map(({ invoice: inv }) => {
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
                        {f.money(invoiceBalance(inv), inv.currency)}
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
        <Section
          title={t("clients.files")}
          actions={
            <ViewAll
              href={tenantHref(tenant, `files?type=client&entity=${client.id}`)}
              total={files.total}
              shown={files.rows.length}
            />
          }
        >
          {files.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("files.none")}</p>
          ) : (
            <ul className="grid gap-2">
              {files.rows.map(({ file }) => (
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
