import { TextAreaField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { listTemplates, saveTemplateAction, type OnboardingField } from "@/features/clients";
import { t } from "@/i18n";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

/** Back to the editable line format: "label | type | required". */
function questionLines(fields: readonly OnboardingField[]): string {
  return fields
    .map((f) => [f.label, f.type, f.required ? "required" : ""].filter(Boolean).join(" | "))
    .join("\n");
}

function TemplateFields({
  template,
}: {
  template?: { id: string; name: string; fields: OnboardingField[]; checklist: string[] };
}) {
  return (
    <>
      {template ? <input type="hidden" name="id" value={template.id} /> : null}
      <TextField name="name" label={t("form.name")} defaultValue={template?.name} required />
      <TextAreaField
        name="questions"
        label={t("onboarding.questions")}
        hint={t("onboarding.questionsHint")}
        rows={6}
        defaultValue={template ? questionLines(template.fields) : ""}
      />
      <TextAreaField
        name="checklist"
        label={t("onboarding.checklist")}
        hint={t("onboarding.checklistHint")}
        rows={4}
        defaultValue={template?.checklist.join("\n") ?? ""}
      />
    </>
  );
}

export default async function OnboardingTemplatesPage({ params }: PageProps<"/[tenant]/clients/onboarding">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "onboarding.manage");
  const templates = await listTemplates(db(), ctx.tenant.id);
  const action = saveTemplateAction.bind(null, tenant);

  return (
    <Section
      title={t("onboarding.templates")}
      description={t("onboarding.templatesSub")}
      actions={
        <FormDialog
          trigger={t("onboarding.newTemplate")}
          title={t("onboarding.newTemplate")}
          action={action}
          wide
        >
          <TemplateFields />
        </FormDialog>
      }
    >
      {templates.length === 0 ? (
        <EmptyState title={t("onboarding.noTemplates")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((tp) => (
            <article key={tp.id} className="grid content-start gap-3 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-0.5">
                  <h3 className="font-medium">{tp.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("onboarding.counts", {
                      questions: String(tp.fields.length),
                      items: String(tp.checklist.length),
                    })}
                  </p>
                </div>
                <FormDialog
                  trigger={t("form.edit")}
                  title={tp.name}
                  action={action}
                  variant="outline"
                  size="sm"
                  icon={false}
                  wide
                >
                  <TemplateFields template={tp} />
                </FormDialog>
              </div>
              {tp.fields.length > 0 ? (
                <ul className="grid gap-1 text-sm">
                  {tp.fields.map((field) => (
                    <li key={field.key} className="flex flex-wrap items-center gap-1.5">
                      <span>{field.label}</span>
                      {field.required ? (
                        <Badge variant="outline">{t("onboarding.requiredBadge")}</Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </Section>
  );
}
