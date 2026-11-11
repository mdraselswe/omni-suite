import { ActionButton } from "@/components/form/action-button";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { CheckboxField, SelectField, TextField } from "@/components/form/field";
import { Section } from "@/components/layout/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { serverEnv } from "@/config/env";
import { listAccounts } from "@/features/finance";
import { disconnectStripeAction, saveStripeAction, stripeConnection } from "@/features/payments";
import { t } from "@/i18n";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

export default async function PaymentsSettingsPage({ params }: PageProps<"/[tenant]/settings/payments">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "payments.online", "all");
  const [conn, accounts] = await Promise.all([
    stripeConnection(db(), ctx.tenant.id),
    listAccounts(db(), ctx.tenant.id),
  ]);
  const webhookUrl = `${serverEnv().APP_URL}/api/stripe/webhook/${ctx.tenant.id}`;
  const options = accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }));

  return (
    <div className="grid max-w-3xl gap-8">
      <Section title={t("payments.title")} description={t("payments.sub")}>
        <div className="grid gap-5 surface p-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{t("payments.status")}:</span>
            {conn ? (
              <Badge variant={conn.mode === "live" ? "success" : "warning"}>
                {t("payments.connected", { mode: t(`payments.mode.${conn.mode}`) })}
              </Badge>
            ) : (
              <Badge variant="soft">{t("payments.notConnected")}</Badge>
            )}
          </div>
          {conn?.mode === "test" ? (
            <Alert>
              <AlertDescription>{t("payments.testWarning")}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-1.5">
            <p className="text-sm font-medium">{t("payments.webhookUrl")}</p>
            <code className="rounded-md bg-muted px-3 py-2 text-xs break-all">{webhookUrl}</code>
            <p className="text-xs text-muted-foreground">{t("payments.webhookSecretHelp")}</p>
          </div>

          {options.length === 0 ? (
            <Alert>
              <AlertDescription>{t("payments.noAccounts")}</AlertDescription>
            </Alert>
          ) : (
            <ActionForm action={saveStripeAction.bind(null, tenant)} keepValues className="grid gap-4">
              <TextField
                name="secretKey"
                label={t("payments.secretKey")}
                hint={conn ? t("payments.keepSecret") : t("payments.secretKeyHelp")}
                type="password"
                autoComplete="off"
                spellCheck={false}
                required={!conn}
              />
              <TextField
                name="webhookSecret"
                label={t("payments.webhookSecret")}
                hint={conn ? t("payments.keepSecret") : undefined}
                type="password"
                autoComplete="off"
                spellCheck={false}
                required={!conn}
              />
              <SelectField
                name="accountId"
                label={t("payments.account")}
                hint={t("payments.accountHelp")}
                options={options}
                defaultValue={conn?.accountId ?? options[0]?.value}
              />
              <CheckboxField
                name="enabled"
                label={t("payments.enabled")}
                defaultChecked={conn?.enabled ?? true}
              />
              <div className="flex flex-wrap gap-2">
                <SubmitButton pendingLabel={t("form.saving")}>{t("payments.save")}</SubmitButton>
              </div>
            </ActionForm>
          )}
          {conn ? (
            <div>
              <ActionButton
                action={disconnectStripeAction.bind(null, tenant)}
                variant="ghost"
                confirm={t("form.confirm")}
              >
                {t("payments.disconnect")}
              </ActionButton>
            </div>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
