import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { PageHeader } from "@/components/layout/page";
import { param } from "@/components/data/filter-bar";
import { createProposalAction, ProposalFields } from "@/features/proposals";
import { t } from "@/i18n";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { clientOptions } from "@/server/options";

export default async function NewProposalPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/proposals/new">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "proposals.write");
  const clients = await clientOptions(db(), ctx.tenant.id);
  const client = param(sp, "client");

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <PageHeader title={t("proposals.new")} description={t("proposals.sub")} className="mb-2" />
      <ActionForm
        action={createProposalAction.bind(null, tenant)}
        keepValues
        className="rounded-lg border bg-card p-4 sm:p-6"
      >
        <ProposalFields
          clients={clients}
          settings={ctx.tenant.settings}
          defaultClientId={clients.some((c) => c.value === client) ? client : undefined}
        />
        <SubmitButton pendingLabel={t("form.saving")} className="justify-self-start">
          {t("form.create")}
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
