import type { Route } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page";
import { SubNav } from "@/components/layout/sub-nav";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { requireTenant } from "@/server/auth/session";
import { hasPermission } from "@/server/tenancy/context";

export default async function SettingsLayout({ children, params }: LayoutProps<"/[tenant]/settings">) {
  const { tenant } = await params;
  const ctx = await requireTenant(tenant);
  const general = hasPermission(ctx, "settings.manage");
  const backup = hasPermission(ctx, "backup.manage");
  const domains = hasPermission(ctx, "domains.manage");
  if (!general && !backup && !domains) notFound();

  const items: { href: Route; label: string; exact?: boolean }[] = [];
  if (general) {
    items.push(
      { href: tenantHref(tenant, "settings"), label: t("settings.general"), exact: true },
      { href: tenantHref(tenant, "settings/modules"), label: t("settings.modules") },
      { href: tenantHref(tenant, "settings/fields"), label: t("settings.customFields") },
      { href: tenantHref(tenant, "settings/pipeline"), label: t("settings.pipeline") },
    );
  }
  if (backup) items.push({ href: tenantHref(tenant, "settings/backup"), label: t("settings.backup") });
  if (domains) items.push({ href: tenantHref(tenant, "settings/domains"), label: t("settings.domains") });

  return (
    <div>
      <PageHeader title={t("settings.title")} description={t("settings.sub")} />
      <SubNav items={items} />
      {children}
    </div>
  );
}
