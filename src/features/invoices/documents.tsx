import type { formatters } from "@/components/data/format";
import { t } from "@/i18n";
import type { clients, invoiceAdjustments, invoices } from "@/server/db/schema";
import type { TenantContext } from "@/server/tenancy/context";
import { DocumentLines } from "./document-lines";
import { invoiceBalance } from "./service";

type Settings = TenantContext["tenant"]["settings"];
type Common = {
  client: typeof clients.$inferSelect;
  settings: Settings;
  business: string;
  f: ReturnType<typeof formatters>;
};

const sheet =
  "grid gap-8 surface p-6 text-card-foreground sm:p-10 print:border-0 print:p-0 print:shadow-none";

function Letterhead({
  business,
  settings,
  heading,
  number,
  flag,
}: {
  business: string;
  settings: Settings;
  heading: string;
  number: string;
  flag?: string | null;
}) {
  const abn = settings.tax.registrationNumber;
  return (
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
        <h1 className="font-heading text-2xl font-semibold tracking-tight uppercase">{heading}</h1>
        <p className="text-sm tabular-nums">{number}</p>
        {flag ? <p className="text-sm font-semibold text-destructive uppercase">{flag}</p> : null}
      </div>
    </header>
  );
}

function BillTo({ client }: { client: typeof clients.$inferSelect }) {
  return (
    <div className="grid gap-1 text-sm">
      <p className="text-xs font-medium text-muted-foreground uppercase">{t("invoices.billTo")}</p>
      <p className="font-medium">{client.name}</p>
      {client.address ? <p className="whitespace-pre-line">{client.address}</p> : null}
      {client.billingEmail || client.email ? <p>{client.billingEmail || client.email}</p> : null}
    </div>
  );
}

/** The invoice as the client sees it on paper: print page, portal and the shared link. */
export function InvoiceDocument({
  inv,
  client,
  settings,
  business,
  f,
}: Common & { inv: typeof invoices.$inferSelect }) {
  const settled = inv.paidMinor > 0n || inv.writtenOffMinor > 0n || inv.creditedMinor > 0n;
  return (
    <article className={sheet}>
      <Letterhead
        business={business}
        settings={settings}
        heading={settings.tax.registrationNumber ? t("invoices.taxInvoice") : t("invoices.invoiceHeading")}
        number={inv.number}
        flag={inv.status === "draft" || inv.status === "void" ? t(`invoices.status.${inv.status}`) : null}
      />
      <section className="grid gap-6 sm:grid-cols-2">
        <BillTo client={client} />
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
          inv.status !== "void" && settled
            ? [
                { label: t("invoices.paid"), amount: inv.paidMinor },
                ...(inv.writtenOffMinor > 0n
                  ? [{ label: t("invoices.writtenOff"), amount: inv.writtenOffMinor }]
                  : []),
                ...(inv.creditedMinor > 0n
                  ? [{ label: t("credit.credited"), amount: inv.creditedMinor }]
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
  );
}

/** A printable credit note (an adjustment note for GST): what was credited, why, and any refund. */
export function CreditNoteDocument({
  note,
  inv,
  client,
  settings,
  business,
  f,
}: Common & { note: typeof invoiceAdjustments.$inferSelect; inv: typeof invoices.$inferSelect }) {
  const money = (minor: bigint) => f.money(minor, inv.currency);
  return (
    <article className={sheet}>
      <Letterhead
        business={business}
        settings={settings}
        heading={t("credit.document")}
        number={note.number ?? ""}
        flag={note.voidedAt ? t("credit.voidedLabel") : null}
      />
      <section className="grid gap-6 sm:grid-cols-2">
        <BillTo client={client} />
        <dl className="grid content-start gap-1 text-sm sm:justify-items-end">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t("credit.date")}</dt>
            <dd>{f.date(note.date)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t("credit.forInvoice", { number: inv.number })}</dt>
            <dd>{f.date(inv.issueDate)}</dd>
          </div>
        </dl>
      </section>
      <section className="grid gap-2 text-sm">
        <p className="text-xs font-medium text-muted-foreground uppercase">{t("credit.reasonHeading")}</p>
        <p className="whitespace-pre-line">{note.reason}</p>
      </section>
      <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
        <div className="flex justify-between gap-4 text-base font-semibold">
          <dt>{t("credit.total")}</dt>
          <dd className="tabular-nums">{money(note.amountMinor)}</dd>
        </div>
        {note.taxMinor > 0n ? (
          <div className="flex justify-between gap-4 text-muted-foreground">
            <dt>{t("credit.taxInside", { tax: settings.tax.name })}</dt>
            <dd className="tabular-nums">{money(note.taxMinor)}</dd>
          </div>
        ) : null}
        {note.refundedMinor > 0n ? (
          <div className="flex justify-between gap-4">
            <dt>{t("credit.refundedHeading")}</dt>
            <dd className="tabular-nums">{money(note.refundedMinor)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt>{t("credit.balanceNow", { number: inv.number })}</dt>
          <dd className="tabular-nums">{money(invoiceBalance(inv))}</dd>
        </div>
      </dl>
      {settings.invoiceFooter ? (
        <footer className="border-t pt-4 text-sm whitespace-pre-line text-muted-foreground">
          {settings.invoiceFooter}
        </footer>
      ) : null}
    </article>
  );
}
