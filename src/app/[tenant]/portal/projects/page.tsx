import Link from "next/link";
import { FilterBar, FilterSearch, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { NoResults } from "@/components/data/no-results";
import { Pagination } from "@/components/data/pagination";
import { StatusBadge } from "@/components/data/status-badge";
import { EmptyState, PageHeader } from "@/components/layout/page";
import { pageProjects } from "@/features/projects";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { keepSize, parsePage } from "@/lib/pagination";
import { normaliseSearch } from "@/lib/search";
import { db } from "@/server/db";
import { portalPage } from "../_components/portal";

export default async function PortalProjects({
  params,
  searchParams,
}: PageProps<"/[tenant]/portal/projects">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await portalPage(tenant, "portal.projects");
  const f = formatters(ctx);
  const q = normaliseSearch(param(sp, "q"));
  const page = parsePage(sp);
  const path = tenantHref(tenant, "portal/projects");
  const found = await pageProjects(db(), ctx, "all", { q }, page);
  const projects = found.rows;
  const statuses = ctx.tenant.settings.projectStatuses;

  return (
    <div className="grid gap-6">
      <PageHeader title={t("nav.portal.projects")} description={t("portal.projectsSub")} />
      <FilterBar keep={keepSize(page)}>
        <FilterSearch value={q} />
      </FilterBar>
      {projects.length === 0 ? (
        q ? (
          <NoResults q={q} path={path} searchParams={sp} />
        ) : (
          <EmptyState title={t("portal.nothing")} />
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => {
            const status = statuses.find((s) => s.key === p.status);
            const pct = p.taskCount > 0 ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
            return (
              <li key={p.id}>
                <Link
                  href={tenantHref(tenant, `portal/projects/${p.id}`)}
                  className="grid gap-3 surface p-4 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{p.name}</span>
                    <StatusBadge
                      status={status?.done ? "done" : p.status}
                      label={status?.label ?? p.status}
                    />
                  </span>
                  <span className="grid gap-1">
                    <span
                      className="h-1.5 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={t("portalWork.progressLabel")}
                    >
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t("portal.progress", { done: p.doneCount, total: p.taskCount })}
                      {p.dueDate ? ` · ${t("portal.due", { date: f.date(p.dueDate) })}` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination path={path} searchParams={sp} request={page} paged={found} locale={f.locale} />
    </div>
  );
}
