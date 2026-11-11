import Link from "next/link";
import { FilterBar, FilterSearch, FilterSelect, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { EmptyState, Section, StatCard } from "@/components/layout/page";
import { ButtonLink } from "@/components/ui/button-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { displayStatus, listInvoices, receivables, type InvoiceStatus } from "@/features/invoices";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { clientOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

const STATUSES = ["draft", "sent", "partially_paid", "overdue", "paid", "void"] as const;
const PAGE = 100;

export default async function InvoicesPage({ params, searchParams }: PageProps<"/[tenant]/invoices">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "invoices.read");
  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const statusParam = param(sp, "status");
  const status: InvoiceStatus | "overdue" | undefined = STATUSES.find((s) => s === statusParam);
  const clientParam = param(sp, "client");
  const clientId = /^[0-9a-f-]{36}$/.test(clientParam) ? clientParam : undefined;
  const q = param(sp, "q") || undefined;
  const limit = Math.min(Number(param(sp, "limit")) || PAGE, 2000);
  const database = db();
  const [found, owed, clients] = await Promise.all([
    listInvoices(database, ctx.tenant.id, { status, clientId, q, today: now, limit: limit + 1 }),
    receivables(database, ctx.tenant.id, now),
    clientOptions(database, ctx.tenant.id),
  ]);
  const hasMore = found.length > limit;
  const rows = found.slice(0, limit);
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ status, client: clientId, q })) if (v) next.set(k, v);
  next.set("limit", String(limit + PAGE));
  const drafts = rows.filter((r) => r.invoice.status === "draft").length;

  return (
    <div className="grid gap-8">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("dash.receivable")} value={f.money(owed.totalMinor)} />
        <StatCard
          label={t("invoices.status.overdue")}
          value={f.money(owed.overdueMinor)}
          tone={owed.overdueMinor > 0n ? "negative" : "default"}
        />
        <StatCard label={t("invoices.status.draft")} value={String(drafts)} hint={t("invoices.inList")} />
      </div>

      <Section
        title={t("invoices.title")}
        actions={
          hasPermission(ctx, "invoices.write") ? (
            <ButtonLink href={tenantHref(tenant, "invoices/new")}>{t("invoices.new")}</ButtonLink>
          ) : null
        }
      >
        <FilterBar>
          <FilterSelect
            name="status"
            label={t("form.status")}
            value={status}
            options={STATUSES.map((s) => ({ value: s, label: t(`invoices.status.${s}`) }))}
          />
          <FilterSelect name="client" label={t("team.client")} value={clientId} options={clients} />
          <FilterSearch value={q} />
        </FilterBar>

        {rows.length === 0 ? (
          <EmptyState title={t("invoices.none")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("invoices.number")}</TableHead>
                <TableHead>{t("team.client")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("invoices.issueDate")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("invoices.dueDate")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("form.status")}</TableHead>
                <TableHead className="hidden text-right lg:table-cell">{t("items.total")}</TableHead>
                <TableHead className="text-right">{t("invoices.balance")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ invoice: inv, clientName }) => {
                const shown = displayStatus(inv, now);
                const balance = inv.status === "void" ? 0n : inv.totalMinor - inv.paidMinor;
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="whitespace-nowrap">
                      <Link
                        href={tenantHref(tenant, `invoices/${inv.id}`)}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {inv.number}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-normal">{clientName}</TableCell>
                    <TableCell className="hidden whitespace-nowrap md:table-cell">
                      {f.date(inv.issueDate)}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap md:table-cell">
                      {f.date(inv.dueDate)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <StatusBadge status={shown} label={t(`invoices.status.${shown}`)} />
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {f.money(inv.totalMinor, inv.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.money(balance, inv.currency)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {hasMore ? (
          <ButtonLink
            href={tenantHref(tenant, `invoices?${next.toString()}`)}
            variant="outline"
            className="justify-self-center"
          >
            {t("finance.loadMore")}
          </ButtonLink>
        ) : null}
      </Section>
    </div>
  );
}
