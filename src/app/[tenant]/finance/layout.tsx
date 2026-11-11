import { PageHeader } from "@/components/layout/page";
import { SubNav } from "@/components/layout/sub-nav";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";

export default async function FinanceLayout({ children, params }: LayoutProps<"/[tenant]/finance">) {
  const { tenant } = await params;
  await requireTenantPermission(tenant, "finance.read");
  return (
    <div>
      <PageHeader title={t("finance.title")} description={t("finance.sub")} />
      <SubNav
        items={[
          { href: tenantHref(tenant, "finance"), label: t("finance.transactions"), exact: true },
          { href: tenantHref(tenant, "finance/report"), label: t("finance.report") },
          { href: tenantHref(tenant, "finance/setup"), label: t("finance.accounts") },
        ]}
      />
      {children}
    </div>
  );
}
