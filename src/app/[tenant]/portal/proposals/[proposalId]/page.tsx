import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionButton } from "@/components/form/action-button";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { TextField } from "@/components/form/field";
import { Section } from "@/components/layout/page";
import { ButtonLink } from "@/components/ui/button-link";
import { getProposal, respondProposalAction } from "@/features/proposals";
import { t } from "@/i18n";
import { formatDateTime, today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { db } from "@/server/db";
import { LineItemsTable } from "../../_components/line-items-table";
import { portalPage } from "../../_components/portal";

export default async function PortalProposal({
  params,
}: PageProps<"/[tenant]/portal/proposals/[proposalId]">) {
  const { tenant, proposalId } = await params;
  const { ctx, clientId } = await portalPage(tenant, "portal.proposals");
  if (!/^[0-9a-f-]{36}$/.test(proposalId)) notFound();
  const row = await getProposal(db(), ctx.tenant.id, proposalId);
  if (!row || row.proposal.clientId !== clientId || row.proposal.status === "draft") notFound();

  const { proposal, client } = row;
  const f = formatters(ctx);
  const settings = ctx.tenant.settings;
  const now = today(settings.timezone);
  const expired = proposal.validUntil !== null && proposal.validUntil < now;
  const open = proposal.status === "sent" && !expired;
  const respond = respondProposalAction.bind(null, tenant);

  return (
    <div className="grid gap-6">
      <ButtonLink
        href={tenantHref(tenant, "portal/proposals")}
        variant="ghost"
        size="sm"
        className="-ml-2 justify-self-start"
      >
        {t("portal.backToList")}
      </ButtonLink>

      <article className="grid gap-6 surface p-4 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <p className="text-sm text-muted-foreground">
              {settings.branding.displayName || ctx.tenant.name}
            </p>
            <h1 className="font-heading text-2xl font-semibold">{proposal.title}</h1>
            <p className="text-sm text-muted-foreground">
              {proposal.number} · {client.name}
            </p>
          </div>
          <div className="grid justify-items-end gap-1 text-sm">
            <StatusBadge status={proposal.status} label={t(`proposals.status.${proposal.status}`)} />
            {proposal.validUntil ? (
              <span className={expired ? "text-destructive" : "text-muted-foreground"}>
                {t("proposals.validUntil")}: {f.date(proposal.validUntil)}
              </span>
            ) : null}
          </div>
        </header>

        {proposal.intro ? <p className="text-sm whitespace-pre-line">{proposal.intro}</p> : null}

        <LineItemsTable
          items={proposal.items}
          money={(m) => f.money(m, proposal.currency)}
          subtotalMinor={proposal.subtotalMinor}
          taxMinor={proposal.taxMinor}
          totalMinor={proposal.totalMinor}
          taxName={settings.tax.name}
          pricesIncludeTax={settings.tax.pricesIncludeTax}
        />

        {proposal.terms ? (
          <section className="grid gap-1 text-sm">
            <h2 className="font-semibold">{t("proposals.terms")}</h2>
            <p className="whitespace-pre-line text-muted-foreground">{proposal.terms}</p>
          </section>
        ) : null}

        {proposal.respondedAt && proposal.respondedByName ? (
          <p className="border-t pt-4 text-sm text-muted-foreground">
            {t("proposals.respondedBy", {
              status: t(`proposals.status.${proposal.status}`),
              name: proposal.respondedByName,
              date: formatDateTime(proposal.respondedAt, settings.timezone, settings.locale),
            })}
          </p>
        ) : null}
      </article>

      {proposal.status === "sent" && expired ? (
        <p className="text-sm text-destructive">{t("proposals.expired")}</p>
      ) : null}

      {open ? (
        <Section title={t("portal.respondTitle")} description={t("portal.respondHint")}>
          <div className="grid gap-4 surface p-4 sm:max-w-md">
            <ActionForm action={respond}>
              <input type="hidden" name="id" value={proposal.id} />
              <input type="hidden" name="decision" value="accept" />
              <TextField
                name="name"
                label={t("proposals.yourName")}
                defaultValue={ctx.user.name}
                autoComplete="name"
                required
              />
              <SubmitButton className="justify-self-start">{t("proposals.accept")}</SubmitButton>
            </ActionForm>
            <ActionButton
              action={respond}
              values={{ id: proposal.id, decision: "decline", name: ctx.user.name }}
              variant="outline"
              confirm={t("form.confirm")}
            >
              {t("proposals.decline")}
            </ActionButton>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
