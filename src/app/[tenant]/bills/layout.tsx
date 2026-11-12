import { PageHeader } from "@/components/layout/page";
import { t } from "@/i18n";
import { requireTenantPermission } from "@/server/auth/session";

export default async function BillsLayout({ children, params }: LayoutProps<"/[tenant]/bills">) {
  const { tenant } = await params;
  await requireTenantPermission(tenant, "bills.read");
  return (
    <div>
      <PageHeader title={t("bills.title")} description={t("bills.sub")} />
      {children}
    </div>
  );
}
