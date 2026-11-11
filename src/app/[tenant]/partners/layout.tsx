import { PageHeader } from "@/components/layout/page";
import { SubNav } from "@/components/layout/sub-nav";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";

export default async function PartnersLayout({ children, params }: LayoutProps<"/[tenant]/partners">) {
  const { tenant } = await params;
  await requireTenantPermission(tenant, "partners.read");
  return (
    <div>
      <PageHeader title={t("partners.title")} description={t("partners.sub")} />
      <SubNav
        items={[
          { href: tenantHref(tenant, "partners"), label: t("partners.list"), exact: true },
          { href: tenantHref(tenant, "partners/rules"), label: t("rules.title") },
          { href: tenantHref(tenant, "partners/distributions"), label: t("dist.title") },
        ]}
      />
      {children}
    </div>
  );
}
