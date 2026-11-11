import { param } from "@/components/data/filter-bar";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { Section } from "@/components/layout/page";
import { createInvoiceAction, getInvoice, InvoiceFields } from "@/features/invoices";
import { t } from "@/i18n";
import { today } from "@/lib/dates";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { clientOptions } from "@/server/options";
import { customFieldsFor } from "@/server/shared";

const UUID = /^[0-9a-f-]{36}$/;

/** New invoice. `?client=<id>` preselects the client; `?from=<invoiceId>` copies that invoice's lines. */
export default async function NewInvoicePage({ params, searchParams }: PageProps<"/[tenant]/invoices/new">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "invoices.write");
  const database = db();
  const from = param(sp, "from");
  const [clients, defs, source] = await Promise.all([
    clientOptions(database, ctx.tenant.id),
    customFieldsFor(database, ctx.tenant.id, "invoice"),
    UUID.test(from) ? getInvoice(database, ctx.tenant.id, from) : Promise.resolve(null),
  ]);
  const client = param(sp, "client") || source?.invoice.clientId || "";

  return (
    <Section
      title={t("invoices.new")}
      description={source ? t("invoices.copyOf", { number: source.invoice.number }) : undefined}
    >
      <ActionForm
        action={createInvoiceAction.bind(null, tenant)}
        keepValues
        className="max-w-3xl surface p-4 sm:p-6"
      >
        <InvoiceFields
          clients={clients}
          settings={ctx.tenant.settings}
          defs={defs}
          today={today(ctx.tenant.settings.timezone)}
          defaultClientId={clients.some((c) => c.value === client) ? client : undefined}
          defaultItems={source?.invoice.items}
        />
        <SubmitButton pendingLabel={t("form.saving")} className="justify-self-start">
          {t("form.create")}
        </SubmitButton>
      </ActionForm>
    </Section>
  );
}
