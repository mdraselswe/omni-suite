import Link from "next/link";
import { FilterBar, FilterSearch, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { NoResults } from "@/components/data/no-results";
import { Pagination } from "@/components/data/pagination";
import { StatusBadge } from "@/components/data/status-badge";
import { EmptyState, PageHeader } from "@/components/layout/page";
import { ButtonLink } from "@/components/ui/button-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { displayStatus, invoiceBalance, pageInvoices } from "@/features/invoices";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { keepSize, parsePage } from "@/lib/pagination";
import { normaliseSearch } from "@/lib/search";
import { db } from "@/server/db";
import { portalPage } from "../_components/portal";

export default async function PortalInvoices({
  params,
  searchParams,
}: PageProps<"/[tenant]/portal/invoices">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx, clientId } = await portalPage(tenant, "portal.invoices");
  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const q = normaliseSearch(param(sp, "q"));
  const page = parsePage(sp);
  const path = tenantHref(tenant, "portal/invoices");
  const found = await pageInvoices(db(), ctx.tenant.id, { clientId, portal: true, q }, page);
  const rows = found.rows;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("nav.portal.invoices")}
        description={t("portal.invoicesSub", { business: ctx.tenant.name })}
        actions={
          <ButtonLink href={tenantHref(tenant, "portal/statement")} variant="outline" size="sm">
            {t("statement.title")}
          </ButtonLink>
        }
      />
      <FilterBar keep={keepSize(page)}>
        <FilterSearch value={q} />
      </FilterBar>
      {rows.length === 0 ? (
        q ? (
          <NoResults q={q} path={path} searchParams={sp} />
        ) : (
          <EmptyState title={t("portal.nothing")} />
        )
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("invoices.number")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("invoices.issueDate")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("invoices.dueDate")}</TableHead>
              <TableHead>{t("form.status")}</TableHead>
              <TableHead className="text-right">{t("invoices.balance")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ invoice }) => {
              const status = displayStatus(invoice, now);
              const balance = invoiceBalance(invoice);
              return (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <Link
                      href={tenantHref(tenant, `portal/invoices/${invoice.id}`)}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {invoice.number}
                    </Link>
                    {/* Phones: the due date sits under the number instead of its own column. */}
                    <span className="block text-xs text-muted-foreground sm:hidden">
                      {t("portal.due", { date: f.date(invoice.dueDate) })}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{f.date(invoice.issueDate)}</TableCell>
                  <TableCell className="hidden sm:table-cell">{f.date(invoice.dueDate)}</TableCell>
                  <TableCell>
                    <StatusBadge status={status} label={t(`invoices.status.${status}`)} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {balance === 0n && (invoice.status === "void" || invoice.status === "paid") ? (
                      <span className="text-muted-foreground">{t("portalWork.nothingOwed")}</span>
                    ) : (
                      f.money(balance, invoice.currency)
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Pagination path={path} searchParams={sp} request={page} paged={found} locale={f.locale} />
    </div>
  );
}
