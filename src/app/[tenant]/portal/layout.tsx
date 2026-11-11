import { EmptyState } from "@/components/layout/page";
import { t } from "@/i18n";
import { requireTenantPermission } from "@/server/auth/session";

export default async function PortalLayout({ children, params }: LayoutProps<"/[tenant]/portal">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "portal.access");
  if (ctx.membership.kind === "client" && !ctx.membership.clientId) {
    return (
      <EmptyState title={t("portal.title")} body={t("portal.noAccess", { business: ctx.tenant.name })} />
    );
  }
  return children;
}
