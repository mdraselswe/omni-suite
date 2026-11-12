import { ActionButton } from "@/components/form/action-button";
import { TextAreaField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import {
  deleteProjectTemplateAction,
  listProjectTemplates,
  saveProjectTemplateAction,
  templateTaskLine,
} from "@/features/projects";
import { t } from "@/i18n";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

export default async function ProjectTemplatesPage({ params }: PageProps<"/[tenant]/projects/templates">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "projects.write", "all");
  const templates = await listProjectTemplates(db(), ctx.tenant.id);
  const action = saveProjectTemplateAction.bind(null, tenant);

  return (
    <Section
      title={t("projects.templates")}
      description={t("projects.templatesSub")}
      actions={
        <FormDialog trigger={t("projects.newTemplate")} title={t("projects.newTemplate")} action={action}>
          <TextField name="name" label={t("form.name")} required />
          <TextAreaField
            name="tasks"
            label={t("projects.templateTasks")}
            hint={t("projects.templateTasksFlagsHint")}
            rows={8}
          />
        </FormDialog>
      }
    >
      {templates.length === 0 ? (
        <EmptyState title={t("projects.noTemplates")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((tpl) => (
            <div key={tpl.id} className="grid content-start gap-3 surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{tpl.name}</h3>
                <div className="flex flex-wrap gap-1">
                  <FormDialog
                    trigger={t("form.edit")}
                    title={t("projects.editTemplate")}
                    action={action}
                    variant="ghost"
                    size="sm"
                    icon={false}
                  >
                    <input type="hidden" name="id" value={tpl.id} />
                    <TextField name="name" label={t("form.name")} defaultValue={tpl.name} required />
                    <TextAreaField
                      name="tasks"
                      label={t("projects.templateTasks")}
                      hint={t("projects.templateTasksFlagsHint")}
                      rows={8}
                      defaultValue={tpl.tasks.map(templateTaskLine).join("\n")}
                    />
                  </FormDialog>
                  <ActionButton
                    action={deleteProjectTemplateAction.bind(null, tenant)}
                    values={{ id: tpl.id }}
                    variant="ghost"
                    confirm={t("projects.deleteTemplateConfirm")}
                  >
                    {t("form.delete")}
                  </ActionButton>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("projects.taskCount", { count: tpl.tasks.length })}
              </p>
              <ul className="grid gap-1 text-sm">
                {tpl.tasks.map((task, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <span>{task.title}</span>
                    {task.clientVisible ? <Badge variant="outline">{t("tasks.clientVisible")}</Badge> : null}
                    {task.needsApproval ? (
                      <Badge variant="secondary">{t("projects.templateApproval")}</Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
