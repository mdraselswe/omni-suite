import Link from "next/link";
import { FilterBar, FilterSearch, FilterSelect, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { NoResults } from "@/components/data/no-results";
import { Pagination } from "@/components/data/pagination";
import { StatusBadge } from "@/components/data/status-badge";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createProjectAction, listProjectTemplates, pageProjects, ProjectFields } from "@/features/projects";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { keepSize, parsePage } from "@/lib/pagination";
import { normaliseSearch } from "@/lib/search";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { clientOptions } from "@/server/options";
import { customFieldsFor } from "@/server/shared";
import { hasPermission } from "@/server/tenancy/context";

export default async function ProjectsPage({ params, searchParams }: PageProps<"/[tenant]/projects">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx, scope } = await requireTenantPermission(tenant, "projects.read");
  const f = formatters(ctx);
  const statuses = ctx.tenant.settings.projectStatuses;
  const statusOptions = statuses.map((s) => ({ value: s.key, label: s.label }));
  const status = statuses.some((s) => s.key === param(sp, "status")) ? param(sp, "status") : undefined;
  const clientId = /^[0-9a-f-]{36}$/.test(param(sp, "client")) ? param(sp, "client") : undefined;
  const q = normaliseSearch(param(sp, "q"));
  const page = parsePage(sp);
  const path = tenantHref(tenant, "projects");
  const canWrite = hasPermission(ctx, "projects.write");
  const database = db();

  const [found, clients, templates, customFields] = await Promise.all([
    pageProjects(database, ctx, scope, { status, clientId, q }, page),
    clientOptions(database, ctx.tenant.id),
    canWrite ? listProjectTemplates(database, ctx.tenant.id) : Promise.resolve([]),
    canWrite ? customFieldsFor(database, ctx.tenant.id, "project") : Promise.resolve([]),
  ]);
  const projects = found.rows;
  const doneKeys = new Set(statuses.filter((s) => s.done).map((s) => s.key));
  const labelOf = (key: string) => statuses.find((s) => s.key === key)?.label ?? key;

  return (
    <Section
      title={t("projects.title")}
      actions={
        canWrite ? (
          <FormDialog
            trigger={t("projects.new")}
            title={t("projects.new")}
            action={createProjectAction.bind(null, tenant)}
            wide
          >
            <ProjectFields
              clients={clients}
              statuses={statusOptions}
              customFields={customFields}
              templates={templates.map((tpl) => ({ value: tpl.id, label: tpl.name }))}
              values={{
                name: "",
                description: "",
                clientId: null,
                status: statuses.find((s) => !s.done)?.key ?? statuses[0]?.key ?? "",
                startDate: null,
                dueDate: null,
                budget: "",
                custom: {},
              }}
            />
          </FormDialog>
        ) : null
      }
    >
      <FilterBar keep={keepSize(page)}>
        <FilterSelect name="status" label={t("form.status")} value={status} options={statusOptions} />
        <FilterSelect name="client" label={t("projects.client")} value={clientId} options={clients} />
        <FilterSearch value={q} />
      </FilterBar>

      {projects.length === 0 ? (
        q ? (
          <NoResults q={q} path={path} searchParams={sp} />
        ) : (
          <EmptyState title={t("projects.none")} />
        )
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("form.name")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("projects.client")}</TableHead>
              <TableHead>{t("form.status")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("projects.due")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("tasks.title")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => {
              const pct = p.taskCount > 0 ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={tenantHref(tenant, `projects/${p.id}`)}
                      className="font-medium hover:underline"
                    >
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {p.clientName ?? t("projects.internal")}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={doneKeys.has(p.status) ? "done" : p.status}
                      label={labelOf(p.status)}
                    />
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap md:table-cell">
                    {f.date(p.dueDate)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="grid gap-1">
                      <span className="text-xs text-muted-foreground">
                        {t("projects.progress", { done: p.doneCount, total: p.taskCount })}
                      </span>
                      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <div
                          className="h-full origin-left rounded-full bg-primary"
                          style={{ transform: `scaleX(${pct / 100})` }}
                        />
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Pagination path={path} searchParams={sp} request={page} paged={found} locale={f.locale} />
    </Section>
  );
}
