import Link from "next/link";
import { formatters } from "@/components/data/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/layout/page";
import { ButtonLink } from "@/components/ui/button-link";
import { onboardingForClient } from "@/features/clients";
import { listInvoices } from "@/features/invoices";
import { listProjects, listTasks } from "@/features/projects";
import { listProposals } from "@/features/proposals";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { db } from "@/server/db";
import { hasPermission } from "@/server/tenancy/context";
import { portalPage } from "./_components/portal";

function when<T>(allowed: boolean, fn: () => Promise<T>): Promise<T | null> {
  return allowed ? fn() : Promise.resolve(null);
}

export default async function PortalHome({ params }: PageProps<"/[tenant]/portal">) {
  const { tenant } = await params;
  const { ctx, clientId } = await portalPage(tenant, "portal.access");
  const f = formatters(ctx);
  const database = db();
  const can = (p: string) => hasPermission(ctx, p);
  const doneStatuses = new Set(ctx.tenant.settings.projectStatuses.filter((s) => s.done).map((s) => s.key));

  const [projects, invoices, proposals, onboarding] = await Promise.all([
    when(can("portal.projects"), () => listProjects(database, ctx, "all")),
    when(can("portal.invoices"), () => listInvoices(database, ctx.tenant.id, { clientId, portal: true })),
    when(can("portal.proposals"), () => listProposals(database, ctx.tenant.id, { clientId, portal: true })),
    when(can("portal.onboarding"), () => onboardingForClient(database, ctx.tenant.id, clientId)),
  ]);
  const active = (projects ?? []).filter((p) => !doneStatuses.has(p.status));
  const awaiting = can("portal.approve")
    ? (await Promise.all(active.map((p) => listTasks(database, ctx, p.id))))
        .flat()
        .filter(({ task }) => task.needsApproval && task.status === "review" && !task.approvedAt)
    : [];
  const unpaid = (invoices ?? []).filter(
    (r) => r.invoice.status === "sent" || r.invoice.status === "partially_paid",
  );
  const dueMinor = unpaid.reduce((sum, r) => sum + r.invoice.totalMinor - r.invoice.paidMinor, 0n);
  const openProposals = (proposals ?? []).filter((r) => r.proposal.status === "sent");
  const openOnboarding = (onboarding ?? []).find((o) => o.status === "sent");
  const now = today(ctx.tenant.settings.timezone);

  return (
    <div className="grid gap-8">
      <PageHeader
        title={t("portal.welcome", { name: ctx.user.name })}
        description={t("portal.sub", {
          business: ctx.tenant.settings.branding.displayName || ctx.tenant.name,
        })}
      />

      {openOnboarding ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t("portal.onboardingDue")}</span>
            <ButtonLink href={tenantHref(tenant, "portal/onboarding")} size="sm">
              {t("portal.openOnboarding")}
            </ButtonLink>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {projects ? <StatCard label={t("portal.openProjects")} value={String(active.length)} /> : null}
        {invoices ? (
          <StatCard
            label={t("portal.amountDue")}
            value={f.money(dueMinor)}
            hint={t("portal.dueInvoices")}
            tone={unpaid.some((r) => r.invoice.dueDate < now) ? "negative" : "default"}
          />
        ) : null}
        {can("portal.approve") ? (
          <StatCard label={t("portal.awaiting")} value={String(awaiting.length)} />
        ) : null}
        {proposals ? (
          <StatCard label={t("portal.pendingProposals")} value={String(openProposals.length)} />
        ) : null}
      </div>

      {awaiting.length > 0 ? (
        <Section title={t("portal.awaiting")}>
          <ul className="divide-y rounded-lg border bg-card">
            {awaiting.map(({ task }) => (
              <li key={task.id}>
                <Link
                  href={tenantHref(tenant, `portal/projects/${task.projectId}`)}
                  className="block px-4 py-3 text-sm font-medium hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  {task.title}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        {projects ? (
          <Section title={t("portal.openProjects")}>
            {active.length === 0 ? (
              <EmptyState title={t("portal.nothing")} />
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {active.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={tenantHref(tenant, `portal/projects/${p.id}`)}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("portal.progress", { done: p.doneCount, total: p.taskCount })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}

        {invoices ? (
          <Section title={t("portal.dueInvoices")}>
            {unpaid.length === 0 ? (
              <EmptyState title={t("portal.allPaid")} />
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {unpaid.map(({ invoice }) => (
                  <li key={invoice.id}>
                    <Link
                      href={tenantHref(tenant, `portal/invoices/${invoice.id}`)}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <span className="grid">
                        <span className="font-medium">{invoice.number}</span>
                        <span
                          className={
                            invoice.dueDate < now
                              ? "text-xs text-destructive"
                              : "text-xs text-muted-foreground"
                          }
                        >
                          {t("portal.due", { date: f.date(invoice.dueDate) })}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {f.money(invoice.totalMinor - invoice.paidMinor, invoice.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}

        {openProposals.length > 0 ? (
          <Section title={t("portal.pendingProposals")}>
            <ul className="divide-y rounded-lg border bg-card">
              {openProposals.map(({ proposal }) => (
                <li key={proposal.id}>
                  <Link
                    href={tenantHref(tenant, `portal/proposals/${proposal.id}`)}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span className="font-medium">{proposal.title}</span>
                    <span className="tabular-nums">{f.money(proposal.totalMinor, proposal.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
