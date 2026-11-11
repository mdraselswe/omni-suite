import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionButton } from "@/components/form/action-button";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { TextAreaField } from "@/components/form/field";
import { EmptyState, PageHeader, Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { ButtonAnchor, ButtonLink } from "@/components/ui/button-link";
import { formatBytes, listFiles } from "@/features/files";
import {
  addCommentAction,
  approveTaskAction,
  getProject,
  listComments,
  listTasks,
} from "@/features/projects";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { db } from "@/server/db";
import { hasPermission } from "@/server/tenancy/context";
import { portalPage } from "../../_components/portal";

export default async function PortalProject({ params }: PageProps<"/[tenant]/portal/projects/[projectId]">) {
  const { tenant, projectId } = await params;
  const { ctx } = await portalPage(tenant, "portal.projects");
  if (!/^[0-9a-f-]{36}$/.test(projectId)) notFound();
  const database = db();
  const project = await getProject(database, ctx, "all", projectId);
  if (!project) notFound();

  const f = formatters(ctx);
  const canApprove = hasPermission(ctx, "portal.approve");
  const canFiles = hasPermission(ctx, "portal.files");
  const [tasks, comments, files] = await Promise.all([
    listTasks(database, ctx, project.id),
    listComments(database, ctx, "project", project.id),
    canFiles
      ? listFiles(database, ctx, "all", { entityType: "project", entityId: project.id })
      : Promise.resolve([]),
  ]);
  const status = ctx.tenant.settings.projectStatuses.find((s) => s.key === project.status);
  const { timezone, locale } = ctx.tenant.settings;

  return (
    <div className="grid gap-8">
      <div>
        <ButtonLink
          href={tenantHref(tenant, "portal/projects")}
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2"
        >
          {t("portal.backToList")}
        </ButtonLink>
        <PageHeader
          title={project.name}
          description={project.description || undefined}
          actions={
            <StatusBadge
              status={status?.done ? "done" : project.status}
              label={status?.label ?? project.status}
            />
          }
        />
      </div>

      <Section title={t("portal.tasks")}>
        {tasks.length === 0 ? (
          <EmptyState title={t("tasks.none")} />
        ) : (
          <ul className="divide-y overflow-hidden surface">
            {tasks.map(({ task }) => {
              const waiting = task.needsApproval && task.status === "review" && !task.approvedAt;
              return (
                <li
                  key={task.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="grid min-w-0 gap-1">
                    <span className="font-medium">{task.title}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={task.status} label={t(`tasks.status.${task.status}`)} />
                      {task.approvedAt ? <Badge variant="secondary">{t("portal.approved")}</Badge> : null}
                      {waiting ? <Badge variant="outline">{t("tasks.awaitingApproval")}</Badge> : null}
                      {task.dueDate ? (
                        <span className="text-xs text-muted-foreground">
                          {t("portal.due", { date: f.date(task.dueDate) })}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {waiting && canApprove ? (
                    <ActionButton
                      action={approveTaskAction.bind(null, tenant)}
                      values={{ id: task.id }}
                      variant="default"
                      confirm={t("form.confirm")}
                    >
                      {t("portal.approve")}
                    </ActionButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title={t("comments.title")}>
          {comments.length === 0 ? (
            <EmptyState title={t("comments.none")} />
          ) : (
            <ul className="grid gap-3">
              {comments.map(({ comment, authorName }) => (
                <li key={comment.id} className="grid gap-1 surface p-3 text-sm">
                  <span className="text-xs text-muted-foreground">
                    {authorName ?? "—"} · {formatDateTime(comment.createdAt, timezone, locale)}
                  </span>
                  <p className="whitespace-pre-wrap">{comment.body}</p>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={addCommentAction.bind(null, tenant)}>
            <input type="hidden" name="projectId" value={project.id} />
            <TextAreaField
              name="body"
              label={t("portal.comment")}
              placeholder={t("comments.placeholder")}
              rows={3}
              required
            />
            <SubmitButton className="justify-self-start">{t("comments.add")}</SubmitButton>
          </ActionForm>
        </Section>

        {canFiles ? (
          <Section title={t("files.title")}>
            {files.length === 0 ? (
              <EmptyState title={t("files.none")} />
            ) : (
              <ul className="divide-y overflow-hidden surface">
                {files.map(({ file }) => (
                  <li
                    key={file.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{file.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                      <ButtonAnchor href={`/api/t/${tenant}/files/${file.id}/`} variant="outline" size="sm">
                        {t("form.download")}
                      </ButtonAnchor>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}
      </div>
    </div>
  );
}
