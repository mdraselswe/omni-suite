import { Paperclip } from "lucide-react";
import { FilterBar, FilterDate, FilterSearch, FilterSelect, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { NoResults } from "@/components/data/no-results";
import { Pagination } from "@/components/data/pagination";
import { TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section, StatCard } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createTransactionAction,
  listAccounts,
  pageTransactions,
  receiptsFor,
  reverseTransactionAction,
  TransactionFields,
  transactionFx,
  TX_KINDS,
  type TxKind,
} from "@/features/finance";
import { UploadFileDialog } from "@/features/files";
import { t } from "@/i18n";
import { isIsoDate, today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { keepSize, parsePage } from "@/lib/pagination";
import { normaliseSearch } from "@/lib/search";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { accountOptions, categoryOptions, clientOptions, partnerOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

export default async function FinancePage({ params, searchParams }: PageProps<"/[tenant]/finance">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "finance.read");
  const f = formatters(ctx);
  const from = isIsoDate(param(sp, "from")) ? param(sp, "from") : undefined;
  const to = isIsoDate(param(sp, "to")) ? param(sp, "to") : undefined;
  const kind = (TX_KINDS as readonly string[]).includes(param(sp, "kind"))
    ? (param(sp, "kind") as TxKind)
    : undefined;
  const accountId = /^[0-9a-f-]{36}$/.test(param(sp, "account")) ? param(sp, "account") : undefined;
  const q = normaliseSearch(param(sp, "q"));
  const page = parsePage(sp);
  const path = tenantHref(tenant, "finance");
  const canWrite = hasPermission(ctx, "finance.write");
  const database = db();

  const [accounts, found, accOpts, cats, partners, clients] = await Promise.all([
    listAccounts(database, ctx.tenant.id),
    pageTransactions(database, ctx.tenant.id, { from, to, kind, accountId, q }, page),
    accountOptions(database, ctx.tenant.id),
    categoryOptions(database, ctx.tenant.id),
    partnerOptions(database, ctx.tenant.id),
    clientOptions(database, ctx.tenant.id),
  ]);
  const visible = found.rows;
  // Receipts: shown to members who can open files, attached by those who can add them.
  const fileScope = ctx.permissions.get("files.read");
  const canAttach = canWrite && ctx.permissions.has("files.write");
  const receipts = fileScope
    ? await receiptsFor(
        database,
        ctx.tenant.id,
        visible.map((r) => r.tx.id),
        fileScope === "all" ? undefined : ctx.user.id,
      )
    : new Map<string, { id: string; name: string }[]>();

  return (
    <div className="grid gap-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {accounts.map((a) => (
          <StatCard
            key={a.id}
            label={a.name}
            value={f.money(a.balanceMinor, a.currency)}
            hint={t(`finance.type.${a.type}`)}
            tone={a.balanceMinor < 0n ? "negative" : "default"}
          />
        ))}
      </div>

      <Section
        title={t("finance.transactions")}
        actions={
          canWrite ? (
            <FormDialog
              trigger={t("finance.newTx")}
              title={t("finance.newTx")}
              action={createTransactionAction.bind(null, tenant)}
              wide
            >
              <TransactionFields
                accounts={accOpts}
                categories={cats}
                partners={partners}
                clients={clients}
                today={today(ctx.tenant.settings.timezone)}
                fx={transactionFx(ctx, tenant)}
              />
            </FormDialog>
          ) : null
        }
      >
        <FilterBar keep={keepSize(page)}>
          <FilterDate name="from" label={t("finance.from")} value={from} />
          <FilterDate name="to" label={t("finance.to")} value={to} />
          <FilterSelect
            name="kind"
            label={t("finance.kind")}
            value={kind}
            options={TX_KINDS.map((k) => ({ value: k, label: t(`finance.kind.${k}`) }))}
          />
          <FilterSelect name="account" label={t("finance.account")} value={accountId} options={accOpts} />
          <FilterSearch value={q} />
        </FilterBar>

        {visible.length === 0 ? (
          q ? (
            <NoResults q={q} path={path} searchParams={sp} />
          ) : (
            <EmptyState title={t("finance.noTx")} body={t("finance.noTxBody")} />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("form.date.label")}</TableHead>
                <TableHead>{t("form.description")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("finance.account")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("finance.category")}</TableHead>
                <TableHead className="text-right">{t("finance.amount")}</TableHead>
                {canWrite ? <TableHead className="w-0" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map(({ tx, accountName, categoryName }) => {
                const outflow = tx.kind === "expense" || tx.kind === "drawing";
                const sign = tx.kind === "transfer" ? "" : outflow !== Boolean(tx.reversesId) ? "−" : "+";
                return (
                  <TableRow
                    key={tx.id}
                    className={tx.reversedAt ? "text-muted-foreground line-through" : undefined}
                  >
                    <TableCell className="whitespace-nowrap">{f.date(tx.date)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{tx.description || t(`finance.kind.${tx.kind}`)}</span>
                        <Badge variant="outline">{t(`finance.kind.${tx.kind}`)}</Badge>
                        {tx.reversesId ? <Badge variant="secondary">{t("finance.reversal")}</Badge> : null}
                        {receipts.get(tx.id)?.map((file) => (
                          <a
                            key={file.id}
                            href={`/api/t/${encodeURIComponent(tenant)}/files/${file.id}?view`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-40 items-center gap-1 rounded-sm text-xs text-muted-foreground no-underline hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            title={t("finance.receiptOpen", { name: file.name })}
                          >
                            <Paperclip className="size-3 shrink-0" aria-hidden />
                            <span className="truncate">{file.name}</span>
                          </a>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{accountName}</TableCell>
                    <TableCell className="hidden md:table-cell">{categoryName ?? ""}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {sign}
                      {f.money(tx.amountMinor, tx.currency)}
                    </TableCell>
                    {canWrite ? (
                      <TableCell className="whitespace-nowrap">
                        {canAttach && !tx.reversesId && (tx.kind === "expense" || tx.kind === "income") ? (
                          <UploadFileDialog
                            tenant={tenant}
                            trigger={t("finance.attachReceipt")}
                            title={t("finance.attachReceipt")}
                            description={t("finance.attachReceiptHint")}
                            variant="ghost"
                            icon={false}
                          >
                            <input type="hidden" name="entityType" value="transaction" />
                            <input type="hidden" name="entityId" value={tx.id} />
                            <TextField
                              name="file"
                              label={t("files.file")}
                              type="file"
                              accept="image/*,application/pdf"
                              required
                            />
                          </UploadFileDialog>
                        ) : null}
                        {!tx.reversedAt && !tx.reversesId ? (
                          <FormDialog
                            trigger={t("finance.reverse")}
                            title={t("finance.reverse")}
                            description={t("finance.reverseHint")}
                            action={reverseTransactionAction.bind(null, tenant)}
                            variant="ghost"
                            icon={false}
                          >
                            <input type="hidden" name="id" value={tx.id} />
                            <TextField name="reason" label={t("finance.reverseReason")} maxLength={200} />
                          </FormDialog>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pagination path={path} searchParams={sp} request={page} paged={found} locale={f.locale} />
      </Section>
    </div>
  );
}
