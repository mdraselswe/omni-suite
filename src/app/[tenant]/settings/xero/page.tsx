import { param } from "@/components/data/filter-bar";
import { ActionButton } from "@/components/form/action-button";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { TextField } from "@/components/form/field";
import { Section } from "@/components/layout/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  disconnectXeroAction,
  getXeroConnection,
  RECONNECT_NEEDED,
  saveXeroSettingsAction,
  syncXeroNowAction,
} from "@/features/xero";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { xeroConfigured } from "@/server/xero";

export default async function XeroPage({ params, searchParams }: PageProps<"/[tenant]/settings/xero">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "integrations.manage");
  const { timezone, locale } = ctx.tenant.settings;
  const conn = await getXeroConnection(db(), ctx.tenant.id);
  const configured = xeroConfigured();
  const error = param(sp, "error");
  const errorText =
    error === "config"
      ? t("xero.notConfigured")
      : error === "denied"
        ? t("xero.denied")
        : error === "noorg"
          ? t("xero.noOrg")
          : error
            ? t("xero.callbackFailed")
            : "";
  const reconnect = conn?.lastError === RECONNECT_NEEDED;
  const connectHref = `/api/xero/connect/?tenant=${encodeURIComponent(ctx.tenant.slug)}`;

  return (
    <div className="grid max-w-3xl gap-8">
      <Section title={t("xero.title")} description={t("xero.sub")}>
        {errorText ? (
          <Alert variant="destructive">
            <AlertDescription>{errorText}</AlertDescription>
          </Alert>
        ) : null}
        {!configured ? (
          <Alert>
            <AlertDescription>{t("xero.notConfigured")}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 surface p-4">
          {conn ? (
            <>
              <div className="grid gap-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">
                    {t("xero.connected", { name: conn.xeroTenantName || "Xero" })}
                  </p>
                  <Badge variant={conn.lastError ? "warning" : "success"}>
                    {conn.lastError ? t("xero.statusAttention") : t("xero.statusConnected")}
                  </Badge>
                </div>
                <p className="text-muted-foreground">
                  {t("xero.lastSync", {
                    when: conn.lastSyncedAt
                      ? formatDateTime(conn.lastSyncedAt, timezone, locale)
                      : t("xero.never"),
                  })}
                </p>
                {reconnect ? (
                  <p className="text-destructive">{t("xero.reconnectNeeded")}</p>
                ) : conn.lastError ? (
                  <p className="break-words whitespace-pre-line text-destructive">
                    {t("xero.lastError", { error: conn.lastError.slice(0, 500) })}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {reconnect ? (
                  <a href={connectHref} className={buttonVariants({ size: "sm" })}>
                    {t("xero.reconnect")}
                  </a>
                ) : (
                  <ActionButton action={syncXeroNowAction.bind(null, tenant)} variant="default">
                    {t("xero.syncNow")}
                  </ActionButton>
                )}
                <ActionButton
                  action={disconnectXeroAction.bind(null, tenant)}
                  variant="ghost"
                  confirm={t("form.confirm")}
                >
                  {t("xero.disconnect")}
                </ActionButton>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-1 text-sm">
                <p className="font-medium">{t("xero.notConnected")}</p>
                <p className="text-muted-foreground">{t("xero.notConnectedHint")}</p>
              </div>
              {configured ? (
                <a href={connectHref} className={cn(buttonVariants(), "justify-self-start")}>
                  {t("xero.connect")}
                </a>
              ) : null}
            </>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{t("xero.whatSyncs")}</p>
      </Section>

      {conn ? (
        <Section title={t("xero.settingsTitle")} description={t("xero.settingsSub")}>
          <ActionForm
            action={saveXeroSettingsAction.bind(null, tenant)}
            keepValues
            className="surface p-4 sm:grid-cols-3"
          >
            <TextField
              name="salesAccountCode"
              label={t("xero.salesAccount")}
              hint={t("xero.salesAccountHint")}
              defaultValue={conn.salesAccountCode}
              required
              maxLength={10}
            />
            <TextField
              name="paymentAccountCode"
              label={t("xero.paymentAccount")}
              hint={t("xero.paymentAccountHint")}
              defaultValue={conn.paymentAccountCode}
              required
              maxLength={10}
            />
            <TextField
              name="taxType"
              label={t("xero.taxType")}
              hint={t("xero.taxTypeHint")}
              defaultValue={conn.taxType}
              required
              maxLength={40}
            />
            <SubmitButton className="justify-self-start sm:col-span-3" pendingLabel={t("form.saving")}>
              {t("xero.save")}
            </SubmitButton>
          </ActionForm>
        </Section>
      ) : null}
    </div>
  );
}
