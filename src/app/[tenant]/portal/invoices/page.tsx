import Link from "next/link";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { EmptyState, PageHeader } from "@/components/layout/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { displayStatus, listInvoices } from "@/features/invoices";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { db } from "@/server/db";
import { portalPage } from "../_components/portal";

export default async function PortalInvoices({ params }: PageProps<"/[tenant]/portal/invoices">) {
  const { tenant } = await params;
  const { ctx, clientId } = await portalPage(tenant, "portal.invoices");
  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const rows = await listInvoices(db(), ctx.tenant.id, { clientId, portal: true });

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("nav.portal.invoices")}
        description={t("portal.invoicesSub", { business: ctx.tenant.name })}
      />
      {rows.length === 0 ? (
        <EmptyState title={t("portal.nothing")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("invoices.number")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("invoices.issueDate")}</TableHead>
              <TableHead>{t("invoices.dueDate")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("form.status")}</TableHead>
              <TableHead className="text-right">{t("invoices.balance")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ invoice }) => {
              const status = displayStatus(invoice, now);
              return (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <Link
                      href={tenantHref(tenant, `portal/invoices/${invoice.id}`)}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {invoice.number}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{f.date(invoice.issueDate)}</TableCell>
                  <TableCell>{f.date(invoice.dueDate)}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <StatusBadge status={status} label={t(`invoices.status.${status}`)} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.money(invoice.totalMinor - invoice.paidMinor, invoice.currency)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
