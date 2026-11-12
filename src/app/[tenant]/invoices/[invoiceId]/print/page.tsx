import Link from "next/link";
import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { DocumentLines, getInvoice, invoiceBalance, PrintButton } from "@/features/invoices";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

/** Clean printable invoice: use the browser's Print → Save as PDF. */
export default async function PrintInvoicePage({
  params,
}: PageProps<"/[tenant]/invoices/[invoiceId]/print">) {
  const { tenant, invoiceId } = await params;
  const { ctx } = await requireTenantPermission(tenant, "invoices.read");
  const row = await getInvoice(db(), ctx.tenant.id, invoiceId);
  if (!row) notFound();
  const { invoice: inv, client } = row;
  const f = formatters(ctx);
  const settings = ctx.tenant.settings;
  const business = settings.branding.displayName || ctx.tenant.name;
  const abn = settings.tax.registrationNumber;

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href={tenantHref(tenant, `invoices/${inv.id}`)}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {inv.number}
        </Link>
        <PrintButton />
      </div>

      <article className="grid gap-8 surface p-6 text-card-foreground sm:p-10 print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="grid gap-1">
            <p className="font-heading text-xl font-semibold">{business}</p>
            {abn ? (
              <p className="text-sm text-muted-foreground">
                {t("invoices.abn")} {abn}
              </p>
            ) : null}
          </div>
          <div className="grid gap-1 text-right">
            <h1 className="font-heading text-2xl font-semibold tracking-tight uppercase">
              {abn ? t("invoices.taxInvoice") : t("invoices.invoiceHeading")}
            </h1>
            <p className="text-sm tabular-nums">{inv.number}</p>
            {inv.status === "draft" || inv.status === "void" ? (
              <p className="text-sm font-semibold text-destructive uppercase">
                {t(`invoices.status.${inv.status}`)}
              </p>
            ) : null}
          </div>
        </header>

        <section className="grid gap-6 sm:grid-cols-2">
          <div className="grid gap-1 text-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase">{t("invoices.billTo")}</p>
            <p className="font-medium">{client.name}</p>
            {client.address ? <p className="whitespace-pre-line">{client.address}</p> : null}
            {client.billingEmail || client.email ? <p>{client.billingEmail || client.email}</p> : null}
          </div>
          <dl className="grid content-start gap-1 text-sm sm:justify-items-end">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t("invoices.issueDate")}</dt>
              <dd>{f.date(inv.issueDate)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t("invoices.dueDate")}</dt>
              <dd>{f.date(inv.dueDate)}</dd>
            </div>
          </dl>
        </section>

        <DocumentLines
          items={inv.items}
          currency={inv.currency}
          locale={settings.locale}
          pricesIncludeTax={inv.pricesIncludeTax}
          taxName={settings.tax.name}
          totals={inv}
          extra={
            inv.status !== "void" && (inv.paidMinor > 0n || inv.writtenOffMinor > 0n)
              ? [
                  { label: t("invoices.paid"), amount: inv.paidMinor },
                  ...(inv.writtenOffMinor > 0n
                    ? [{ label: t("invoices.writtenOff"), amount: inv.writtenOffMinor }]
                    : []),
                  { label: t("invoices.balance"), amount: invoiceBalance(inv), strong: true },
                ]
              : []
          }
        />

        {inv.notes ? <p className="text-sm whitespace-pre-line">{inv.notes}</p> : null}
        {settings.invoiceFooter ? (
          <footer className="border-t pt-4 text-sm whitespace-pre-line text-muted-foreground">
            {settings.invoiceFooter}
          </footer>
        ) : null}
      </article>
    </div>
  );
}
