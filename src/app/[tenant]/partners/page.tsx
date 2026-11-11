import Link from "next/link";
import { formatters } from "@/components/data/format";
import { SelectField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createPartnerAction,
  DilutionCalculator,
  listPartners,
  ownershipHistory,
  recordCapitalAction,
  recordInvestmentAction,
  recordTransferAction,
  setInitialOwnershipAction,
} from "@/features/partners";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { accountOptions, memberOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

export default async function PartnersPage({ params }: PageProps<"/[tenant]/partners">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "partners.read");
  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const canManage = hasPermission(ctx, "partners.manage", "all");
  const [partners, events, accounts, members] = await Promise.all([
    listPartners(db(), ctx.tenant.id, now),
    ownershipHistory(db(), ctx.tenant.id),
    accountOptions(db(), ctx.tenant.id),
    memberOptions(db(), ctx.tenant.id),
  ]);
  const active = partners.filter((p) => !p.leftOn);
  const partnerOpts = active.map((p) => ({ value: p.id, label: p.name }));
  const hasOwnership = events.length > 0;

  return (
    <div className="grid gap-10">
      <Section
        title={t("partners.list")}
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <FormDialog
                trigger={t("partners.new")}
                title={t("partners.new")}
                action={createPartnerAction.bind(null, tenant)}
              >
                <TextField name="name" label={t("partners.name")} required />
                <TextField name="email" label={t("partners.email")} type="email" />
                <TextField
                  name="joinedOn"
                  label={t("partners.joined")}
                  type="date"
                  defaultValue={now}
                  required
                />
                <SelectField
                  name="membershipId"
                  label={t("partners.member")}
                  hint={t("partners.memberHint")}
                  options={members}
                  placeholder={t("form.none")}
                />
              </FormDialog>
              {active.length > 0 ? (
                <FormDialog
                  trigger={t("partners.recordCapital")}
                  title={t("partners.recordCapital")}
                  action={recordCapitalAction.bind(null, tenant)}
                  variant="outline"
                >
                  <SelectField name="partnerId" label={t("finance.partner")} options={partnerOpts} />
                  <SelectField
                    name="kind"
                    label={t("partners.capitalKind")}
                    options={(["cash", "asset", "work"] as const).map((k) => ({
                      value: k,
                      label: t(`partners.capitalKind.${k}`),
                    }))}
                  />
                  <TextField name="amount" label={t("finance.amount")} inputMode="decimal" required />
                  <TextField
                    name="date"
                    label={t("form.date.label")}
                    type="date"
                    defaultValue={now}
                    required
                  />
                  <SelectField
                    name="accountId"
                    label={t("partners.capitalAccount")}
                    options={accounts}
                    placeholder={t("form.none")}
                  />
                  <TextField name="description" label={t("form.description")} />
                </FormDialog>
              ) : null}
            </div>
          ) : null
        }
      >
        {partners.length === 0 ? (
          <EmptyState title={t("partners.noPartners")} body={t("partners.noPartnersBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("partners.name")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("partners.joined")}</TableHead>
                <TableHead className="text-right">{t("partners.capital")}</TableHead>
                <TableHead className="text-right">{t("partners.ownership")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.map((p) => (
                <TableRow key={p.id} className={p.leftOn ? "text-muted-foreground" : undefined}>
                  <TableCell>
                    <Link
                      href={tenantHref(tenant, `partners/${p.id}`)}
                      className="font-medium hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.leftOn ? ` · ${t("partners.left")} ${f.date(p.leftOn)}` : ""}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{f.date(p.joinedOn)}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.money(p.capitalMinor)}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.percent(p.ownershipBp)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title={t("partners.ownershipTitle")}
        description={t("partners.ownershipSub")}
        actions={
          canManage && active.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {!hasOwnership ? (
                <FormDialog
                  trigger={t("partners.setInitial")}
                  title={t("partners.setInitial")}
                  description={t("partners.initialHint")}
                  action={setInitialOwnershipAction.bind(null, tenant)}
                >
                  {active.map((p) => (
                    <TextField key={p.id} name={`pct_${p.id}`} label={`${p.name} (%)`} inputMode="decimal" />
                  ))}
                  <TextField
                    name="date"
                    label={t("form.date.label")}
                    type="date"
                    defaultValue={now}
                    required
                  />
                  <TextField name="note" label={t("rules.note")} />
                </FormDialog>
              ) : (
                <>
                  <FormDialog
                    trigger={t("partners.newInvestment")}
                    title={t("partners.newInvestment")}
                    description={t("partners.investmentHint")}
                    action={recordInvestmentAction.bind(null, tenant)}
                  >
                    <SelectField name="partnerId" label={t("finance.partner")} options={partnerOpts} />
                    <TextField name="preMoney" label={t("partners.preMoney")} inputMode="decimal" required />
                    <TextField
                      name="investment"
                      label={t("partners.investment")}
                      inputMode="decimal"
                      required
                    />
                    <TextField
                      name="date"
                      label={t("form.date.label")}
                      type="date"
                      defaultValue={now}
                      required
                    />
                    <SelectField
                      name="accountId"
                      label={t("partners.capitalAccount")}
                      options={accounts}
                      placeholder={t("form.none")}
                    />
                    <TextField name="note" label={t("rules.note")} />
                  </FormDialog>
                  <FormDialog
                    trigger={t("partners.transfer")}
                    title={t("partners.transfer")}
                    description={t("partners.transferHint")}
                    action={recordTransferAction.bind(null, tenant)}
                    variant="outline"
                    icon={false}
                  >
                    <SelectField
                      name="fromPartnerId"
                      label={t("partners.fromPartner")}
                      options={partnerOpts}
                    />
                    <SelectField name="toPartnerId" label={t("partners.toPartner")} options={partnerOpts} />
                    <TextField
                      name="percent"
                      label={t("partners.percentToMove")}
                      inputMode="decimal"
                      required
                    />
                    <TextField
                      name="date"
                      label={t("form.date.label")}
                      type="date"
                      defaultValue={now}
                      required
                    />
                    <TextField name="note" label={t("rules.note")} />
                  </FormDialog>
                </>
              )}
            </div>
          ) : null
        }
      >
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("partners.noOwnership")}</p>
        ) : (
          <ol className="grid gap-2">
            {events.map((e) => {
              const holdings = (
                (e.data as { holdings?: { partnerId: string; units: string }[] }).holdings ?? []
              ).map((h) => ({ ...h, units: BigInt(h.units) }));
              const total = holdings.reduce((a, h) => a + h.units, 0n);
              return (
                <li key={e.id} className="grid gap-1 rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{t(`partners.event.${e.type}`)}</span>
                    <span className="text-muted-foreground">{f.date(e.date)}</span>
                  </div>
                  <p className="text-muted-foreground">
                    {holdings
                      .map((h) => {
                        const name = partners.find((p) => p.id === h.partnerId)?.name ?? "?";
                        const bp = total === 0n ? 0 : Number((h.units * 10000n) / total);
                        return `${name} ${f.percent(bp)}`;
                      })
                      .join(" · ")}
                  </p>
                  {e.note ? <p>{e.note}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      {hasOwnership ? (
        <Section title={t("partners.dilutionCalc")} description={t("partners.investmentHint")}>
          <DilutionCalculator
            holdings={active.map((p) => ({ partnerId: p.id, name: p.name, units: p.units.toString() }))}
            currency={f.currency}
            locale={f.locale}
          />
        </Section>
      ) : null}
    </div>
  );
}
