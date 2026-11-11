import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { TextField, SelectField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { Section, StatCard } from "@/components/layout/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  listPartners,
  partnerStatement,
  recordDrawingAction,
  updatePartnerAction,
} from "@/features/partners";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { accountOptions, memberOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

export default async function PartnerPage({ params }: PageProps<"/[tenant]/partners/[partnerId]">) {
  const { tenant, partnerId } = await params;
  const { ctx } = await requireTenantPermission(tenant, "partners.read");
  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const partners = await listPartners(db(), ctx.tenant.id, now);
  const partner = partners.find((p) => p.id === partnerId);
  if (!partner) notFound();
  const [statement, accounts, members] = await Promise.all([
    partnerStatement(db(), ctx.tenant.id, partner.id),
    accountOptions(db(), ctx.tenant.id),
    memberOptions(db(), ctx.tenant.id),
  ]);

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-xl font-semibold">{partner.name}</h2>
        <div className="flex flex-wrap gap-2">
          {hasPermission(ctx, "finance.write") ? (
            <FormDialog
              trigger={t("partners.recordDrawing")}
              title={t("partners.recordDrawing")}
              action={recordDrawingAction.bind(null, tenant)}
            >
              <input type="hidden" name="partnerId" value={partner.id} />
              <SelectField name="accountId" label={t("finance.account")} options={accounts} />
              <TextField name="amount" label={t("finance.amount")} inputMode="decimal" required />
              <TextField name="date" label={t("form.date.label")} type="date" defaultValue={now} required />
              <TextField name="description" label={t("form.description")} />
            </FormDialog>
          ) : null}
          {hasPermission(ctx, "partners.manage", "all") ? (
            <FormDialog
              trigger={t("form.edit")}
              title={partner.name}
              action={updatePartnerAction.bind(null, tenant)}
              variant="outline"
              icon={false}
            >
              <input type="hidden" name="id" value={partner.id} />
              <TextField name="name" label={t("partners.name")} defaultValue={partner.name} required />
              <TextField name="email" label={t("partners.email")} type="email" defaultValue={partner.email} />
              <SelectField
                name="membershipId"
                label={t("partners.member")}
                options={members}
                placeholder={t("form.none")}
                defaultValue={partner.membershipId ?? ""}
              />
              <TextField
                name="leftOn"
                label={t("partners.left")}
                type="date"
                defaultValue={partner.leftOn ?? ""}
              />
            </FormDialog>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("partners.capital")} value={f.money(statement.capitalMinor)} />
        <StatCard label={t("partners.ownership")} value={f.percent(partner.ownershipBp)} />
        <StatCard label={t("partners.profitShares")} value={f.money(statement.sharesMinor)} />
        <StatCard
          label={t("partners.balanceOwed")}
          value={f.money(statement.owedMinor)}
          hint={`${t("partners.drawings")}: ${f.money(statement.drawingsMinor)}`}
          tone={statement.owedMinor < 0n ? "negative" : "default"}
        />
      </div>

      <Section title={t("partners.statement")} description={t("partners.statementSub")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("form.date.label")}</TableHead>
              <TableHead>{t("form.description")}</TableHead>
              <TableHead className="text-right">{t("finance.amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              ...statement.capital.map((c) => ({
                key: `c-${c.c.id}`,
                date: c.c.date,
                label: `${t("partners.capital")} · ${t(`partners.capitalKind.${c.c.kind}`)}${c.c.description ? ` · ${c.c.description}` : ""}`,
                amount: c.c.amountMinor,
              })),
              ...statement.shares.map((s) => ({
                key: `s-${s.id}`,
                date: s.periodEnd,
                label: `${t("partners.profitShares")} ${f.date(s.periodStart)} – ${f.date(s.periodEnd)}`,
                amount: s.totalMinor,
              })),
              ...statement.drawings.map((d) => ({
                key: `d-${d.id}`,
                date: d.date,
                label: `${t("partners.drawings")}${d.description ? ` · ${d.description}` : ""}`,
                amount: d.reversesId ? d.amountMinor : -d.amountMinor,
              })),
            ]
              .sort((a, b) => (a.date < b.date ? 1 : -1))
              .map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="whitespace-nowrap">{f.date(row.date)}</TableCell>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.money(row.amount)}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Section>
    </div>
  );
}
