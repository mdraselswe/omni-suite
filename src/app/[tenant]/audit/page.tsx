import { FilterBar, FilterSearch, param } from "@/components/data/filter-bar";
import { NoResults } from "@/components/data/no-results";
import { Pagination } from "@/components/data/pagination";
import { EmptyState, PageHeader } from "@/components/layout/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageAudit } from "@/features/settings";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { keepSize, parsePage } from "@/lib/pagination";
import { normaliseSearch } from "@/lib/search";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

export default async function AuditPage({ params, searchParams }: PageProps<"/[tenant]/audit">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "audit.read");
  const { timezone, locale } = ctx.tenant.settings;
  const q = normaliseSearch(param(sp, "q"));
  const page = parsePage(sp);
  const path = tenantHref(tenant, "audit");
  const found = await pageAudit(db(), ctx.tenant.id, { q }, page);
  const visible = found.rows;

  return (
    <div className="grid gap-6">
      <PageHeader title={t("audit.title")} description={t("audit.sub")} />
      <FilterBar keep={keepSize(page)}>
        <FilterSearch value={q} />
      </FilterBar>
      {visible.length === 0 ? (
        q ? (
          <NoResults q={q} path={path} searchParams={sp} />
        ) : (
          <EmptyState title={t("audit.none")} />
        )
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("audit.when")}</TableHead>
              <TableHead>{t("audit.action")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("audit.who")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("audit.details")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map(({ log, actorName, actorEmail }) => {
              const json = JSON.stringify(log.data);
              return (
                <TableRow key={log.id} className="align-top">
                  <TableCell className="text-xs whitespace-nowrap">
                    {formatDateTime(log.createdAt, timezone, locale)}
                  </TableCell>
                  <TableCell>
                    <div className="grid gap-0.5">
                      <span className="font-mono text-xs">{log.action}</span>
                      <span className="text-xs text-muted-foreground">
                        {log.entityId
                          ? t("audit.entityId", { type: log.entityType, id: log.entityId.slice(0, 8) })
                          : log.entityType}
                      </span>
                      <span className="text-xs text-muted-foreground md:hidden">
                        {actorName ?? t("audit.system")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="grid">
                      <span className="text-sm">{actorName ?? t("audit.system")}</span>
                      {actorEmail ? (
                        <span className="text-xs break-all text-muted-foreground">{actorEmail}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-md lg:table-cell">
                    {json && json !== "{}" ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          {json.length > 60 ? `${json.slice(0, 60)}…` : json}
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                          {JSON.stringify(log.data, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Pagination path={path} searchParams={sp} request={page} paged={found} locale={locale} />
    </div>
  );
}
