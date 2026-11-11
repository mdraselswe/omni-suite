import Link from "next/link";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { EmptyState, PageHeader } from "@/components/layout/page";
import { platformTenants, setTenantStatusAction } from "@/features/settings";
import { t } from "@/i18n";
import { formatDate } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { requirePlatformAdmin } from "@/server/auth/session";
import { db } from "@/server/db";

const control =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

export default async function AdminPage() {
  await requirePlatformAdmin();
  const rows = await platformTenants(db());

  return (
    <div className="grid gap-6">
      <PageHeader title={t("admin.title")} description={t("admin.sub")} />
      {rows.length === 0 ? (
        <EmptyState title={t("admin.none")} />
      ) : (
        <ul className="grid gap-3">
          {rows.map(({ tenant, members }) => (
            <li
              key={tenant.id}
              className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-[1fr_auto] md:items-end"
            >
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={tenantHref(tenant.slug)} className="font-medium hover:underline">
                    {tenant.name}
                  </Link>
                  <StatusBadge
                    status={tenant.status}
                    label={tenant.status === "active" ? t("admin.active") : t("admin.suspended")}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  /{tenant.slug} · {t("admin.members")}: {members} · {t("admin.created")}:{" "}
                  {formatDate(tenant.createdAt.toISOString().slice(0, 10))}
                </p>
              </div>
              <ActionForm
                action={setTenantStatusAction}
                keepValues
                className="grid-cols-[1fr_1fr_auto] items-end gap-2"
              >
                <input type="hidden" name="tenantId" value={tenant.id} />
                <label className="grid gap-1 text-xs text-muted-foreground">
                  {t("admin.plan")}
                  <input name="plan" defaultValue={tenant.plan} required maxLength={40} className={control} />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  {t("admin.status")}
                  <select name="status" defaultValue={tenant.status} className={control}>
                    <option value="active">{t("admin.active")}</option>
                    <option value="suspended">{t("admin.suspended")}</option>
                  </select>
                </label>
                <SubmitButton variant="outline" pendingLabel={t("form.saving")}>
                  {t("admin.save")}
                </SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
