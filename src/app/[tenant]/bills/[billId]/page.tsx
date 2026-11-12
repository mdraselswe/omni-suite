import { Paperclip } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionButton } from "@/components/form/action-button";
import { SelectField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  attachmentMaxMb,
  billBalance,
  billDisplayStatus,
  BillFields,
  DueText,
  getBill,
  payBillAction,
  supplierNames,
  undoBillPaymentAction,
  updateBillAction,
  voidBillAction,
} from "@/features/bills";
import { FxRateField, transactionFx } from "@/features/finance";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { currencyOptions } from "@/lib/intl-options";
import { toDecimalString } from "@/lib/money";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { accountOptions, categoryOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

export default async function BillPage({ params }: PageProps<"/[tenant]/bills/[billId]">) {
  const { tenant, billId } = await params;
  const { ctx } = await requireTenantPermission(tenant, "bills.read");
  const database = db();
  const row = await getBill(database, ctx.tenant.id, billId);
  if (!row) notFound();
  const { bill, categoryName, payments } = row;
  const f = formatters(ctx);
  const settings = ctx.tenant.settings;
  const now = today(settings.timezone);
  const shown = billDisplayStatus(bill, now);
  const balance = billBalance(bill);
  const isVoid = bill.voidedAt !== null;
  const canWrite = hasPermission(ctx, "bills.write");
  const canPay = canWrite && balance > 0n;
  const canEdit = canWrite && !isVoid && bill.paidMinor === 0n;

  const [accounts, categories, suppliers] = await Promise.all([
    // A payment leaves an account in the bill's currency.
    canPay
      ? accountOptions(database, ctx.tenant.id).then((all) => all.filter((a) => a.currency === bill.currency))
      : Promise.resolve([]),
    canEdit ? categoryOptions(database, ctx.tenant.id) : Promise.resolve([]),
    canEdit ? supplierNames(database, ctx.tenant.id) : Promise.resolve([]),
  ]);
  const fileHref = `/${encodeURIComponent(tenant)}/bills/${bill.id}/file/`;

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <Link href={tenantHref(tenant, "bills")} className="text-sm text-muted-foreground hover:underline">
            ← {t("bills.title")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-2xl font-semibold tracking-tight break-words">
              {bill.supplier}
            </h2>
            <StatusBadge status={shown} label={t(`bills.status.${shown}`)} />
          </div>
          {bill.reference ? (
            <p className="text-sm text-muted-foreground">
              {t("bills.referenceValue", { reference: bill.reference })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canPay && accounts.length > 0 ? (
            <FormDialog
              trigger={t("bills.pay")}
              title={t("bills.payTitle", { supplier: bill.supplier })}
              description={t("bills.payBody", { balance: f.money(balance, bill.currency) })}
              action={payBillAction.bind(null, tenant)}
              submitLabel={t("bills.pay")}
            >
              <input type="hidden" name="id" value={bill.id} />
              <TextField
                name="amount"
                label={t("bills.payAmount", { currency: bill.currency })}
                hint={t("bills.payAmountHint")}
                inputMode="decimal"
                defaultValue={toDecimalString(balance, bill.currency)}
                required
              />
              <TextField
                name="date"
                label={t("bills.payDate")}
                type="date"
                defaultValue={now}
                max={now}
                required
              />
              <SelectField
                name="accountId"
                label={t("bills.payFrom")}
                hint={t("bills.payFromHint", { currency: bill.currency })}
                options={accounts}
                required
              />
              <FxRateField
                fx={transactionFx(ctx, tenant)}
                currency={bill.currency}
                amount={toDecimalString(balance, bill.currency)}
              />
            </FormDialog>
          ) : null}
          {canEdit ? (
            <FormDialog
              trigger={t("form.edit")}
              title={t("bills.editTitle")}
              action={updateBillAction.bind(null, tenant)}
              variant="outline"
              icon={false}
              wide
            >
              <BillFields
                bill={{
                  id: bill.id,
                  supplier: bill.supplier,
                  reference: bill.reference,
                  issueDate: bill.issueDate,
                  dueDate: bill.dueDate,
                  currency: bill.currency,
                  amount: toDecimalString(bill.totalMinor, bill.currency),
                  tax: bill.taxMinor > 0n ? toDecimalString(bill.taxMinor, bill.currency) : "",
                  categoryId: bill.categoryId ?? "",
                  notes: bill.notes,
                  fileName: bill.fileName,
                }}
                suppliers={suppliers}
                categories={categories
                  .filter((c) => c.kind === "expense")
                  .map((c) => ({ value: c.value, label: c.name }))}
                currencies={currencyOptions()}
                baseCurrency={settings.currency}
                tax={
                  settings.tax.rateBp > 0 ? { name: settings.tax.name, rateBp: settings.tax.rateBp } : null
                }
                today={now}
                termsDays={settings.paymentTermsDays}
                maxFileMb={attachmentMaxMb()}
              />
            </FormDialog>
          ) : null}
          {canEdit ? (
            <ActionButton
              action={voidBillAction.bind(null, tenant)}
              values={{ id: bill.id }}
              variant="ghost"
              size="default"
              confirm={t("bills.voidConfirm")}
            >
              {t("bills.void")}
            </ActionButton>
          ) : null}
        </div>
      </div>

      {canPay && accounts.length === 0 ? (
        <p role="note" className="surface p-4 text-sm text-muted-foreground">
          {t("bills.noAccount", { currency: bill.currency })}{" "}
          <Link
            href={tenantHref(tenant, "finance/setup")}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {t("bills.addAccount")}
          </Link>
        </p>
      ) : null}
      {canWrite && !isVoid && bill.paidMinor > 0n ? (
        <p className="text-sm text-muted-foreground">{t("bills.lockedHint")}</p>
      ) : null}

      <article className="grid gap-6 surface p-4 sm:p-8">
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">{t("bills.issueDate")}</dt>
            <dd>{f.date(bill.issueDate)}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">{t("bills.dueDate")}</dt>
            <dd className="flex flex-wrap gap-x-2">
              <span>{f.date(bill.dueDate)}</span>
              {balance > 0n && bill.dueDate <= now ? (
                <DueText dueDate={bill.dueDate} today={now} formatted={f.date(bill.dueDate)} owing />
              ) : null}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">{t("finance.category")}</dt>
            <dd>{categoryName ?? t("finance.uncategorised")}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">{t("finance.currency")}</dt>
            <dd>{bill.currency}</dd>
          </div>
          {bill.fileKey ? (
            <div className="grid gap-0.5 sm:col-span-2">
              <dt className="text-muted-foreground">{t("bills.file")}</dt>
              <dd>
                <a
                  href={`${fileHref}?view`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1.5 rounded-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Paperclip className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{bill.fileName}</span>
                  <span className="sr-only">({t("bills.opensNewTab")})</span>
                </a>
              </dd>
            </div>
          ) : null}
        </dl>

        <dl className="ml-auto grid w-full max-w-xs gap-2 text-sm tabular-nums">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t("bills.total")}</dt>
            <dd>{f.money(bill.totalMinor, bill.currency)}</dd>
          </div>
          {bill.taxMinor > 0n ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("bills.taxIncluded", { tax: settings.tax.name })}</dt>
              <dd>{f.money(bill.taxMinor, bill.currency)}</dd>
            </div>
          ) : null}
          {isVoid ? null : (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t("bills.paidSoFar")}</dt>
                <dd>{f.money(bill.paidMinor, bill.currency)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t pt-2 font-medium">
                <dt>{t("bills.balance")}</dt>
                <dd>{f.money(balance, bill.currency)}</dd>
              </div>
            </>
          )}
        </dl>
        {bill.notes ? (
          <p className="text-sm whitespace-pre-line text-muted-foreground">{bill.notes}</p>
        ) : null}
      </article>

      <Section title={t("bills.payments")} description={t("bills.paymentsSub")}>
        {payments.length === 0 ? (
          <EmptyState title={t("bills.noPayments")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("form.date.label")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("finance.account")}</TableHead>
                <TableHead className="text-right">{t("finance.amount")}</TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  {t("bills.taxIncluded", { tax: settings.tax.name })}
                </TableHead>
                {canWrite ? <TableHead className="w-0" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => {
                const undone = p.reversedAt !== null;
                return (
                  <TableRow key={p.id} className={undone ? "text-muted-foreground" : undefined}>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex flex-wrap items-center gap-2">
                        {f.date(p.date)}
                        {undone ? <Badge variant="secondary">{t("bills.paymentUndoneBadge")}</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{p.accountName}</TableCell>
                    <TableCell
                      className={undone ? "text-right tabular-nums line-through" : "text-right tabular-nums"}
                    >
                      {f.money(p.amountMinor, p.currency)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {f.money(p.taxMinor, p.currency)}
                    </TableCell>
                    {canWrite ? (
                      <TableCell className="whitespace-nowrap">
                        {undone ? null : (
                          <FormDialog
                            trigger={t("bills.undoPayment")}
                            title={t("bills.undoPayment")}
                            description={t("bills.undoHint")}
                            action={undoBillPaymentAction.bind(null, tenant)}
                            submitLabel={t("bills.undoPayment")}
                            variant="ghost"
                            size="sm"
                            icon={false}
                          >
                            <input type="hidden" name="id" value={bill.id} />
                            <input type="hidden" name="paymentId" value={p.id} />
                            <TextField name="reason" label={t("bills.undoReasonLabel")} maxLength={200} />
                          </FormDialog>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>

      {hasPermission(ctx, "finance.read") && payments.length > 0 ? (
        <div>
          <ButtonLink href={tenantHref(tenant, "finance")} variant="ghost" size="sm">
            {t("bills.seeLedger")}
          </ButtonLink>
        </div>
      ) : null}
    </div>
  );
}
