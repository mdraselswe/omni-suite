import Link from "next/link";
import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionButton } from "@/components/form/action-button";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { TextAreaField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, PageHeader, Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { ButtonAnchor, ButtonLink } from "@/components/ui/button-link";
import { formatBytes, listFiles } from "@/features/files";
import { displayStatus, invoiceBalance } from "@/features/invoices";
import {
  addCommentAction,
  approveTaskAction,
  getProject,
  listComments,
  listTasks,
  projectBilling,
  requestTaskChangesAction,
  taskProgress,
} from "@/features/projects";
import { proposalDisplayStatus, ProposalStatusBadge } from "@/features/proposals";
import { t } from "@/i18n";
import { formatDateTime, today } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { db } from "@/server/db";
import { hasPermission } from "@/server/tenancy/context";
import { portalPage } from "../../_components/portal";

/** Task groups in the order a client cares about: what to look at, what's moving, what's next, what's done. */
const GROUPS = ["review", "in_progress", "todo", "done"] as const;

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
  const canInvoices = hasPermission(ctx, "portal.invoices");
  const canProposals = hasPermission(ctx, "portal.proposals");
  // listTasks, listComments and listFiles only return what the client may see.
  const [tasks, comments, files, billing] = await Promise.all([
    listTasks(database, ctx, project.id),
    listComments(database, ctx, "project", project.id),
    canFiles
      ? listFiles(database, ctx, "all", { entityType: "project", entityId: project.id })
      : Promise.resolve([]),
    canInvoices || canProposals
      ? projectBilling(database, ctx.tenant.id, project)
      : Promise.resolve({ proposal: null, invoices: [] }),
  ]);
  const settings = ctx.tenant.settings;
  const { timezone, locale } = settings;
  const now = today(timezone);
  const status = settings.projectStatuses.find((s) => s.key === project.status);
  const progress = taskProgress(tasks.map(({ task }) => task));
  const isWaiting = (task: (typeof tasks)[number]["task"]) =>
    task.needsApproval && task.status === "review" && !task.approvedAt;
  const waiting = tasks.filter(({ task }) => isWaiting(task));
  const proposal = canProposals ? billing.proposal : null;
  const invoices = canInvoices ? billing.invoices : [];

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

      <section aria-label={t("portalWork.overview")} className="grid gap-4 surface p-4 sm:p-5">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div className="grid gap-0.5">
            <dt className="text-xs text-muted-foreground">{t("portalWork.status")}</dt>
            <dd className="font-medium">{status?.label ?? project.status}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-xs text-muted-foreground">{t("portalWork.startDate")}</dt>
            <dd className="font-medium">
              {project.startDate ? f.date(project.startDate) : t("portalWork.notSet")}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-xs text-muted-foreground">{t("portalWork.dueDate")}</dt>
            <dd className="font-medium">
              {project.dueDate ? f.date(project.dueDate) : t("portalWork.notSet")}
            </dd>
          </div>
        </dl>
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{t("portalWork.progress")}</span>
            <span className="text-muted-foreground tabular-nums">
              {t("portal.progress", { done: progress.done, total: progress.total })}
            </span>
          </div>
          <span
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("portalWork.progressLabel")}
          >
            <span
              className="block h-full origin-left rounded-full bg-primary"
              style={{ width: `${progress.percent}%` }}
            />
          </span>
        </div>
      </section>

      {waiting.length > 0 ? (
        <Section title={t("portalWork.awaiting")} description={t("portalWork.awaitingSub")}>
          <ul className="divide-y overflow-hidden rounded-(--radius) border border-primary/40 bg-card">
            {waiting.map(({ task }) => (
              <li
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <span className="grid min-w-0 gap-1">
                  <span className="font-medium break-words">{task.title}</span>
                  {task.description ? (
                    <span className="text-xs whitespace-pre-line text-muted-foreground">
                      {task.description}
                    </span>
                  ) : null}
                  {task.dueDate ? (
                    <span className="text-xs text-muted-foreground">
                      {t("portal.due", { date: f.date(task.dueDate) })}
                    </span>
                  ) : null}
                </span>
                {canApprove ? (
                  <span className="flex flex-wrap gap-2">
                    <FormDialog
                      trigger={t("tasks.requestChanges")}
                      title={t("tasks.requestChanges")}
                      description={t("tasks.requestChangesSub")}
                      action={requestTaskChangesAction.bind(null, tenant)}
                      submitLabel={t("tasks.requestChanges")}
                      variant="outline"
                      size="sm"
                      icon={false}
                    >
                      <input type="hidden" name="id" value={task.id} />
                      <p className="text-sm font-medium">{task.title}</p>
                      <TextAreaField name="comment" label={t("tasks.changesLabel")} rows={4} required />
                    </FormDialog>
                    <ActionButton
                      action={approveTaskAction.bind(null, tenant)}
                      values={{ id: task.id }}
                      variant="default"
                      confirm={t("portalWork.approveConfirm", { title: task.title })}
                    >
                      {t("portal.approve")}
                    </ActionButton>
                  </span>
                ) : (
                  <Badge variant="outline">{t("tasks.awaitingApproval")}</Badge>
                )}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={t("portal.tasks")}>
        {tasks.length === 0 ? (
          <EmptyState title={t("portalWork.noTasksYet")} />
        ) : (
          <div className="grid gap-4">
            {GROUPS.map((group) => {
              const inGroup = tasks.filter(({ task }) => task.status === group);
              if (inGroup.length === 0) return null;
              const headingId = `tasks-${group}`;
              return (
                <section key={group} aria-labelledby={headingId} className="grid gap-2">
                  <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
                    {t(`tasks.status.${group}`)}
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">
                      {inGroup.length}
                    </span>
                  </h3>
                  <ul className="divide-y overflow-hidden surface">
                    {inGroup.map(({ task }) => (
                      <li
                        key={task.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                      >
                        <span className="min-w-0 font-medium break-words">{task.title}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {isWaiting(task) ? (
                            <Badge variant="outline">{t("tasks.awaitingApproval")}</Badge>
                          ) : null}
                          {task.approvedAt ? (
                            <Badge variant="secondary">
                              {t("portalWork.approvedOn", {
                                date: formatDateTime(task.approvedAt, timezone, locale),
                              })}
                            </Badge>
                          ) : null}
                          {task.dueDate && task.status !== "done" ? (
                            <span
                              className={
                                task.dueDate < now
                                  ? "text-xs text-destructive"
                                  : "text-xs text-muted-foreground"
                              }
                            >
                              {t("portal.due", { date: f.date(task.dueDate) })}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title={t("portalWork.discussion")}>
          <div className="grid gap-4">
            {comments.length === 0 ? (
              <EmptyState title={t("portalWork.noComments")} />
            ) : (
              <ol className="grid gap-3">
                {comments.map(({ comment, authorName }) => (
                  <li key={comment.id} className="grid gap-1 surface p-3 text-sm">
                    <span className="text-xs text-muted-foreground">
                      {comment.authorUserId === ctx.user.id ? t("portalWork.you") : (authorName ?? "—")} ·{" "}
                      {formatDateTime(comment.createdAt, timezone, locale)}
                    </span>
                    <p className="break-words whitespace-pre-wrap">{comment.body}</p>
                  </li>
                ))}
              </ol>
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
              <SubmitButton className="justify-self-start" pendingLabel={t("form.saving")}>
                {t("comments.add")}
              </SubmitButton>
            </ActionForm>
          </div>
        </Section>

        <div className="grid content-start gap-8">
          {canFiles ? (
            <Section title={t("portalWork.files")}>
              {files.length === 0 ? (
                <EmptyState title={t("portalWork.noFiles")} />
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

          {proposal || invoices.length > 0 ? (
            <Section title={t("portalWork.billing")}>
              <ul className="divide-y overflow-hidden surface">
                {proposal ? (
                  <li>
                    <Link
                      href={tenantHref(tenant, `portal/proposals/${proposal.id}`)}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <span className="grid min-w-0">
                        <span className="font-medium">
                          {t("portalWork.proposalLink", { number: proposal.number })}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">{proposal.title}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <ProposalStatusBadge status={proposalDisplayStatus(proposal, now)} />
                        <span className="tabular-nums">
                          {f.money(proposal.totalMinor, proposal.currency)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ) : null}
                {invoices.map((invoice) => {
                  const invStatus = displayStatus(invoice, now);
                  const balance = invoiceBalance(invoice);
                  return (
                    <li key={invoice.id}>
                      <Link
                        href={tenantHref(tenant, `portal/invoices/${invoice.id}`)}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                      >
                        <span className="grid">
                          <span className="font-medium">
                            {t("portalWork.invoiceLink", { number: invoice.number })}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t("portal.due", { date: f.date(invoice.dueDate) })}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <StatusBadge status={invStatus} label={t(`invoices.status.${invStatus}`)} />
                          <span className="tabular-nums">
                            {balance === 0n
                              ? t("portalWork.nothingOwed")
                              : f.money(balance, invoice.currency)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
