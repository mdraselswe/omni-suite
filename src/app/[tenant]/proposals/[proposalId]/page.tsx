import Link from "next/link";
import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionButton } from "@/components/form/action-button";
import { FormDialog } from "@/components/form/form-dialog";
import { DocumentLines } from "@/features/invoices";
import {
  getProposal,
  ProposalFields,
  proposalToInvoiceAction,
  sendProposalAction,
  updateProposalAction,
} from "@/features/proposals";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
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
  const clients = canWrite && p.status === "draft" ? await clientOptions(database, ctx.tenant.id) : [];

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <Link
            href={tenantHref(tenant, "proposals")}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {t("proposals.title")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{p.number}</h1>
            <StatusBadge status={p.status} label={t(`proposals.status.${p.status}`)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
          {p.status === "accepted" && hasPermission(ctx, "invoices.write") ? (
            <ActionButton
              action={proposalToInvoiceAction.bind(null, tenant)}
              values={{ id: p.id }}
              variant="default"
              size="default"
            >
              {t("proposals.toInvoice")}
            </ActionButton>
          ) : null}
        </div>
      </div>

      {p.respondedAt && p.respondedByName ? (
        <p className="rounded-md border bg-muted/50 p-3 text-sm">
          {t("proposals.respondedBy", {
            status: t(`proposals.status.${p.status}`),
            name: p.respondedByName,
            date: formatDateTime(p.respondedAt, settings.timezone, settings.locale),
          })}
        </p>
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
          pricesIncludeTax={settings.tax.pricesIncludeTax}
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
