import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { CheckboxField, TextAreaField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { DocumentLines, PrintButton } from "@/features/invoices";
import { proposalDisplayStatus, ProposalStatusBadge } from "@/features/proposals";
import { respondSharedProposalAction, sharedProposal } from "@/features/sharing";
import { t } from "@/i18n";
import { formatDateTime, today } from "@/lib/dates";
import { db } from "@/server/db";

// A private link: never indexed, and the token is not sent on to other sites.
export const metadata: Metadata = {
  title: t("share.metaProposalPlain"),
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** A proposal opened from the email link, without signing in: read it, accept or decline. */
export default async function SharedProposalPage({ params }: PageProps<"/p/proposal/[token]">) {
  const { token } = await params;
  const shared = await sharedProposal(db(), token);
  if (!shared) notFound();
  const { tenant, proposal, client } = shared;
  const f = formatters({ tenant });
  const settings = tenant.settings;
  const status = proposalDisplayStatus(proposal, today(settings.timezone));
  const expired = status === "expired";
  const business = settings.branding.displayName || tenant.name;
  const respond = respondSharedProposalAction.bind(null, token);

  return (
    <main id="content" className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8 sm:py-12 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-muted-foreground">{t("share.from", { business })}</p>
        <PrintButton />
      </div>

      <article className="grid gap-6 surface p-4 sm:p-8 print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <p className="text-sm text-muted-foreground">{business}</p>
            <h1 className="font-heading text-2xl font-semibold">{proposal.title}</h1>
            <p className="text-sm text-muted-foreground">
              {proposal.number} · {client.name}
            </p>
          </div>
          <div className="grid justify-items-start gap-1 text-sm sm:justify-items-end">
            <ProposalStatusBadge status={status} />
            {proposal.validUntil ? (
              <span className={expired ? "text-destructive" : "text-muted-foreground"}>
                {t("proposals.validUntil")}: {f.date(proposal.validUntil)}
              </span>
            ) : null}
          </div>
        </header>

        {proposal.intro ? <p className="text-sm whitespace-pre-line">{proposal.intro}</p> : null}

        <DocumentLines
          items={proposal.items}
          currency={proposal.currency}
          locale={settings.locale}
          pricesIncludeTax={proposal.pricesIncludeTax}
          taxName={settings.tax.name}
          totals={proposal}
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

      {expired && proposal.validUntil ? (
        <p role="status" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {t("proposals.expiredOn", { date: f.date(proposal.validUntil), business })}
        </p>
      ) : null}

      {status === "sent" ? (
        <section aria-labelledby="respond-heading" className="grid gap-3 print:hidden">
          <div className="grid gap-1">
            <h2 id="respond-heading" className="font-heading text-lg font-semibold">
              {t("portal.respondTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("portal.respondHint")}</p>
          </div>
          <div className="grid gap-4 surface p-4 sm:max-w-md">
            <ActionForm action={respond}>
              <input type="hidden" name="decision" value="accept" />
              <TextField name="name" label={t("proposals.yourName")} autoComplete="name" required />
              {proposal.terms.trim() ? (
                <CheckboxField name="acceptTerms" label={t("proposals.acceptTerms")} />
              ) : null}
              <SubmitButton className="justify-self-start" pendingLabel={t("form.saving")}>
                {t("proposals.accept")}
              </SubmitButton>
            </ActionForm>
            <div className="border-t pt-4">
              <FormDialog
                trigger={t("proposals.declineOpen")}
                title={t("proposals.declineDialog")}
                description={t("proposals.declineDialogSub", { business })}
                action={respond}
                submitLabel={t("proposals.declineSubmit")}
                variant="outline"
                icon={false}
              >
                <input type="hidden" name="decision" value="decline" />
                <TextField name="name" label={t("proposals.yourName")} autoComplete="name" required />
                <TextAreaField name="reason" label={t("proposals.declineReason")} rows={3} maxLength={1000} />
              </FormDialog>
            </div>
          </div>
        </section>
      ) : null}
      <p className="text-xs text-muted-foreground print:hidden">{t("share.private")}</p>
    </main>
  );
}
