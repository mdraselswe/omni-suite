import Link from "next/link";
import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { ActionButton } from "@/components/form/action-button";
import { TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { ButtonLink } from "@/components/ui/button-link";
import { canUseAi } from "@/features/ai";
import { DocumentLines, PrintButton } from "@/features/invoices";
import {
  deleteProposalAction,
  extendProposalAction,
  getProposal,
  projectForProposal,
  proposalBilling,
  proposalDisplayStatus,
  ProposalFields,
  ProposalStatusBadge,
  proposalToInvoiceAction,
  proposalToProjectAction,
  reopenProposalAction,
  sendProposalAction,
  updateProposalAction,
} from "@/features/proposals";
import { t } from "@/i18n";
import { addDays, formatDateTime, today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { clientOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

export default async function ProposalPage({ params }: PageProps<"/[tenant]/proposals/[proposalId]">) {
  const { tenant, proposalId } = await params;
  const { ctx } = await requireTenantPermission(tenant, "proposals.read");
  const database = db();
  const row = await getProposal(database, ctx.tenant.id, proposalId);
  if (!row) notFound();
  const { proposal: p, client } = row;
  const f = formatters(ctx);
  const settings = ctx.tenant.settings;
  const canWrite = hasPermission(ctx, "proposals.write");
  const accepted = p.status === "accepted";
  const now = today(settings.timezone);
  const status = proposalDisplayStatus(p, now);
  const [clients, billing, project] = await Promise.all([
    canWrite && p.status === "draft" ? clientOptions(database, ctx.tenant.id) : Promise.resolve([]),
    accepted ? proposalBilling(database, ctx.tenant.id, p) : Promise.resolve(null),
    accepted ? projectForProposal(database, ctx.tenant.id, p.id) : Promise.resolve(null),
  ]);
  const canInvoice = accepted && hasPermission(ctx, "invoices.write");
  const canStartProject = accepted && !project && hasPermission(ctx, "projects.write");

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <Link
            href={tenantHref(tenant, "proposals")}
            className="text-sm text-muted-foreground hover:underline print:hidden"
          >
            ← {t("proposals.title")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{p.number}</h1>
            <ProposalStatusBadge status={status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintButton />
          {canWrite && p.status === "draft" ? (
            <ActionButton
              action={deleteProposalAction.bind(null, tenant)}
              values={{ id: p.id }}
              variant="outline"
              size="default"
              confirm={t("proposals.deleteConfirm")}
            >
              {t("form.delete")}
            </ActionButton>
          ) : null}
          {canWrite && (p.status === "sent" || p.status === "declined") ? (
            <ActionButton
              action={reopenProposalAction.bind(null, tenant)}
              values={{ id: p.id }}
              variant="outline"
              size="default"
              confirm={t("proposals.reopenConfirm")}
            >
              {t("proposals.reopen")}
            </ActionButton>
          ) : null}
          {canWrite && p.status === "sent" ? (
            <FormDialog
              trigger={t("proposals.extend")}
              title={t("proposals.extend")}
              description={t("proposals.extendSub")}
              action={extendProposalAction.bind(null, tenant)}
              variant={status === "expired" ? "default" : "outline"}
              icon={false}
            >
              <input type="hidden" name="id" value={p.id} />
              <TextField
                name="validUntil"
                type="date"
                label={t("proposals.extendDate")}
                min={now}
                defaultValue={p.validUntil && p.validUntil > now ? p.validUntil : addDays(now, 14)}
                required
              />
            </FormDialog>
          ) : null}
          {canWrite && p.status === "draft" ? (
            <>
              <FormDialog
                trigger={t("form.edit")}
                title={p.number}
                action={updateProposalAction.bind(null, tenant)}
                variant="outline"
                icon={false}
                wide
              >
                <ProposalFields
                  clients={clients}
                  settings={settings}
                  aiTenant={canUseAi(ctx) ? tenant : undefined}
                  proposal={{
                    id: p.id,
                    clientId: p.clientId,
                    title: p.title,
                    intro: p.intro,
                    terms: p.terms,
                    validUntil: p.validUntil,
                    items: p.items,
                  }}
                />
              </FormDialog>
              <ActionButton
                action={sendProposalAction.bind(null, tenant)}
                values={{ id: p.id }}
                variant="default"
                size="default"
                confirm={t("form.confirm")}
              >
                {t("proposals.send")}
              </ActionButton>
            </>
          ) : null}
          {billing?.invoices.map((inv) => (
            <ButtonLink key={inv.id} href={tenantHref(tenant, `invoices/${inv.id}`)} variant="outline">
              {t("proposals.invoicedAs", { number: inv.number })}
            </ButtonLink>
          ))}
          {project ? (
            <ButtonLink href={tenantHref(tenant, `projects/${project.id}`)} variant="outline">
              {t("proposals.openProject")}
            </ButtonLink>
          ) : null}
          {canStartProject ? (
            <ActionButton
              action={proposalToProjectAction.bind(null, tenant)}
              values={{ id: p.id }}
              variant="outline"
              size="default"
            >
              {t("proposals.startProject")}
            </ActionButton>
          ) : null}
          {canInvoice && billing && billing.invoices.length === 0 ? (
            <FormDialog
              trigger={t("proposals.invoiceDeposit")}
              title={t("proposals.invoiceDeposit")}
              description={t("proposals.invoiceDepositSub")}
              action={proposalToInvoiceAction.bind(null, tenant)}
              variant="outline"
              icon={false}
            >
              <input type="hidden" name="id" value={p.id} />
              <TextField
                name="deposit"
                label={t("proposals.depositPercent")}
                inputMode="decimal"
                defaultValue="50"
                required
              />
            </FormDialog>
          ) : null}
          {canInvoice && billing && billing.remainingMinor > 0n ? (
            <ActionButton
              action={proposalToInvoiceAction.bind(null, tenant)}
              values={{ id: p.id }}
              variant="default"
              size="default"
            >
              {billing.invoices.length === 0
                ? t("proposals.toInvoice")
                : t("proposals.invoiceRest", { amount: f.money(billing.remainingMinor, p.currency) })}
            </ActionButton>
          ) : null}
        </div>
      </div>

      {status === "expired" && p.validUntil ? (
        <p role="status" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {t("proposals.expiredStaff", { date: f.date(p.validUntil) })}
        </p>
      ) : null}

      {p.respondedAt && p.respondedByName ? (
        <div className="grid gap-1 rounded-md border bg-muted/50 p-3 text-sm">
          <p>
            {t("proposals.respondedBy", {
              status: t(`proposals.status.${p.status}`),
              name: p.respondedByName,
              date: formatDateTime(p.respondedAt, settings.timezone, settings.locale),
            })}
          </p>
          {p.status === "declined" && p.declineReason ? (
            <p className="whitespace-pre-line">
              {t("proposals.declineReasonShown", { reason: p.declineReason })}
            </p>
          ) : null}
        </div>
      ) : null}

      <article className="grid gap-6 surface p-4 sm:p-8">
        <header className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <p className="text-xs font-medium text-muted-foreground uppercase">
              {t("proposals.preparedFor")}
            </p>
            <Link
              href={tenantHref(tenant, `clients/${client.id}`)}
              className="font-medium underline-offset-4 hover:underline"
            >
              {client.name}
            </Link>
            {client.email ? <p className="text-sm text-muted-foreground">{client.email}</p> : null}
          </div>
          <dl className="grid gap-1 text-sm sm:justify-items-end">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t("proposals.created")}</dt>
              <dd>{f.date(p.createdAt.toISOString().slice(0, 10))}</dd>
            </div>
            {p.validUntil ? (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">{t("proposals.validUntil")}</dt>
                <dd>{f.date(p.validUntil)}</dd>
              </div>
            ) : null}
          </dl>
        </header>
        <h2 className="font-heading text-xl font-semibold">{p.title}</h2>
        {p.intro ? <p className="text-sm whitespace-pre-line">{p.intro}</p> : null}
        <DocumentLines
          items={p.items}
          currency={p.currency}
          locale={settings.locale}
          pricesIncludeTax={p.pricesIncludeTax}
          taxName={settings.tax.name}
          totals={p}
        />
        {p.terms ? (
          <section className="grid gap-1">
            <h3 className="text-sm font-semibold">{t("proposals.terms")}</h3>
            <p className="text-sm whitespace-pre-line text-muted-foreground">{p.terms}</p>
          </section>
        ) : null}
      </article>
    </div>
  );
}
