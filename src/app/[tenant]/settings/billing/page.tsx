import { Check } from "lucide-react";
import { param } from "@/components/data/filter-bar";
import { ActionButton } from "@/components/form/action-button";
import { Section } from "@/components/layout/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { billing } from "@/config";
import {
  billingConfigured,
  billingView,
  choosePlanAction,
  manageBillingAction,
  planDef,
} from "@/features/billing";
import { t } from "@/i18n";
import { formatDate, today } from "@/lib/dates";
import { formatMoney, minorDigits } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

const KNOWN_STATUS = [
  "none",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;

export default async function BillingPage({ params, searchParams }: PageProps<"/[tenant]/settings/billing">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "billing.manage", "all");
  const { timezone, locale } = ctx.tenant.settings;

  if (!billingConfigured()) {
    return (
      <div className="grid max-w-3xl gap-8">
        <Section title={t("billing.title")} description={t("billing.sub")}>
          <Alert>
            <AlertDescription>
              {t("billing.notConfigured")} {t("billing.notConfiguredHelp")}
            </AlertDescription>
          </Alert>
        </Section>
      </div>
    );
  }

  const view = await billingView(db(), ctx.tenant);
  const status = KNOWN_STATUS.find((s) => s === view.status) ?? "none";
  const current = view.live ? planDef(view.plan) : null;
  const day = (d: Date) => formatDate(today(timezone, d), locale);
  const periodNote = view.currentPeriodEnd
    ? view.cancelAtPeriodEnd
      ? t("billing.endsOn", { date: day(view.currentPeriodEnd) })
      : status === "trialing"
        ? t("billing.trialEnds", { date: day(view.currentPeriodEnd) })
        : t("billing.renews", { date: day(view.currentPeriodEnd) })
    : "";
  const price = (amount: number, currency: string) =>
    formatMoney(BigInt(Math.round(amount * 10 ** minorDigits(currency))), currency, locale);
  const choose = choosePlanAction.bind(null, tenant);

  return (
    <div className="grid max-w-5xl gap-8">
      <Section title={t("billing.title")} description={t("billing.sub")}>
        {param(sp, "done") ? (
          <Alert>
            <AlertDescription>{t("billing.done")}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-4 surface p-5">
          <div className="grid gap-1">
            <p className="text-sm text-muted-foreground">{t("billing.current")}</p>
            <p className="font-heading text-xl font-semibold">
              {current ? t(`plan.${current.key}.name`) : t("billing.status.none")}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge
                variant={
                  status === "active" || status === "trialing"
                    ? "success"
                    : status === "past_due" || status === "unpaid"
                      ? "destructive"
                      : "soft"
                }
              >
                {t(`billing.status.${status}`)}
              </Badge>
              {periodNote ? <span className="text-muted-foreground">{periodNote}</span> : null}
            </div>
          </div>
          {view.hasCustomer ? (
            <div className="grid justify-items-start gap-1 sm:justify-items-end">
              <ActionButton action={manageBillingAction.bind(null, tenant)} variant="default" size="default">
                {t("billing.manage")}
              </ActionButton>
              <p className="max-w-xs text-xs text-muted-foreground sm:text-right">
                {t("billing.manageHelp")}
              </p>
            </div>
          ) : null}
        </div>

        <ul className="grid gap-4 md:grid-cols-3">
          {billing.plans.map((plan) => {
            const isCurrent = current?.key === plan.key;
            return (
              <li
                key={plan.key}
                className={cn(
                  "relative grid content-start gap-4 surface p-5",
                  plan.highlighted && "ring-2 ring-primary",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-heading text-lg font-semibold">{t(`plan.${plan.key}.name`)}</h3>
                  {isCurrent ? (
                    <Badge variant="success">{t("billing.currentBadge")}</Badge>
                  ) : plan.highlighted ? (
                    <Badge>{t("billing.popular")}</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">{t(`plan.${plan.key}.blurb`)}</p>
                <p>
                  <span className="font-heading text-3xl font-semibold">
                    {price(plan.price.amount, plan.price.currency)}
                  </span>
                  <span className="text-sm text-muted-foreground">{t("billing.perMonth")}</span>
                </p>
                <p className="flex items-center gap-2 text-sm">
                  <Check className="size-4 text-success" aria-hidden="true" />
                  {plan.maxMembers === null
                    ? t("billing.unlimitedMembers")
                    : t("billing.members", { count: String(plan.maxMembers) })}
                </p>
                {view.live ? null : (
                  <ActionButton
                    action={choose}
                    values={{ plan: plan.key }}
                    variant={plan.highlighted ? "default" : "outline"}
                    size="default"
                  >
                    {!view.everSubscribed && billing.trialDays > 0
                      ? t("billing.startTrial", { days: String(billing.trialDays) })
                      : t("billing.choose", { plan: t(`plan.${plan.key}.name`) })}
                  </ActionButton>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
