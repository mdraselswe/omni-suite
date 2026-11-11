import Link from "next/link";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { EmptyState, PageHeader } from "@/components/layout/page";
import { listProposals } from "@/features/proposals";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { db } from "@/server/db";
import { portalPage } from "../_components/portal";

export default async function PortalProposals({ params }: PageProps<"/[tenant]/portal/proposals">) {
  const { tenant } = await params;
  const { ctx, clientId } = await portalPage(tenant, "portal.proposals");
  const f = formatters(ctx);
  const rows = await listProposals(db(), ctx.tenant.id, { clientId, portal: true });

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("nav.portal.proposals")}
        description={t("portal.proposalsSub", { business: ctx.tenant.name })}
      />
      {rows.length === 0 ? (
        <EmptyState title={t("portal.nothing")} />
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
                  <StatusBadge status={proposal.status} label={t(`proposals.status.${proposal.status}`)} />
                  <span className="tabular-nums">{f.money(proposal.totalMinor, proposal.currency)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
