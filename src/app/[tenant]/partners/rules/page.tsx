import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionButton } from "@/components/form/action-button";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import {
  decideRuleAction,
  listPartners,
  listRules,
  proposeRuleAction,
  RuleFields,
  type RuleRow,
} from "@/features/partners";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { hasPermission } from "@/server/tenancy/context";

function describe(
  rule: RuleRow,
  names: Map<string, string>,
  pct: (bp: number) => string,
  money: (m: bigint) => string,
) {
  const m = rule.config.method;
  const parts = [t(`rules.method.${m.type}`)];
  if (m.type === "fixed_percent")
    parts.push(m.shares.map((s) => `${names.get(s.partnerId) ?? "?"} ${pct(s.basisPoints)}`).join(" / "));
  if (m.type === "weighted") {
    parts.push(
      `${t("rules.capitalWeight")} ${pct(m.capitalWeightBp)}, ${t("rules.laborWeight")} ${pct(m.laborWeightBp)} (${t(`rules.laborSource.${m.laborSource}`)})`,
    );
  }
  if (rule.config.reserveBp > 0) parts.push(`${t("dist.reserve")} ${pct(rule.config.reserveBp)}`);
  for (const fee of rule.config.fees)
    parts.push(`${t("dist.fee")} ${names.get(fee.partnerId) ?? "?"} ${money(BigInt(fee.amountMinor))}`);
  parts.push(t(`rules.lossMethod.${rule.config.lossMethod}`));
  return parts;
}

export default async function RulesPage({ params }: PageProps<"/[tenant]/partners/rules">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "partners.read");
  const f = formatters(ctx);
  const now = today(ctx.tenant.settings.timezone);
  const [rules, partners] = await Promise.all([
    listRules(db(), ctx.tenant.id),
    listPartners(db(), ctx.tenant.id, now),
  ]);
  const active = partners.filter((p) => !p.leftOn);
  const names = new Map(partners.map((p) => [p.id, p.name]));
  const canPropose = hasPermission(ctx, "profit.propose", "all");

  return (
    <Section
      title={t("rules.title")}
      description={t("rules.sub")}
      actions={
        canPropose && active.length > 0 ? (
          <FormDialog
            trigger={t("rules.propose")}
            title={t("rules.propose")}
            action={proposeRuleAction.bind(null, tenant)}
            wide
          >
            <RuleFields partners={active.map((p) => ({ id: p.id, name: p.name }))} today={now} />
          </FormDialog>
        ) : null
      }
    >
      {rules.length === 0 ? (
        <EmptyState title={t("rules.none")} body={t("rules.noneBody")} />
      ) : (
        <ul className="grid gap-3">
          {rules.map((rule) => {
            const approved = rule.approvals.filter((a) => a.decision === "approved");
            return (
              <li key={rule.id} className="grid gap-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t("rules.version", { version: rule.version })}</span>
                    <StatusBadge status={rule.status} label={t(`rules.status.${rule.status}`)} />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {t("rules.effectiveFrom")}: {f.date(rule.effectiveFrom)}
                  </span>
                </div>
                <ul className="grid gap-0.5 text-sm">
                  {describe(rule, names, f.percent, (m) => f.money(m)).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {rule.note ? <p className="text-sm text-muted-foreground">{rule.note}</p> : null}
                <div className="grid gap-2 border-t pt-3">
                  <p className="text-xs text-muted-foreground">
                    {t("rules.approvedBy", { count: approved.length, total: active.length })}
                  </p>
                  <ul className="grid gap-2">
                    {active.map((p) => {
                      const decision = rule.approvals.find((a) => a.partnerId === p.id);
                      const self = p.membershipId === ctx.membership.id;
                      const canDecide =
                        rule.status === "proposed" && (self || (p.membershipId === null && canPropose));
                      return (
                        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span>
                            {p.name}
                            {p.membershipId === null && canDecide ? (
                              <span className="text-xs text-muted-foreground">
                                {" "}
                                · {t("rules.onBehalf", { name: p.name })}
                              </span>
                            ) : null}
                          </span>
                          <span className="flex items-center gap-2">
                            {decision ? (
                              <StatusBadge
                                status={decision.decision}
                                label={t(`rules.${decision.decision === "approved" ? "approve" : "reject"}`)}
                              />
                            ) : null}
                            {canDecide ? (
                              <>
                                <ActionButton
                                  action={decideRuleAction.bind(null, tenant)}
                                  values={{ ruleId: rule.id, partnerId: p.id, decision: "approved" }}
                                  variant="default"
                                >
                                  {t("rules.approve")}
                                </ActionButton>
                                <ActionButton
                                  action={decideRuleAction.bind(null, tenant)}
                                  values={{ ruleId: rule.id, partnerId: p.id, decision: "rejected" }}
                                  confirm={t("form.confirm")}
                                >
                                  {t("rules.reject")}
                                </ActionButton>
                              </>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
