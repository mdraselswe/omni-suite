import { EmptyState, PageHeader } from "@/components/layout/page";
import { aiConfig } from "@/config/ai";
import { AssistantChat, assistantReady } from "@/features/assistant";
import { t } from "@/i18n";
import { businessName } from "@/lib/business-name";
import { PORTAL_ASSISTANT } from "@/server/tenancy/context";
import { portalPage } from "../_components/portal";

export default async function PortalAssistantPage({ params }: PageProps<"/[tenant]/portal/assistant">) {
  const { tenant } = await params;
  const { ctx } = await portalPage(tenant, PORTAL_ASSISTANT);
  const business = businessName(ctx.tenant);

  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader title={t("assistant.title")} description={t("assistant.sub", { business })} />
      {assistantReady(ctx) ? (
        <AssistantChat tenant={tenant} maxLength={aiConfig.portalAssistant.questionMaxLength} />
      ) : (
        <EmptyState title={t("assistant.notReady")} body={t("assistant.notReadySub", { business })} />
      )}
    </div>
  );
}
