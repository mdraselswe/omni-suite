import Link from "next/link";
import { notFound } from "next/navigation";
import { FilterBar, FilterDate, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { getClient } from "@/features/clients";
import { clientStatement, PrintButton, StatementView } from "@/features/invoices";
import { t } from "@/i18n";
import { fiscalYearStart, isIsoDate, today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { requirePermission } from "@/server/tenancy/context";

/** A client's statement of account for a range (print or save as PDF to send it). */
export default async function ClientStatementPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/clients/[clientId]/statement">) {
  const { tenant, clientId } = await params;
  const sp = await searchParams;
  const { ctx, scope } = await requireTenantPermission(tenant, "clients.read");
  requirePermission(ctx, "invoices.read");
  const database = db();
  const client = await getClient(database, ctx, scope, clientId);
  if (!client) notFound();
  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const from = isIsoDate(param(sp, "from"))
    ? param(sp, "from")
    : fiscalYearStart(now, ctx.tenant.settings.fiscalYearStartMonth);
  const to = isIsoDate(param(sp, "to")) && param(sp, "to") >= from ? param(sp, "to") : now;
  const statements = await clientStatement(
    database,
    ctx.tenant.id,
    client.id,
    { from, to },
    ctx.tenant.settings.currency,
  );

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <Link
          href={tenantHref(tenant, `clients/${client.id}`)}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {client.name}
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
        clientName={client.name}
        from={from}
        to={to}
        invoiceHref={(id) => tenantHref(tenant, `invoices/${id}`)}
      />
    </div>
  );
}
