import Link from "next/link";
import { FilterBar, FilterDate, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { clientStatement, PrintButton, StatementView } from "@/features/invoices";
import { t } from "@/i18n";
import { fiscalYearStart, isIsoDate, today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { db } from "@/server/db";
import { getClient } from "@/features/clients";
import { portalPage } from "../_components/portal";

/** The client's own statement of account: everything invoiced and paid, with the balance. */
export default async function PortalStatementPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/portal/statement">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx, clientId } = await portalPage(tenant, "portal.invoices");
  const database = db();
  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const from = isIsoDate(param(sp, "from"))
    ? param(sp, "from")
    : fiscalYearStart(now, ctx.tenant.settings.fiscalYearStartMonth);
  const to = isIsoDate(param(sp, "to")) && param(sp, "to") >= from ? param(sp, "to") : now;
  // The client id comes from the member's own record, so "all" can't reach another client.
  const [statements, client] = await Promise.all([
    clientStatement(database, ctx.tenant.id, clientId, { from, to }, ctx.tenant.settings.currency),
    getClient(database, ctx, "all", clientId),
  ]);

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <Link
          href={tenantHref(tenant, "portal/invoices")}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {t("nav.portal.invoices")}
        </Link>
        <PrintButton />
      </div>
      <div className="print:hidden">
        <FilterBar>
          <FilterDate name="from" label={t("finance.from")} value={from} />
          <FilterDate name="to" label={t("finance.to")} value={to} />
        </FilterBar>
      </div>
      <StatementView
        statements={statements}
        f={f}
        business={ctx.tenant.settings.branding.displayName || ctx.tenant.name}
        clientName={client?.name ?? ""}
        from={from}
        to={to}
        invoiceHref={(id) => tenantHref(tenant, `portal/invoices/${id}`)}
      />
    </div>
  );
}
