import Link from "next/link";
import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionButton } from "@/components/form/action-button";
import { CustomFieldValues } from "@/components/form/custom-field-inputs";
import { SelectField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { ButtonLink } from "@/components/ui/button-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { storedCustom } from "@/features/clients";
import {
  displayStatus,
  DocumentLines,
  getInvoice,
  InvoiceFields,
  recordPaymentAction,
  sendInvoiceAction,
  updateInvoiceAction,
  voidInvoiceAction,
} from "@/features/invoices";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { toDecimalString } from "@/lib/money";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { accountOptions, categoryOptions, clientOptions } from "@/server/options";
import { customFieldsFor } from "@/server/shared";
import { hasPermission } from "@/server/tenancy/context";

export default async function InvoicePage({ params }: PageProps<"/[tenant]/invoices/[invoiceId]">) {
  const { tenant, invoiceId } = await params;
  const { ctx } = await requireTenantPermission(tenant, "invoices.read");
  const database = db();
  const row = await getInvoice(database, ctx.tenant.id, invoiceId);
  if (!row) notFound();
  const { invoice: inv, client, payments } = row;
  const f = formatters(ctx);
  const settings = ctx.tenant.settings;
  const now = today(settings.timezone);
  const shown = displayStatus(inv, now);
  const balance = inv.totalMinor - inv.paidMinor;
  const canWrite = hasPermission(ctx, "invoices.write");
  const canPay =
    hasPermission(ctx, "payments.record") && (inv.status === "sent" || inv.status === "partially_paid");
  const isDraft = inv.status === "draft";
  const custom = storedCustom(inv.custom);

  const [defs, clients, accounts, categories] = await Promise.all([
    customFieldsFor(database, ctx.tenant.id, "invoice"),
    canWrite && isDraft ? clientOptions(database, ctx.tenant.id) : Promise.resolve([]),
    canPay ? accountOptions(database, ctx.tenant.id) : Promise.resolve([]),
    canPay ? categoryOptions(database, ctx.tenant.id) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <Link
            href={tenantHref(tenant, "invoices")}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {t("invoices.title")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">{inv.number}</h2>
            <StatusBadge status={shown} label={t(`invoices.status.${shown}`)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && isDraft ? (
            <>
              <FormDialog
                trigger={t("form.edit")}
                title={inv.number}
                action={updateInvoiceAction.bind(null, tenant)}
                variant="outline"
                icon={false}
                wide
              >
                <InvoiceFields
                  clients={clients}
                  settings={settings}
                  defs={defs}
                  today={now}
                  invoice={{
                    id: inv.id,
                    clientId: inv.clientId,
                    issueDate: inv.issueDate,
                    dueDate: inv.dueDate,
                    notes: inv.notes,
                    items: inv.items,
                    custom,
                  }}
                />
              </FormDialog>
              <ActionButton
                action={sendInvoiceAction.bind(null, tenant)}
                values={{ id: inv.id }}
                variant="default"
                size="default"
                confirm={t("form.confirm")}
              >
                {t("invoices.send")}
              </ActionButton>
            </>
          ) : null}
          {canPay ? (
            <FormDialog
              trigger={t("invoices.recordPayment")}
              title={t("invoices.recordPayment")}
              action={recordPaymentAction.bind(null, tenant)}
            >
              <input type="hidden" name="id" value={inv.id} />
              <TextField
                name="amount"
                label={t("finance.amount")}
                inputMode="decimal"
                defaultValue={toDecimalString(balance, inv.currency)}
                required
              />
              <TextField name="date" label={t("form.date.label")} type="date" defaultValue={now} required />
              <SelectField name="accountId" label={t("finance.account")} options={accounts} required />
              <TextField name="method" label={t("invoices.method")} placeholder={t("invoices.methodHint")} />
              <SelectField
                name="categoryId"
                label={t("finance.category")}
                options={categories
                  .filter((c) => c.kind === "income")
                  .map((c) => ({ value: c.value, label: c.name }))}
                placeholder={t("form.none")}
              />
            </FormDialog>
          ) : null}
          {inv.status !== "draft" ? (
            <ButtonLink href={tenantHref(tenant, `invoices/${inv.id}/print`)} variant="outline">
              {t("invoices.print")}
            </ButtonLink>
          ) : null}
          {canWrite ? (
            <ButtonLink href={tenantHref(tenant, `invoices/new?from=${inv.id}`)} variant="ghost">
              {t("invoices.duplicate")}
            </ButtonLink>
          ) : null}
          {canWrite && inv.status !== "void" && inv.paidMinor === 0n ? (
            <ActionButton
              action={voidInvoiceAction.bind(null, tenant)}
              values={{ id: inv.id }}
              variant="ghost"
              size="default"
              confirm={t("form.confirm")}
            >
              {t("invoices.void")}
            </ActionButton>
          ) : null}
        </div>
      </div>

      <article className="grid gap-6 surface p-4 sm:p-8">
        <header className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <p className="text-xs font-medium text-muted-foreground uppercase">{t("invoices.billTo")}</p>
            <Link
              href={tenantHref(tenant, `clients/${client.id}`)}
              className="font-medium underline-offset-4 hover:underline"
            >
              {client.name}
            </Link>
            {client.email ? <p className="text-sm text-muted-foreground">{client.email}</p> : null}
            {client.address ? (
              <p className="text-sm whitespace-pre-line text-muted-foreground">{client.address}</p>
            ) : null}
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
            {inv.proposalId ? (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">{t("invoices.fromProposal")}</dt>
                <dd>
                  <Link
                    href={tenantHref(tenant, `proposals/${inv.proposalId}`)}
                    className="underline-offset-4 hover:underline"
                  >
                    {t("form.open")}
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>
        </header>
        <DocumentLines
          items={inv.items}
          currency={inv.currency}
          locale={settings.locale}
          pricesIncludeTax={settings.tax.pricesIncludeTax}
          taxName={settings.tax.name}
          totals={inv}
          extra={
            inv.status === "void"
              ? []
              : [
                  { label: t("invoices.paid"), amount: inv.paidMinor },
                  { label: t("invoices.balance"), amount: balance, strong: true },
                ]
          }
        />
        {inv.notes ? <p className="text-sm whitespace-pre-line text-muted-foreground">{inv.notes}</p> : null}
        <CustomFieldValues defs={defs} values={custom} />
      </article>

      <Section title={t("invoices.payments")}>
        {payments.length === 0 ? (
          <EmptyState title={t("invoices.noPayments")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("form.date.label")}</TableHead>
                <TableHead>{t("invoices.method")}</TableHead>
                <TableHead className="text-right">{t("finance.amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{f.date(p.date)}</TableCell>
                  <TableCell>
                    {p.method === "stripe" ? t("payments.method.stripe") : p.method || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.money(p.amountMinor, inv.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
