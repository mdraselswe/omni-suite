import { notFound } from "next/navigation";
import { param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { ActionButton } from "@/components/form/action-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/data/status-badge";
import { ButtonLink } from "@/components/ui/button-link";
import { displayStatus, getInvoice, PrintButton } from "@/features/invoices";
import { canPayOnline, payInvoiceAction } from "@/features/payments";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { db } from "@/server/db";
import { LineItemsTable } from "../../_components/line-items-table";
import { portalPage } from "../../_components/portal";

export default async function PortalInvoice({
  params,
  searchParams,
}: PageProps<"/[tenant]/portal/invoices/[invoiceId]">) {
  const { tenant, invoiceId } = await params;
  const sp = await searchParams;
  const { ctx, clientId } = await portalPage(tenant, "portal.invoices");
  if (!/^[0-9a-f-]{36}$/.test(invoiceId)) notFound();
  const row = await getInvoice(db(), ctx.tenant.id, invoiceId);
  // Only the client's own invoices, and never drafts.
  if (!row || row.invoice.clientId !== clientId || row.invoice.status === "draft") notFound();

  const { invoice, client, payments } = row;
  const f = formatters(ctx);
  const money = (m: bigint) => f.money(m, invoice.currency);
  const settings = ctx.tenant.settings;
  const status = displayStatus(invoice, today(settings.timezone));
  const business = settings.branding.displayName || ctx.tenant.name;
  const balance = invoice.totalMinor - invoice.paidMinor;
  const payable =
    (invoice.status === "sent" || invoice.status === "partially_paid") &&
    balance > 0n &&
    (await canPayOnline(db(), ctx.tenant.id, invoice.currency));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <ButtonLink href={tenantHref(tenant, "portal/invoices")} variant="ghost" size="sm" className="-ml-2">
          {t("portal.backToList")}
        </ButtonLink>
        <div className="flex flex-wrap items-center gap-2">
          {payable ? (
            <ActionButton
              action={payInvoiceAction.bind(null, tenant)}
              values={{ invoiceId: invoice.id }}
              variant="default"
              size="default"
            >
              {t("payments.payOnline", { amount: money(balance) })}
            </ActionButton>
          ) : null}
          <PrintButton />
        </div>
      </div>
      {param(sp, "paid") ? (
        <Alert className="print:hidden">
          <AlertDescription>{t("payments.paidNotice")}</AlertDescription>
        </Alert>
      ) : param(sp, "cancelled") ? (
        <Alert className="print:hidden">
          <AlertDescription>{t("payments.cancelledNotice")}</AlertDescription>
        </Alert>
      ) : null}
      {payable ? (
        <p className="-mt-4 text-xs text-muted-foreground print:hidden">{t("payments.secure")}</p>
      ) : null}

      <article className="grid gap-6 surface p-4 sm:p-8 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <p className="font-heading text-xl font-semibold">{business}</p>
            {settings.tax.registrationNumber ? (
              <p className="text-sm text-muted-foreground">
                {t("invoices.abn")} {settings.tax.registrationNumber}
              </p>
            ) : null}
          </div>
          <div className="grid gap-1 text-right">
            <h1 className="font-heading text-2xl font-semibold">{t("invoices.taxInvoice")}</h1>
            <p className="font-medium">{invoice.number}</p>
            <StatusBadge status={status} label={t(`invoices.status.${status}`)} />
          </div>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-0.5 text-sm">
            <p className="text-xs font-medium text-muted-foreground">{t("invoices.billTo")}</p>
            <p className="font-medium">{client.name}</p>
            {client.address ? <p className="whitespace-pre-line">{client.address}</p> : null}
            {client.email ? <p>{client.email}</p> : null}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:justify-self-end">
            <dt className="text-muted-foreground">{t("invoices.issueDate")}</dt>
            <dd>{f.date(invoice.issueDate)}</dd>
            <dt className="text-muted-foreground">{t("invoices.dueDate")}</dt>
            <dd>{f.date(invoice.dueDate)}</dd>
          </dl>
        </div>

        <LineItemsTable
          items={invoice.items}
          money={money}
          subtotalMinor={invoice.subtotalMinor}
          taxMinor={invoice.taxMinor}
          totalMinor={invoice.totalMinor}
          taxName={settings.tax.name}
          pricesIncludeTax={settings.tax.pricesIncludeTax}
        />

        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm sm:ml-auto sm:w-72">
          <dt>{t("invoices.paid")}</dt>
          <dd className="text-right tabular-nums">{money(invoice.paidMinor)}</dd>
          <dt className="font-semibold">{t("invoices.balance")}</dt>
          <dd className="text-right font-semibold tabular-nums">
            {money(invoice.totalMinor - invoice.paidMinor)}
          </dd>
        </dl>

        {payments.length > 0 ? (
          <section className="grid gap-2 text-sm">
            <h2 className="font-semibold">{t("invoices.payments")}</h2>
            <ul className="grid gap-1">
              {payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-4">
                  <span>{f.date(p.date)}</span>
                  <span className="tabular-nums">{money(p.amountMinor)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {invoice.notes ? <p className="text-sm whitespace-pre-line">{invoice.notes}</p> : null}
        {settings.invoiceFooter ? (
          <footer className="border-t pt-4 text-sm whitespace-pre-line text-muted-foreground">
            {settings.invoiceFooter}
          </footer>
        ) : null}
      </article>
    </div>
  );
}
