import { PageHeader } from "@/components/layout/page";
import { SubNav } from "@/components/layout/sub-nav";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { hasPermission } from "@/server/tenancy/context";

export default async function ClientsLayout({ children, params }: LayoutProps<"/[tenant]/clients">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "clients.read");
  return (
    <div>
      <PageHeader title={t("clients.title")} description={t("clients.sub")} />
      {hasPermission(ctx, "onboarding.manage") ? (
        <SubNav
          items={[
            { href: tenantHref(tenant, "clients"), label: t("clients.title"), exact: true },
            { href: tenantHref(tenant, "clients/onboarding"), label: t("onboarding.templates") },
          ]}
        />
      ) : null}
      {children}
    </div>
  );
}
