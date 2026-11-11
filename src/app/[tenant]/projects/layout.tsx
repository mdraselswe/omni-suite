import { PageHeader } from "@/components/layout/page";
import { SubNav } from "@/components/layout/sub-nav";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { hasPermission } from "@/server/tenancy/context";

export default async function ProjectsLayout({ children, params }: LayoutProps<"/[tenant]/projects">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "projects.read");
  const canTemplates = hasPermission(ctx, "projects.write", "all");
  return (
    <div>
      <PageHeader title={t("projects.title")} description={t("projects.sub")} />
      {canTemplates ? (
        <SubNav
          items={[
            { href: tenantHref(tenant, "projects"), label: t("projects.title"), exact: true },
            { href: tenantHref(tenant, "projects/templates"), label: t("projects.templates") },
          ]}
        />
      ) : null}
      {children}
    </div>
  );
}
