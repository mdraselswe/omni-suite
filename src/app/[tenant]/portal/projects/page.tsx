import Link from "next/link";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { EmptyState, PageHeader } from "@/components/layout/page";
import { listProjects } from "@/features/projects";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { db } from "@/server/db";
import { portalPage } from "../_components/portal";

export default async function PortalProjects({ params }: PageProps<"/[tenant]/portal/projects">) {
  const { tenant } = await params;
  const { ctx } = await portalPage(tenant, "portal.projects");
  const f = formatters(ctx);
  const projects = await listProjects(db(), ctx, "all");
  const statuses = ctx.tenant.settings.projectStatuses;

  return (
    <div className="grid gap-6">
      <PageHeader title={t("nav.portal.projects")} description={t("portal.projectsSub")} />
      {projects.length === 0 ? (
        <EmptyState title={t("portal.nothing")} />
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
                      aria-label={t("projects.progress")}
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
    </div>
  );
}
