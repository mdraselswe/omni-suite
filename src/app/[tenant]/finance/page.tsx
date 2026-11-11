import { FilterBar, FilterDate, FilterSearch, FilterSelect, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { ActionButton } from "@/components/form/action-button";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section, StatCard } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createTransactionAction,
  listAccounts,
  listTransactions,
  reverseTransactionAction,
  TransactionFields,
  TX_KINDS,
  type TxKind,
} from "@/features/finance";
import { t } from "@/i18n";
import { isIsoDate, today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { accountOptions, categoryOptions, clientOptions, partnerOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

const PAGE = 50;

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
  const q = param(sp, "q") || undefined;
  const limit = Math.min(Number(param(sp, "limit")) || PAGE, 1000);
  const canWrite = hasPermission(ctx, "finance.write");
  const database = db();

  const [accounts, rows, accOpts, cats, partners, clients] = await Promise.all([
    listAccounts(database, ctx.tenant.id),
    listTransactions(database, ctx.tenant.id, { from, to, kind, accountId, q, limit: limit + 1 }),
    accountOptions(database, ctx.tenant.id),
    categoryOptions(database, ctx.tenant.id),
    partnerOptions(database, ctx.tenant.id),
    clientOptions(database, ctx.tenant.id),
  ]);
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ from, to, kind, account: accountId, q })) if (v) next.set(k, v);
  next.set("limit", String(limit + PAGE));

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
              />
            </FormDialog>
          ) : null
        }
      >
        <FilterBar>
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
          <EmptyState title={t("finance.noTx")} body={t("finance.noTxBody")} />
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
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{accountName}</TableCell>
                    <TableCell className="hidden md:table-cell">{categoryName ?? ""}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {sign}
                      {f.money(tx.amountMinor, tx.currency)}
                    </TableCell>
                    {canWrite ? (
                      <TableCell>
                        {!tx.reversedAt && !tx.reversesId ? (
                          <ActionButton
                            action={reverseTransactionAction.bind(null, tenant)}
                            values={{ id: tx.id }}
                            confirm={t("form.confirm")}
                            variant="ghost"
                          >
                            {t("finance.reverse")}
                          </ActionButton>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {hasMore ? (
          <ButtonLink
            href={tenantHref(tenant, `finance?${next.toString()}`)}
            variant="outline"
            className="justify-self-center"
          >
            {t("finance.loadMore")}
          </ButtonLink>
        ) : null}
      </Section>
    </div>
  );
}
