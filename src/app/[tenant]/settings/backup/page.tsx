import { param } from "@/components/data/filter-bar";
import { ActionButton } from "@/components/form/action-button";
import { Section } from "@/components/layout/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { disconnectBackupAction, getConnection, queueBackupAction } from "@/features/backup";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { exportableSets } from "@/server/export";
import { googleConfigured } from "@/server/google";

export default async function BackupPage({ params, searchParams }: PageProps<"/[tenant]/settings/backup">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "backup.manage");
  const { timezone, locale } = ctx.tenant.settings;
  const conn = await getConnection(db(), ctx.tenant.id);
  const configured = googleConfigured();
  const error = param(sp, "error");
  const errorText =
    error === "config"
      ? t("backup.notConfigured")
      : error === "denied"
        ? t("backup.denied")
        : error
          ? t("backup.callbackFailed")
          : "";
  const when = (d: Date | null) => (d ? formatDateTime(d, timezone, locale) : t("backup.never"));
  const csvSets = exportableSets(ctx);
  const canCsv = csvSets.length > 0;
  const queue = queueBackupAction.bind(null, tenant);
  const link = "text-sm font-medium text-primary underline-offset-4 hover:underline";

  return (
    <div className="grid max-w-3xl gap-8">
      <Section title={t("backup.title")} description={t("backup.sub")}>
        {errorText ? (
          <Alert variant="destructive">
            <AlertDescription>{errorText}</AlertDescription>
          </Alert>
        ) : null}
        {!configured ? (
          <Alert>
            <AlertDescription>{t("backup.notConfigured")}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 surface p-4">
          {conn ? (
            <>
              <div className="grid gap-1 text-sm">
                <p className="font-medium">
                  {t("backup.connected", { email: conn.googleEmail || "Google" })}
                </p>
                <p className="text-muted-foreground">
                  {t("backup.lastSync", { when: when(conn.lastSyncedAt) })}
                </p>
                <p className="text-muted-foreground">
                  {t("backup.lastSnapshot", { when: when(conn.lastSnapshotAt) })}
                </p>
                {conn.lastError ? (
                  <p className="break-words text-destructive">
                    {t("backup.lastError", { error: conn.lastError.slice(0, 300) })}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-3">
                {conn.spreadsheetId ? (
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(conn.spreadsheetId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={link}
                  >
                    {t("backup.openSheet")}
                  </a>
                ) : null}
                {conn.folderId ? (
                  <a
                    href={`https://drive.google.com/drive/folders/${encodeURIComponent(conn.folderId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={link}
                  >
                    {t("backup.openFolder")}
                  </a>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <ActionButton action={queue} values={{ kind: "full" }} variant="default">
                  {t("backup.fullNow")}
                </ActionButton>
                <ActionButton action={queue} values={{ kind: "snapshot" }}>
                  {t("backup.snapshotNow")}
                </ActionButton>
                <ActionButton
                  action={disconnectBackupAction.bind(null, tenant)}
                  variant="ghost"
                  confirm={t("form.confirm")}
                >
                  {t("backup.disconnect")}
                </ActionButton>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-1 text-sm">
                <p className="font-medium">{t("backup.notConnected")}</p>
                <p className="text-muted-foreground">{t("settings.notConnectedHint")}</p>
              </div>
              {configured ? (
                <a
                  href={`/api/google/connect/?tenant=${encodeURIComponent(ctx.tenant.slug)}`}
                  className={cn(buttonVariants(), "justify-self-start")}
                >
                  {t("backup.connect")}
                </a>
              ) : null}
            </>
          )}
        </div>
      </Section>

      <Section title={t("backup.export")} description={t("backup.exportSub")}>
        <a
          href={`/api/t/${encodeURIComponent(ctx.tenant.slug)}/export/all.json`}
          className={cn(buttonVariants({ variant: "outline" }), "justify-self-start")}
          download
        >
          {t("backup.exportJson")}
        </a>
        {canCsv ? (
          <div className="grid gap-2">
            <h3 className="text-sm font-medium">{t("backup.sets")}</h3>
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {csvSets.map((set) => (
                <li key={set}>
                  <a
                    href={`/api/t/${encodeURIComponent(ctx.tenant.slug)}/export/${set}.csv`}
                    className={link}
                    download
                  >
                    {set}.csv
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
