import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionButton } from "@/components/form/action-button";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { CustomFieldValues } from "@/components/form/custom-field-inputs";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section, StatCard } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { formatBytes, listFiles, uploadFileAction, deleteFileAction } from "@/features/files";
import {
  addCommentAction,
  createTaskAction,
  deleteTaskAction,
  getProject,
  listComments,
  listTasks,
  logTimeAction,
  ProjectFields,
  projectEconomics,
  projectTeam,
  setProjectMemberAction,
  setTaskStatusAction,
  TaskStatusSelect,
  updateProjectAction,
  updateTaskAction,
} from "@/features/projects";
import { t } from "@/i18n";
import { formatDateTime, today } from "@/lib/dates";
import type { CustomValues } from "@/lib/custom-fields";
import { appHref } from "@/lib/href";
import { toDecimalString } from "@/lib/money";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { clientOptions, memberOptions } from "@/server/options";
import { customFieldsFor } from "@/server/shared";
import { hasPermission } from "@/server/tenancy/context";

const STATUSES = ["todo", "in_progress", "review", "done"] as const;

/** Stored JSON → custom values (drops anything that isn't a plain value). */
function customOf(value: Record<string, unknown>): CustomValues {
  const out: CustomValues = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

export default async function ProjectPage({ params }: PageProps<"/[tenant]/projects/[projectId]">) {
  const { tenant, projectId } = await params;
  const { ctx, scope } = await requireTenantPermission(tenant, "projects.read");
  if (!/^[0-9a-f-]{36}$/.test(projectId)) notFound();
  const database = db();
  const project = await getProject(database, ctx, scope, projectId);
  if (!project) notFound();

  const f = formatters(ctx);
  const tz = ctx.tenant.settings.timezone;
  const now = today(tz);
  const canWrite = hasPermission(ctx, "projects.write");
  const canTasks = hasPermission(ctx, "tasks.write");
  const canTime = hasPermission(ctx, "time.write");
  const fileScope = ctx.permissions.get("files.read");
  const canUpload = hasPermission(ctx, "files.write");
  const statuses = ctx.tenant.settings.projectStatuses;
  const statusLabel = statuses.find((s) => s.key === project.status)?.label ?? project.status;
  const isDone = statuses.find((s) => s.key === project.status)?.done ?? false;

  const [tasks, team, comments, files, economics, members, clients, customFields] = await Promise.all([
    listTasks(database, ctx, project.id),
    projectTeam(database, project.id),
    listComments(database, ctx, "project", project.id),
    fileScope
      ? listFiles(database, ctx, fileScope, { entityType: "project", entityId: project.id })
      : Promise.resolve([]),
    canWrite ? projectEconomics(database, project.id) : Promise.resolve(null),
    memberOptions(database, ctx.tenant.id),
    canWrite ? clientOptions(database, ctx.tenant.id) : Promise.resolve([]),
    customFieldsFor(database, ctx.tenant.id, "project"),
  ]);
  const teamOptions = team.map((m) => ({ value: m.membershipId, label: m.name }));
  const assigneeOptions = teamOptions.length > 0 ? teamOptions : members;
  const addable = members.filter((m) => !team.some((x) => x.membershipId === m.value));
  const taskOptions = tasks.map(({ task }) => ({ value: task.id, label: task.title }));
  const currency = ctx.tenant.settings.currency;
  const custom = customOf(project.custom);

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-xl font-semibold">{project.name}</h2>
            <StatusBadge status={isDone ? "done" : project.status} label={statusLabel} />
          </div>
          <p className="text-sm text-muted-foreground">
            {project.clientName ?? t("projects.internal")}
            {project.startDate ? ` · ${t("projects.start")} ${f.date(project.startDate)}` : ""}
            {project.dueDate ? ` · ${t("projects.due")} ${f.date(project.dueDate)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canTime ? (
            <FormDialog
              trigger={t("projects.logTime")}
              title={t("time.log")}
              action={logTimeAction.bind(null, tenant)}
              variant="outline"
            >
              <input type="hidden" name="projectId" value={project.id} />
              {taskOptions.length > 0 ? (
                <SelectField
                  name="taskId"
                  label={t("tasks.title")}
                  options={taskOptions}
                  placeholder={t("form.none")}
                />
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField name="date" label={t("form.date.label")} type="date" defaultValue={now} required />
                <TextField
                  name="duration"
                  label={t("time.duration")}
                  hint={t("time.durationHint")}
                  required
                />
              </div>
              <TextField name="note" label={t("time.note")} />
              <CheckboxField name="billable" label={t("time.billable")} defaultChecked />
            </FormDialog>
          ) : null}
          {canWrite ? (
            <FormDialog
              trigger={t("projects.edit")}
              title={t("projects.edit")}
              action={updateProjectAction.bind(null, tenant)}
              variant="outline"
              icon={false}
              wide
            >
              <input type="hidden" name="id" value={project.id} />
              <ProjectFields
                clients={clients}
                statuses={statuses.map((s) => ({ value: s.key, label: s.label }))}
                customFields={customFields}
                values={{
                  name: project.name,
                  description: project.description,
                  clientId: project.clientId,
                  status: project.status,
                  startDate: project.startDate,
                  dueDate: project.dueDate,
                  budget: project.budgetMinor > 0n ? toDecimalString(project.budgetMinor, currency) : "",
                  custom,
                }}
              />
            </FormDialog>
          ) : null}
        </div>
      </div>

      {project.description ? (
        <p className="max-w-prose text-sm whitespace-pre-line">{project.description}</p>
      ) : null}
      <CustomFieldValues defs={customFields} values={custom} />

      {economics ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={t("projects.timeLogged")} value={f.minutes(economics.minutes)} />
          <StatCard label={t("projects.cost")} value={f.money(economics.costMinor)} />
          <StatCard label={t("projects.billable")} value={f.money(economics.billableMinor)} />
          <StatCard
            label={t("projects.budget")}
            value={project.budgetMinor > 0n ? f.money(project.budgetMinor) : "—"}
            hint={
              project.budgetMinor > 0n
                ? t("projects.budgetUsed", {
                    percent: f.percent(Number((economics.billableMinor * 10000n) / project.budgetMinor)),
                  })
                : undefined
            }
            tone={
              project.budgetMinor > 0n && economics.billableMinor > project.budgetMinor
                ? "negative"
                : "default"
            }
          />
        </div>
      ) : null}

      <Section
        title={t("tasks.title")}
        actions={
          canTasks ? (
            <FormDialog
              trigger={t("tasks.new")}
              title={t("tasks.new")}
              action={createTaskAction.bind(null, tenant)}
            >
              <input type="hidden" name="projectId" value={project.id} />
              <TextField name="title" label={t("form.name")} required />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  name="assigneeMembershipId"
                  label={t("tasks.assignee")}
                  options={assigneeOptions}
                  placeholder={t("tasks.unassigned")}
                />
                <TextField name="dueDate" label={t("projects.due")} type="date" />
              </div>
              <TextAreaField name="description" label={t("form.description")} rows={3} />
              <CheckboxField name="clientVisible" label={t("tasks.clientVisible")} />
              <CheckboxField name="needsApproval" label={t("tasks.needsApproval")} />
            </FormDialog>
          ) : null
        }
      >
        {tasks.length === 0 ? (
          <EmptyState title={t("tasks.none")} />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {STATUSES.map((status) => {
              const group = tasks.filter(({ task }) => task.status === status);
              return (
                <div key={status} className="grid content-start gap-2">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    {t(`tasks.status.${status}`)} ({group.length})
                  </h3>
                  {group.map(({ task, assigneeName }) => (
                    <div key={task.id} className="grid gap-2 surface p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium">{task.title}</p>
                        {canTasks ? (
                          <TaskStatusSelect
                            action={setTaskStatusAction.bind(null, tenant)}
                            id={task.id}
                            status={task.status}
                            label={t("form.status")}
                          />
                        ) : null}
                      </div>
                      {task.description ? (
                        <p className="text-sm whitespace-pre-line text-muted-foreground">
                          {task.description}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{assigneeName ?? t("tasks.unassigned")}</span>
                        {task.dueDate ? <span>· {f.date(task.dueDate)}</span> : null}
                        {task.clientVisible ? (
                          <Badge variant="outline">{t("tasks.clientVisible")}</Badge>
                        ) : null}
                        {task.needsApproval && !task.approvedAt ? (
                          <Badge variant="secondary">{t("tasks.awaitingApproval")}</Badge>
                        ) : null}
                        {task.approvedAt ? <Badge>{t("tasks.approved")}</Badge> : null}
                      </div>
                      {canTasks ? (
                        <div className="flex flex-wrap gap-2">
                          <FormDialog
                            trigger={t("form.edit")}
                            title={task.title}
                            action={updateTaskAction.bind(null, tenant)}
                            variant="ghost"
                            size="sm"
                            icon={false}
                          >
                            <input type="hidden" name="id" value={task.id} />
                            <TextField
                              name="title"
                              label={t("form.name")}
                              defaultValue={task.title}
                              required
                            />
                            <div className="grid gap-4 sm:grid-cols-2">
                              <SelectField
                                name="status"
                                label={t("form.status")}
                                options={STATUSES.map((s) => ({ value: s, label: t(`tasks.status.${s}`) }))}
                                defaultValue={task.status}
                              />
                              <SelectField
                                name="assigneeMembershipId"
                                label={t("tasks.assignee")}
                                options={assigneeOptions}
                                placeholder={t("tasks.unassigned")}
                                defaultValue={task.assigneeMembershipId ?? ""}
                              />
                              <TextField
                                name="dueDate"
                                label={t("projects.due")}
                                type="date"
                                defaultValue={task.dueDate ?? ""}
                              />
                            </div>
                            <TextAreaField
                              name="description"
                              label={t("form.description")}
                              rows={3}
                              defaultValue={task.description}
                            />
                            <CheckboxField
                              name="clientVisible"
                              label={t("tasks.clientVisible")}
                              defaultChecked={task.clientVisible}
                            />
                            <CheckboxField
                              name="needsApproval"
                              label={t("tasks.needsApproval")}
                              defaultChecked={task.needsApproval}
                            />
                          </FormDialog>
                          <ActionButton
                            action={deleteTaskAction.bind(null, tenant)}
                            values={{ id: task.id }}
                            confirm={t("form.confirm")}
                            variant="ghost"
                          >
                            {t("form.delete")}
                          </ActionButton>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title={t("projects.members")}>
          {team.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("projects.noMembers")}</p>
          ) : (
            <ul className="grid gap-2">
              {team.map((m) => (
                <li
                  key={m.membershipId}
                  className="flex items-center justify-between gap-2 rounded-md border p-2"
                >
                  <div className="grid min-w-0">
                    <span className="truncate text-sm font-medium">{m.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                  </div>
                  {canWrite ? (
                    <ActionButton
                      action={setProjectMemberAction.bind(null, tenant)}
                      values={{ projectId: project.id, membershipId: m.membershipId, add: "false" }}
                      variant="ghost"
                    >
                      {t("projects.removeMember")}
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canWrite ? (
            addable.length > 0 ? (
              <ActionForm
                action={setProjectMemberAction.bind(null, tenant)}
                className="sm:grid-cols-[1fr_auto] sm:items-end"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="add" value="true" />
                <SelectField name="membershipId" label={t("projects.addMember")} options={addable} />
                <SubmitButton variant="outline" pendingLabel={t("form.saving")}>
                  {t("form.add")}
                </SubmitButton>
              </ActionForm>
            ) : (
              <p className="text-xs text-muted-foreground">{t("projects.noTeamToAdd")}</p>
            )
          ) : null}
        </Section>

        {fileScope ? (
          <Section
            title={t("files.title")}
            actions={
              canUpload ? (
                <FormDialog
                  trigger={t("projects.uploadFile")}
                  title={t("files.upload")}
                  action={uploadFileAction.bind(null, tenant)}
                  variant="outline"
                >
                  <input type="hidden" name="entityType" value="project" />
                  <input type="hidden" name="entityId" value={project.id} />
                  <TextField name="file" label={t("files.file")} type="file" required />
                  <CheckboxField name="clientVisible" label={t("files.clientVisible")} />
                </FormDialog>
              ) : null
            }
          >
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("files.none")}</p>
            ) : (
              <ul className="grid gap-2">
                {files.map(({ file }) => (
                  <li key={file.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                    <a
                      href={appHref(`/api/t/${tenant}/files/${file.id}/`)}
                      className="min-w-0 truncate text-sm font-medium hover:underline"
                    >
                      {file.name}
                    </a>
                    <div className="flex shrink-0 items-center gap-2">
                      {file.clientVisible ? <Badge variant="outline">{t("files.shared")}</Badge> : null}
                      <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                      {canUpload ? (
                        <ActionButton
                          action={deleteFileAction.bind(null, tenant)}
                          values={{ id: file.id }}
                          confirm={t("form.confirm")}
                          variant="ghost"
                        >
                          {t("form.delete")}
                        </ActionButton>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}
      </div>

      <Section title={t("comments.title")}>
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("comments.none")}</p>
        ) : (
          <ol className="grid gap-3">
            {comments.map(({ comment, authorName }) => (
              <li key={comment.id} className="grid gap-1 surface p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{authorName ?? t("audit.system")}</span>
                  <span>{formatDateTime(comment.createdAt, tz, f.locale)}</span>
                  {comment.clientVisible ? (
                    <Badge variant="outline">{t("comments.clientVisible")}</Badge>
                  ) : null}
                </div>
                <p className="text-sm whitespace-pre-line">{comment.body}</p>
              </li>
            ))}
          </ol>
        )}
        <ActionForm action={addCommentAction.bind(null, tenant)}>
          <input type="hidden" name="projectId" value={project.id} />
          <TextAreaField
            name="body"
            label={t("comments.add")}
            placeholder={t("comments.placeholder")}
            rows={3}
            required
          />
          {project.clientId ? (
            <CheckboxField name="clientVisible" label={t("comments.clientVisible")} />
          ) : null}
          <SubmitButton className="justify-self-start" pendingLabel={t("form.saving")}>
            {t("comments.add")}
          </SubmitButton>
        </ActionForm>
      </Section>
    </div>
  );
}
