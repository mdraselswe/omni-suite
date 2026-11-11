import { formatters } from "@/components/data/format";
import { ActionButton } from "@/components/form/action-button";
import { SelectField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  closePeriodAction,
  createAccountAction,
  createCategoryAction,
  listAccounts,
  listCategories,
  listPeriods,
  reopenPeriodAction,
  toggleAccountAction,
  toggleCategoryAction,
} from "@/features/finance";
import { t } from "@/i18n";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { hasPermission } from "@/server/tenancy/context";

export default async function FinanceSetupPage({ params }: PageProps<"/[tenant]/finance/setup">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "finance.read");
  const f = formatters(ctx);
  const canWrite = hasPermission(ctx, "finance.write");
  const canClose = hasPermission(ctx, "finance.close", "all");
  const [accounts, cats, periods] = await Promise.all([
    listAccounts(db(), ctx.tenant.id, true),
    listCategories(db(), ctx.tenant.id, true),
    listPeriods(db(), ctx.tenant.id),
  ]);

  return (
    <div className="grid gap-10">
      <Section
        title={t("finance.accounts")}
        actions={
          canWrite ? (
            <FormDialog
              trigger={t("finance.newAccount")}
              title={t("finance.newAccount")}
              action={createAccountAction.bind(null, tenant)}
            >
              <TextField name="name" label={t("form.name")} required />
              <SelectField
                name="type"
                label={t("finance.accountType")}
                options={(["bank", "cash", "wallet", "card"] as const).map((k) => ({
                  value: k,
                  label: t(`finance.type.${k}`),
                }))}
              />
              <TextField
                name="currency"
                label={t("finance.currency")}
                defaultValue={f.currency}
                maxLength={3}
              />
              <TextField name="opening" label={t("finance.opening")} inputMode="decimal" placeholder="0.00" />
            </FormDialog>
          ) : null
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("form.name")}</TableHead>
              <TableHead>{t("finance.accountType")}</TableHead>
              <TableHead className="text-right">{t("finance.balance")}</TableHead>
              {canWrite ? <TableHead className="w-0" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => (
              <TableRow key={a.id} className={a.archived ? "text-muted-foreground" : undefined}>
                <TableCell>
                  {a.name} {a.archived ? <Badge variant="outline">{t("finance.archived")}</Badge> : null}
                </TableCell>
                <TableCell>
                  {t(`finance.type.${a.type}`)} · {a.currency}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {f.money(a.balanceMinor, a.currency)}
                </TableCell>
                {canWrite ? (
                  <TableCell>
                    <ActionButton
                      action={toggleAccountAction.bind(null, tenant)}
                      values={{ id: a.id, name: a.name, archived: String(!a.archived) }}
                      variant="ghost"
                    >
                      {a.archived ? t("finance.unarchive") : t("finance.archive")}
                    </ActionButton>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section
        title={t("finance.categories")}
        actions={
          canWrite ? (
            <FormDialog
              trigger={t("finance.newCategory")}
              title={t("finance.newCategory")}
              action={createCategoryAction.bind(null, tenant)}
            >
              <SelectField
                name="kind"
                label={t("finance.kind")}
                options={[
                  { value: "expense", label: t("finance.kind.expense") },
                  { value: "income", label: t("finance.kind.income") },
                ]}
              />
              <TextField name="name" label={t("form.name")} required />
            </FormDialog>
          ) : null
        }
      >
        <ul className="flex flex-wrap gap-2">
          {cats.map((c) => (
            <li key={c.id} className="flex items-center gap-1 rounded-md border py-1 pr-1 pl-2.5 text-sm">
              <span className={c.archived ? "text-muted-foreground line-through" : undefined}>{c.name}</span>
              <Badge variant="outline">{t(`finance.kind.${c.kind}`)}</Badge>
              {canWrite ? (
                <ActionButton
                  action={toggleCategoryAction.bind(null, tenant)}
                  values={{ id: c.id, archived: String(!c.archived) }}
                  variant="ghost"
                  size="xs"
                >
                  {c.archived ? t("finance.unarchive") : t("finance.archive")}
                </ActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={t("finance.periods")}
        description={t("finance.periodsSub")}
        actions={
          canClose ? (
            <FormDialog
              trigger={t("finance.closePeriod")}
              title={t("finance.closePeriod")}
              action={closePeriodAction.bind(null, tenant)}
            >
              <TextField name="startDate" label={t("finance.from")} type="date" required />
              <TextField name="endDate" label={t("finance.to")} type="date" required />
            </FormDialog>
          ) : null
        }
      >
        {periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="grid gap-2">
            {periods.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                <span>
                  {f.date(p.startDate)} – {f.date(p.endDate)}
                </span>
                {canClose ? (
                  <ActionButton
                    action={reopenPeriodAction.bind(null, tenant)}
                    values={{ id: p.id }}
                    confirm={t("form.confirm")}
                  >
                    {t("finance.reopen")}
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
