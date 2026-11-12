import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { Section } from "@/components/layout/page";
import { attachmentMaxMb, BillFields, createBillAction, supplierNames } from "@/features/bills";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { currencyOptions } from "@/lib/intl-options";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { categoryOptions } from "@/server/options";

export default async function NewBillPage({ params }: PageProps<"/[tenant]/bills/new">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "bills.write");
  const settings = ctx.tenant.settings;
  const database = db();
  const [suppliers, categories] = await Promise.all([
    supplierNames(database, ctx.tenant.id),
    categoryOptions(database, ctx.tenant.id),
  ]);

  return (
    <Section title={t("bills.new")} description={t("bills.newSub")}>
      <ActionForm
        action={createBillAction.bind(null, tenant)}
        keepValues
        className="max-w-3xl surface p-4 sm:p-6"
      >
        <BillFields
          suppliers={suppliers}
          categories={categories
            .filter((c) => c.kind === "expense")
            .map((c) => ({ value: c.value, label: c.name }))}
          currencies={currencyOptions()}
          baseCurrency={settings.currency}
          tax={settings.tax.rateBp > 0 ? { name: settings.tax.name, rateBp: settings.tax.rateBp } : null}
          today={today(settings.timezone)}
          termsDays={settings.paymentTermsDays}
          maxFileMb={attachmentMaxMb()}
        />
        <SubmitButton pendingLabel={t("form.saving")} className="justify-self-start">
          {t("bills.create")}
        </SubmitButton>
      </ActionForm>
    </Section>
  );
}
