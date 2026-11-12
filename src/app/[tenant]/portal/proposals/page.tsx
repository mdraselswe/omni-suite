import Link from "next/link";
import { FilterBar, FilterSearch, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { NoResults } from "@/components/data/no-results";
import { Pagination } from "@/components/data/pagination";
import { EmptyState, PageHeader } from "@/components/layout/page";
import { pageProposals, proposalDisplayStatus, ProposalStatusBadge } from "@/features/proposals";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { keepSize, parsePage } from "@/lib/pagination";
import { normaliseSearch } from "@/lib/search";
import { db } from "@/server/db";
import { portalPage } from "../_components/portal";

export default async function PortalProposals({
  params,
  searchParams,
}: PageProps<"/[tenant]/portal/proposals">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx, clientId } = await portalPage(tenant, "portal.proposals");
  const f = formatters(ctx);
  const q = normaliseSearch(param(sp, "q"));
  const page = parsePage(sp);
  const path = tenantHref(tenant, "portal/proposals");
  const found = await pageProposals(db(), ctx.tenant.id, { clientId, portal: true, q }, page);
  const rows = found.rows;
  const now = today(ctx.tenant.settings.timezone);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("nav.portal.proposals")}
        description={t("portal.proposalsSub", { business: ctx.tenant.name })}
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
        <ul className="divide-y overflow-hidden surface">
          {rows.map(({ proposal }) => (
            <li key={proposal.id}>
              <Link
                href={tenantHref(tenant, `portal/proposals/${proposal.id}`)}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="grid min-w-0">
                  <span className="truncate font-medium">{proposal.title}</span>
                  <span className="text-xs text-muted-foreground">{proposal.number}</span>
                </span>
                <span className="flex items-center gap-3">
                  <ProposalStatusBadge status={proposalDisplayStatus(proposal, now)} />
                  <span className="tabular-nums">{f.money(proposal.totalMinor, proposal.currency)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination path={path} searchParams={sp} request={page} paged={found} locale={f.locale} />
    </div>
  );
}
