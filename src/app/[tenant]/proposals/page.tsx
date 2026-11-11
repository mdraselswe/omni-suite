import Link from "next/link";
import { FilterBar, FilterSelect, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { EmptyState, PageHeader } from "@/components/layout/page";
import { ButtonLink } from "@/components/ui/button-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listProposals } from "@/features/proposals";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { clientOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

const STATUSES = ["draft", "sent", "accepted", "declined"] as const;

export default async function ProposalsPage({ params, searchParams }: PageProps<"/[tenant]/proposals">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "proposals.read");
  const f = formatters(ctx);
  const clientParam = param(sp, "client");
  const clientId = /^[0-9a-f-]{36}$/.test(clientParam) ? clientParam : undefined;
  const statusParam = param(sp, "status");
  const status = STATUSES.find((s) => s === statusParam);
  const database = db();
  const [rows, clients] = await Promise.all([
    listProposals(database, ctx.tenant.id, { clientId }),
    clientOptions(database, ctx.tenant.id),
  ]);
  const visible = status ? rows.filter((r) => r.proposal.status === status) : rows;

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t("proposals.title")}
        description={t("proposals.sub")}
        actions={
          hasPermission(ctx, "proposals.write") ? (
            <ButtonLink href={tenantHref(tenant, "proposals/new")}>{t("proposals.new")}</ButtonLink>
          ) : null
        }
        className="mb-2"
      />
      <FilterBar>
        <FilterSelect
          name="status"
          label={t("form.status")}
          value={status}
          options={STATUSES.map((s) => ({ value: s, label: t(`proposals.status.${s}`) }))}
        />
        <FilterSelect name="client" label={t("team.client")} value={clientId} options={clients} />
      </FilterBar>
      {visible.length === 0 ? (
        <EmptyState title={t("proposals.none")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("invoices.number")}</TableHead>
              <TableHead>{t("proposals.titleField")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("team.client")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("form.status")}</TableHead>
              <TableHead className="text-right">{t("items.total")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map(({ proposal: p, clientName }) => (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap">
                  <Link
                    href={tenantHref(tenant, `proposals/${p.id}`)}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {p.number}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-normal">{p.title}</TableCell>
                <TableCell className="hidden md:table-cell">{clientName}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <StatusBadge status={p.status} label={t(`proposals.status.${p.status}`)} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{f.money(p.totalMinor, p.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
