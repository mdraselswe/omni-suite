import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { ActionButton } from "@/components/form/action-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { InvoiceDocument, PrintButton } from "@/features/invoices";
import { paySharedInvoiceAction, sharedInvoice } from "@/features/sharing";
import { t } from "@/i18n";
import { db } from "@/server/db";

// A private link: never indexed, and the token is not sent on to other sites.
export const metadata: Metadata = {
  title: t("invoices.invoiceHeading"),
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** An invoice opened from the email link, without signing in: view, print, pay online. */
export default async function SharedInvoicePage({ params, searchParams }: PageProps<"/p/invoice/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const shared = await sharedInvoice(db(), token);
  if (!shared) notFound();
  const { tenant, invoice, client, payments, balance, payable } = shared;
  const f = formatters({ tenant });
  const settings = tenant.settings;
  const business = settings.branding.displayName || tenant.name;
  const isPaid = invoice.status === "paid";
  const lastPaid = payments.reduce<string | null>((last, p) => (last && last > p.date ? last : p.date), null);

  return (
    <main id="content" className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-8 sm:py-12 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-muted-foreground">{t("share.from", { business })}</p>
        <div className="flex flex-wrap items-center gap-2">
          {payable ? (
            <ActionButton action={paySharedInvoiceAction.bind(null, token)} variant="default" size="default">
              {t("payments.payOnline", { amount: f.money(balance, invoice.currency) })}
            </ActionButton>
          ) : null}
          <PrintButton />
        </div>
      </div>
      {payable ? (
        <p className="-mt-2 text-xs text-muted-foreground print:hidden">{t("payments.secure")}</p>
      ) : null}
      {param(sp, "paid") ? (
        <Alert className="print:hidden" role="status">
          <AlertDescription>
            {/* Back from the payment page: the payment webhook may not have landed yet. */}
            {isPaid ? t("portalWork.paymentReceived") : t("payments.paidNotice")}
          </AlertDescription>
        </Alert>
      ) : param(sp, "cancelled") ? (
        <Alert className="print:hidden">
          <AlertDescription>{t("payments.cancelledNotice")}</AlertDescription>
        </Alert>
      ) : null}
      {invoice.status === "void" ? (
        <Alert className="print:hidden">
          <AlertDescription>{t("portalWork.voidNotice")}</AlertDescription>
        </Alert>
      ) : isPaid ? (
        <Alert className="print:hidden">
          <AlertDescription className="font-medium">
            {lastPaid ? t("portalWork.paidInFull", { date: f.date(lastPaid) }) : t("portalWork.settled")}
          </AlertDescription>
        </Alert>
      ) : null}
      <InvoiceDocument inv={invoice} client={client} settings={settings} business={business} f={f} />
      <p className="text-xs text-muted-foreground print:hidden">{t("share.private")}</p>
    </main>
  );
}
