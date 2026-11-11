import { PageHeader } from "@/components/layout/page";
import { SubNav } from "@/components/layout/sub-nav";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { hasPermission } from "@/server/tenancy/context";

export default async function TeamLayout({ children, params }: LayoutProps<"/[tenant]/team">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "members.read");
  return (
    <div>
      <PageHeader title={t("team.title")} description={t("team.sub")} />
      {hasPermission(ctx, "roles.manage") ? (
        <SubNav
          items={[
            { href: tenantHref(tenant, "team"), label: t("team.members"), exact: true },
            { href: tenantHref(tenant, "team/roles"), label: t("team.rolesTitle") },
          ]}
        />
      ) : null}
      {children}
    </div>
  );
}
