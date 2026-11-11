import { PageHeader } from "@/components/layout/page";
import { SubNav } from "@/components/layout/sub-nav";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";

export default async function InvoicesLayout({ children, params }: LayoutProps<"/[tenant]/invoices">) {
  const { tenant } = await params;
  await requireTenantPermission(tenant, "invoices.read");
  return (
    <div>
      <div className="print:hidden">
        <PageHeader title={t("invoices.title")} description={t("invoices.sub")} />
        <SubNav
          items={[
            { href: tenantHref(tenant, "invoices"), label: t("invoices.title"), exact: true },
            { href: tenantHref(tenant, "invoices/recurring"), label: t("invoices.recurring") },
          ]}
        />
      </div>
      {children}
    </div>
  );
}
