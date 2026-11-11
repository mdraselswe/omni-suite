import { FilterBar, FilterSearch, param } from "@/components/data/filter-bar";
import { EmptyState, PageHeader } from "@/components/layout/page";
import { ButtonLink } from "@/components/ui/button-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAudit } from "@/features/settings";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

const PAGE = 100;

export default async function AuditPage({ params, searchParams }: PageProps<"/[tenant]/audit">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "audit.read");
  const { timezone, locale } = ctx.tenant.settings;
  const q = param(sp, "q").trim().slice(0, 100) || undefined;
  const beforeRaw = param(sp, "before");
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : undefined;

  const rows = await listAudit(db(), ctx.tenant.id, { q, before, limit: PAGE + 1 });
  const visible = rows.slice(0, PAGE);
  const last = visible[visible.length - 1];
  const older = new URLSearchParams();
  if (q) older.set("q", q);
  if (last) older.set("before", last.log.createdAt.toISOString());

  return (
    <div className="grid gap-6">
      <PageHeader title={t("audit.title")} description={t("audit.sub")} />
      <FilterBar>
        <FilterSearch value={q} />
      </FilterBar>
      {visible.length === 0 ? (
        <EmptyState title={t("audit.none")} />
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
      {rows.length > PAGE ? (
        <ButtonLink
          href={tenantHref(tenant, `audit?${older.toString()}`)}
          variant="outline"
          className="justify-self-center"
        >
          {t("audit.older")}
        </ButtonLink>
      ) : null}
    </div>
  );
}
