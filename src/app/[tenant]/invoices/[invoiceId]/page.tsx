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
import { FxRateField, transactionFx } from "@/features/finance";
import {
  creditable,
  displayStatus,
  DocumentLines,
  getInvoice,
  invoiceAdjustmentsOf,
  invoiceBalance,
  InvoiceFields,
  issueCreditNoteAction,
  voidCreditNoteAction,
  recordPaymentAction,
  resendInvoiceAction,
  sendInvoiceAction,
  updateInvoiceAction,
  voidInvoiceAction,
  writeOffAction,
} from "@/features/invoices";
import { ShareLinkPanel } from "@/features/sharing";
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
  const balance = invoiceBalance(inv);
  const canWrite = hasPermission(ctx, "invoices.write");
  const canPay =
    hasPermission(ctx, "payments.record") && (inv.status === "sent" || inv.status === "partially_paid");
  const canRefund = hasPermission(ctx, "payments.record");
  // A credit note: anything billed and not already credited or written off, on a sent or paid invoice.
  const maxCredit = inv.status === "draft" || inv.status === "void" ? 0n : creditable(inv);
  const canCredit = canWrite && maxCredit > 0n;
  const isDraft = inv.status === "draft";
  const custom = storedCustom(inv.custom);

  const [defs, clients, accounts, categories, adjustments] = await Promise.all([
    customFieldsFor(database, ctx.tenant.id, "invoice"),
    canWrite && isDraft ? clientOptions(database, ctx.tenant.id) : Promise.resolve([]),
    // A payment (or a credit note's refund) uses an account of the invoice's currency.
    canPay || (canCredit && canRefund && inv.paidMinor > 0n)
      ? accountOptions(database, ctx.tenant.id).then((all) => all.filter((a) => a.currency === inv.currency))
      : Promise.resolve([]),
    canPay ? categoryOptions(database, ctx.tenant.id) : Promise.resolve([]),
    invoiceAdjustmentsOf(database, ctx.tenant.id, inv.id),
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
          {hasPermission(ctx, "invoices.write") &&
          (inv.status === "sent" || inv.status === "partially_paid") &&
          invoiceBalance(inv) > 0n ? (
            <ActionButton
              action={resendInvoiceAction.bind(null, tenant)}
              values={{ id: inv.id }}
              variant="outline"
              size="default"
              confirm={t("invoices.resendConfirm")}
            >
              {t("invoices.resend")}
            </ActionButton>
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
              {inv.currency !== settings.currency ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    {t("invoices.payRateHint", { currency: inv.currency, base: settings.currency })}
                  </p>
                  <FxRateField
                    fx={transactionFx(ctx, tenant)}
                    currency={inv.currency}
                    amount={toDecimalString(balance, inv.currency)}
                  />
                </>
              ) : null}
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
          {canPay && balance > 0n ? (
            <FormDialog
              trigger={t("invoices.writeOff")}
              title={t("invoices.writeOffTitle", { amount: f.money(balance, inv.currency) })}
              description={t("invoices.writeOffBody")}
              action={writeOffAction.bind(null, tenant)}
              variant="ghost"
              icon={false}
            >
              <input type="hidden" name="id" value={inv.id} />
              <TextField name="reason" label={t("invoices.writeOffReason")} />
            </FormDialog>
          ) : null}
          {canCredit ? (
            <FormDialog
              trigger={t("credit.new")}
              title={t("credit.new")}
              description={t("credit.newHint")}
              action={issueCreditNoteAction.bind(null, tenant)}
              variant="ghost"
              icon={false}
            >
              <input type="hidden" name="id" value={inv.id} />
              <TextField
                name="amount"
                label={t("credit.amount")}
                inputMode="decimal"
                defaultValue={toDecimalString(balance > 0n ? balance : maxCredit, inv.currency)}
                hint={t("credit.max", { max: f.money(maxCredit, inv.currency) })}
                required
              />
              <TextField name="date" label={t("credit.date")} type="date" defaultValue={now} required />
              <TextField name="reason" label={t("credit.reason")} required />
              {inv.paidMinor > 0n && canRefund ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    {balance > 0n
                      ? t("credit.refundAbove", { balance: f.money(balance, inv.currency) })
                      : t("credit.refundAll")}
                  </p>
                  <SelectField
                    name="refundAccountId"
                    label={t("credit.refundFrom")}
                    options={accounts}
                    placeholder={t("form.none")}
                  />
                  {inv.currency !== settings.currency ? (
                    <FxRateField
                      fx={transactionFx(ctx, tenant)}
                      currency={inv.currency}
                      amount={toDecimalString(inv.paidMinor, inv.currency)}
                    />
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t("credit.noRefund")}</p>
              )}
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
          {canWrite && inv.status !== "void" && inv.paidMinor === 0n && inv.creditedMinor === 0n ? (
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
            {client.billingEmail || client.email ? (
              <p className="text-sm text-muted-foreground">{client.billingEmail || client.email}</p>
            ) : null}
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
          pricesIncludeTax={inv.pricesIncludeTax}
          taxName={settings.tax.name}
          totals={inv}
          extra={
            inv.status === "void"
              ? []
              : [
                  { label: t("invoices.paid"), amount: inv.paidMinor },
                  ...(inv.writtenOffMinor > 0n
                    ? [{ label: t("invoices.writtenOff"), amount: inv.writtenOffMinor }]
                    : []),
                  ...(inv.creditedMinor > 0n
                    ? [{ label: t("credit.credited"), amount: inv.creditedMinor }]
                    : []),
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
                <TableRow key={p.id} className={p.reversedAt ? "text-muted-foreground" : undefined}>
                  <TableCell>{f.date(p.date)}</TableCell>
                  <TableCell>
                    {p.method === "stripe"
                      ? t("payments.method.stripe")
                      : p.method === "refund"
                        ? t("credit.refundMethod")
                        : p.method || "—"}
                    {p.reversedAt ? (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                        {t("invoices.paymentReversed")}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className={
                      p.reversedAt ? "text-right tabular-nums line-through" : "text-right tabular-nums"
                    }
                  >
                    {f.money(p.amountMinor, inv.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {adjustments.length > 0 ? (
        <Section title={t("credit.title")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("form.date.label")}</TableHead>
                <TableHead>{t("statement.detail")}</TableHead>
                <TableHead className="text-right">{t("finance.amount")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("form.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustments.map((a) => (
                <TableRow key={a.id} className={a.voidedAt ? "text-muted-foreground" : undefined}>
                  <TableCell className="whitespace-nowrap">{f.date(a.date)}</TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {a.kind === "credit_note"
                        ? t("credit.list.creditNote", { number: a.number ?? "" })
                        : t("credit.list.writeOff")}
                    </span>
                    {a.voidedAt ? (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                        {t("credit.voidedLabel")}
                      </span>
                    ) : null}
                    {a.refundedMinor > 0n ? (
                      <span className="block text-xs text-muted-foreground">
                        {t("credit.refunded", { amount: f.money(a.refundedMinor, inv.currency) })}
                      </span>
                    ) : null}
                    {a.reason ? (
                      <span className="block text-xs text-muted-foreground">{a.reason}</span>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className={
                      a.voidedAt ? "text-right tabular-nums line-through" : "text-right tabular-nums"
                    }
                  >
                    {f.money(a.amountMinor, inv.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {a.kind === "credit_note" && !a.voidedAt ? (
                        <ButtonLink
                          href={tenantHref(tenant, `invoices/${inv.id}/credit-notes/${a.id}`)}
                          variant="ghost"
                          size="sm"
                        >
                          {t("credit.print")}
                        </ButtonLink>
                      ) : null}
                      {canWrite && a.kind === "credit_note" && !a.voidedAt && a.refundedMinor === 0n ? (
                        <ActionButton
                          action={voidCreditNoteAction.bind(null, tenant)}
                          values={{ id: a.id }}
                          variant="ghost"
                          size="sm"
                          confirm={t("credit.voidTitle", { number: a.number ?? "" })}
                        >
                          {t("credit.void")}
                        </ActionButton>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}

      {inv.status !== "draft" ? (
        <Section title={t("share.title")}>
          <ShareLinkPanel
            slug={tenant}
            kind="invoice"
            id={inv.id}
            token={inv.shareToken}
            canWrite={canWrite}
          />
        </Section>
      ) : null}
    </div>
  );
}
