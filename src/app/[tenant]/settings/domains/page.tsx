import { ActionButton } from "@/components/form/action-button";
import { TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { StatusBadge } from "@/components/data/status-badge";
import {
  addDomainAction,
  domainVerifyName,
  listDomains,
  removeDomainAction,
  verifyDomainAction,
} from "@/features/settings";
import { serverEnv } from "@/config/env";
import { t } from "@/i18n";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

export default async function DomainsPage({ params }: PageProps<"/[tenant]/settings/domains">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "domains.manage");
  const domains = await listDomains(db(), ctx.tenant.id);
  const target = serverEnv().CUSTOM_DOMAIN_TARGET;

  return (
    <Section
      title={t("domains.title")}
      description={t("domains.sub")}
      className="max-w-3xl"
      actions={
        <FormDialog
          trigger={t("domains.add")}
          title={t("domains.add")}
          action={addDomainAction.bind(null, tenant)}
        >
          <TextField
            name="hostname"
            label={t("domains.hostname")}
            placeholder="portal.example.com.au"
            autoCapitalize="none"
            autoComplete="off"
            required
          />
        </FormDialog>
      }
    >
      {domains.length === 0 ? (
        <EmptyState title={t("domains.none")} />
      ) : (
        <ul className="grid gap-3">
          {domains.map((d) => (
            <li key={d.id} className="grid gap-3 surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-medium break-all">{d.hostname}</span>
                  <StatusBadge
                    status={d.verifiedAt ? "active" : "draft"}
                    label={d.verifiedAt ? t("domains.verified") : t("domains.pending")}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {!d.verifiedAt ? (
                    <ActionButton
                      action={verifyDomainAction.bind(null, tenant)}
                      values={{ id: d.id }}
                      variant="default"
                    >
                      {t("domains.verify")}
                    </ActionButton>
                  ) : null}
                  <ActionButton
                    action={removeDomainAction.bind(null, tenant)}
                    values={{ id: d.id }}
                    confirm={t("form.confirm")}
                    variant="ghost"
                  >
                    {t("domains.remove")}
                  </ActionButton>
                </div>
              </div>
              <div className="grid gap-1 text-sm">
                <p className="text-muted-foreground">{t("domains.instructions")}</p>
                <ol className="grid list-decimal gap-1 pl-5 font-mono text-xs break-all">
                  <li>
                    {t("domains.step1", { name: domainVerifyName(d.hostname), value: d.verificationToken })}
                  </li>
                  <li>{t("domains.step2", { host: d.hostname, target })}</li>
                </ol>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
