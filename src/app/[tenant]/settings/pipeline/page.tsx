import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { TextAreaField } from "@/components/form/field";
import { Section } from "@/components/layout/page";
import { updatePipelineAction } from "@/features/settings";
import { t } from "@/i18n";
import { requireTenantPermission } from "@/server/auth/session";

export default async function PipelinePage({ params }: PageProps<"/[tenant]/settings/pipeline">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "settings.manage");
  const { pipelineStages, projectStatuses } = ctx.tenant.settings;

  return (
    <Section title={t("settings.pipeline")} description={t("settings.pipelineSub")} className="max-w-3xl">
      <ActionForm action={updatePipelineAction.bind(null, tenant)} keepValues>
        <div className="grid gap-4 md:grid-cols-2">
          <TextAreaField
            name="stages"
            label={t("settings.leadStages")}
            hint={t("settings.keysInUseHint")}
            rows={8}
            className="font-mono"
            defaultValue={pipelineStages.map((s) => `${s.key} | ${s.label} | ${s.kind}`).join("\n")}
            required
          />
          <TextAreaField
            name="statuses"
            label={t("settings.projectStatuses")}
            rows={8}
            className="font-mono"
            defaultValue={projectStatuses
              .map((s) => `${s.key} | ${s.label}${s.done ? " | done" : ""}`)
              .join("\n")}
            required
          />
        </div>
        <SubmitButton className="justify-self-start" pendingLabel={t("form.saving")}>
          {t("form.save")}
        </SubmitButton>
      </ActionForm>
    </Section>
  );
}
