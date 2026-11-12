import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { t } from "@/i18n";
import type { CustomValues } from "@/lib/custom-fields";
import { addDays } from "@/lib/dates";
import { paginate, type PageRequest } from "@/lib/pagination";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import {
  clients,
  comments,
  invoices,
  memberRates,
  memberships,
  projectMembers,
  projects,
  projectTemplates,
  proposals,
  tasks,
  timeEntries,
  user,
} from "@/server/db/schema";
import type { Scope } from "@/server/rbac/resolve";
import { matchesSearch } from "@/server/search";
import { clientUserIds, notify, usersWithPermission } from "@/server/shared";
import type { TenantContext } from "@/server/tenancy/context";
import { actorOf, insertInvoice } from "@/features/invoices";
import type { TemplateTask } from "./template-tasks";
import { timeInvoiceLines, timeValue } from "./time-invoice";

/* ─── Scope filters ────────────────────────────────────────────── */

const myProjectIds = (ctx: TenantContext) =>
  sql`(select ${projectMembers.projectId} from ${projectMembers} where ${projectMembers.membershipId} = ${ctx.membership.id})`;

/** Projects a member can see. Client users see their client's projects. */
export function projectScopeFilter(ctx: TenantContext, scope: Scope): SQL | undefined {
  if (ctx.membership.kind === "client")
    return eq(projects.clientId, ctx.membership.clientId ?? "00000000-0000-0000-0000-000000000000");
  if (scope === "all") return undefined;
  const assigned = sql`${projects.id} in ${myProjectIds(ctx)}`;
  return scope === "assigned"
    ? or(assigned, eq(projects.createdBy, ctx.user.id))
    : eq(projects.createdBy, ctx.user.id);
}

/** Throws unless the membership is an active internal member of this tenant (ids from forms). */
async function assertTeamMember(tx: DbOrTx, ctx: TenantContext, membershipId: string, message: string) {
  const [m] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.id, membershipId),
        eq(memberships.tenantId, ctx.tenant.id),
        eq(memberships.kind, "internal"),
        eq(memberships.status, "active"),
      ),
    );
  if (!m) throw new UserError(message);
}

async function assertClientInTenant(tx: DbOrTx, ctx: TenantContext, clientId: string) {
  const [c] = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, ctx.tenant.id)));
  if (!c) throw new UserError(t("clients.missing"));
}

/* ─── Projects ─────────────────────────────────────────────────── */

export type ProjectFilter = {
  status?: string;
  clientId?: string;
  /** Words to find in the project or client name. */
  q?: string;
};

function projectWhere(ctx: TenantContext, scope: Scope, filter: ProjectFilter): SQL | undefined {
  return and(
    eq(projects.tenantId, ctx.tenant.id),
    projectScopeFilter(ctx, scope),
    filter.status ? eq(projects.status, filter.status) : undefined,
    filter.clientId ? eq(projects.clientId, filter.clientId) : undefined,
    matchesSearch(filter.q, [projects.name, clients.name]),
  );
}

/**
 * Newest first, with task progress. Client users' progress counts only the tasks
 * they can see, so internal tasks never move (or stall) the bar in the portal.
 */
async function projectRows(
  database: DbOrTx,
  where: SQL | undefined,
  limit: number,
  offset = 0,
  clientOnly = false,
) {
  const visible = clientOnly ? sql` and ${tasks.clientVisible} = true` : sql``;
  const taskCounts = sql<string>`(select count(*) from ${tasks} where ${tasks.projectId} = ${projects.id}${visible})`;
  const doneCounts = sql<string>`(select count(*) from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.status} = 'done'${visible})`;
  const rows = await database
    .select({ project: projects, clientName: clients.name, taskCount: taskCounts, doneCount: doneCounts })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(where)
    .orderBy(desc(projects.createdAt), desc(projects.id))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    ...r.project,
    clientName: r.clientName,
    taskCount: Number(r.taskCount),
    doneCount: Number(r.doneCount),
  }));
}

/** Up to `limit` projects (dashboards, pickers). Lists use pageProjects. */
export async function listProjects(
  database: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  filter: ProjectFilter & { limit?: number } = {},
) {
  return projectRows(
    database,
    projectWhere(ctx, scope, filter),
    filter.limit ?? 500,
    0,
    ctx.membership.kind === "client",
  );
}

/** One page of projects and the number that match. */
export async function pageProjects(
  database: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  filter: ProjectFilter,
  page: PageRequest,
) {
  const where = projectWhere(ctx, scope, filter);
  return paginate(
    page,
    async () => {
      const [row] = await database
        .select({ n: count() })
        .from(projects)
        .leftJoin(clients, eq(clients.id, projects.clientId))
        .where(where);
      return row?.n ?? 0;
    },
    (limit, offset) => projectRows(database, where, limit, offset, ctx.membership.kind === "client"),
  );
}

export async function getProject(database: DbOrTx, ctx: TenantContext, scope: Scope, id: string) {
  const [row] = await database
    .select({ project: projects, clientName: clients.name })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.id, id), eq(projects.tenantId, ctx.tenant.id), projectScopeFilter(ctx, scope)));
  return row ? { ...row.project, clientName: row.clientName } : null;
}

export type ProjectInput = {
  name: string;
  description: string;
  clientId: string | null;
  status: string;
  startDate: string | null;
  dueDate: string | null;
  budgetMinor: bigint;
  custom: CustomValues;
};

function assertStatus(ctx: TenantContext, status: string) {
  if (!ctx.tenant.settings.projectStatuses.some((s) => s.key === status))
    throw new UserError(t("form.invalid"));
}

export async function createProject(
  database: Database,
  ctx: TenantContext,
  input: ProjectInput & { templateId: string | null },
): Promise<string> {
  return database.transaction((tx) => createProjectTx(tx, ctx, input));
}

/** Creates a project inside an existing transaction (also used when a proposal is accepted). */
export async function createProjectTx(
  tx: DbOrTx,
  ctx: TenantContext,
  input: ProjectInput & { templateId: string | null; proposalId?: string | null },
): Promise<string> {
  assertStatus(ctx, input.status);
  if (input.clientId) await assertClientInTenant(tx, ctx, input.clientId);
  const { templateId, ...values } = input;
  {
    const [row] = await tx
      .insert(projects)
      .values({ tenantId: ctx.tenant.id, createdBy: ctx.user.id, ...values })
      .returning({ id: projects.id });
    if (!row) throw new Error("Project insert failed");
    // The creator joins the team so "assigned" scopes include their own projects.
    if (ctx.membership.kind === "internal") {
      await tx.insert(projectMembers).values({ projectId: row.id, membershipId: ctx.membership.id });
    }
    if (templateId) {
      const [tpl] = await tx
        .select()
        .from(projectTemplates)
        .where(and(eq(projectTemplates.id, templateId), eq(projectTemplates.tenantId, ctx.tenant.id)));
      if (tpl && tpl.tasks.length > 0) {
        await tx.insert(tasks).values(
          tpl.tasks.map((task, i) => ({
            tenantId: ctx.tenant.id,
            projectId: row.id,
            title: task.title,
            // Approval happens in the portal, so an approval task is always client-visible.
            clientVisible: task.clientVisible || !!task.needsApproval,
            needsApproval: !!task.needsApproval,
            position: i,
          })),
        );
      }
    }
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "project.create",
      entityType: "project",
      entityId: row.id,
      data: { name: input.name },
    });
    await markChanged(tx, ctx.tenant.id, "project", row.id);
    return row.id;
  }
}

export async function updateProject(
  database: Database,
  ctx: TenantContext,
  scope: Scope,
  id: string,
  input: ProjectInput,
) {
  assertStatus(ctx, input.status);
  await database.transaction(async (tx) => {
    if (input.clientId) await assertClientInTenant(tx, ctx, input.clientId);
    const [row] = await tx
      .update(projects)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.tenantId, ctx.tenant.id), projectScopeFilter(ctx, scope)))
      .returning({ id: projects.id });
    if (!row) throw new UserError(t("projects.missing"));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "project.update",
      entityType: "project",
      entityId: id,
      data: { status: input.status },
    });
    await markChanged(tx, ctx.tenant.id, "project", id);
  });
}

export async function projectTeam(database: DbOrTx, projectId: string) {
  return database
    .select({ membershipId: memberships.id, name: user.name, email: user.email })
    .from(projectMembers)
    .innerJoin(memberships, eq(memberships.id, projectMembers.membershipId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(user.name));
}

export async function setProjectMember(
  database: Database,
  ctx: TenantContext,
  input: { projectId: string; membershipId: string; add: boolean },
) {
  await database.transaction(async (tx) => {
    const [p] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.tenantId, ctx.tenant.id)));
    const [m] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.id, input.membershipId),
          eq(memberships.tenantId, ctx.tenant.id),
          eq(memberships.kind, "internal"),
        ),
      );
    if (!p || !m) throw new UserError(t("projects.missing"));
    if (input.add) {
      await tx.insert(projectMembers).values({ projectId: p.id, membershipId: m.id }).onConflictDoNothing();
    } else {
      await tx
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.membershipId, m.id)));
    }
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: input.add ? "project.memberAdd" : "project.memberRemove",
      entityType: "project",
      entityId: p.id,
      data: { membershipId: m.id },
    });
  });
}

export async function listProjectTemplates(database: DbOrTx, tenantId: string) {
  return database
    .select()
    .from(projectTemplates)
    .where(eq(projectTemplates.tenantId, tenantId))
    .orderBy(asc(projectTemplates.name));
}

export async function saveProjectTemplate(
  database: Database,
  ctx: TenantContext,
  input: { id: string | null; name: string; tasks: TemplateTask[] },
): Promise<string> {
  return database.transaction(async (tx) => {
    let id: string | undefined;
    if (input.id) {
      const [row] = await tx
        .update(projectTemplates)
        .set({ name: input.name, tasks: input.tasks })
        .where(and(eq(projectTemplates.id, input.id), eq(projectTemplates.tenantId, ctx.tenant.id)))
        .returning({ id: projectTemplates.id });
      id = row?.id;
    } else {
      const [row] = await tx
        .insert(projectTemplates)
        .values({ tenantId: ctx.tenant.id, name: input.name, tasks: input.tasks })
        .returning({ id: projectTemplates.id });
      id = row?.id;
    }
    if (!id) throw new UserError(t("form.invalid"));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "projectTemplate.save",
      entityType: "projectTemplate",
      entityId: id,
      data: { name: input.name, tasks: input.tasks.length },
    });
    await markChanged(tx, ctx.tenant.id, "projectTemplate", id);
    return id;
  });
}

/** Templates are copied into a project when it is created, so deleting one never touches projects. */
export async function deleteProjectTemplate(database: Database, ctx: TenantContext, id: string) {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .delete(projectTemplates)
      .where(and(eq(projectTemplates.id, id), eq(projectTemplates.tenantId, ctx.tenant.id)))
      .returning({ name: projectTemplates.name });
    if (!row) throw new UserError(t("form.invalid"));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "projectTemplate.delete",
      entityType: "projectTemplate",
      entityId: id,
      data: { name: row.name },
    });
    await markChanged(tx, ctx.tenant.id, "projectTemplate", id, "delete");
  });
}

/* ─── Tasks ────────────────────────────────────────────────────── */

export async function listTasks(database: DbOrTx, ctx: TenantContext, projectId: string) {
  return database
    .select({ task: tasks, assigneeName: user.name })
    .from(tasks)
    .leftJoin(memberships, eq(memberships.id, tasks.assigneeMembershipId))
    .leftJoin(user, eq(user.id, memberships.userId))
    .where(
      and(
        eq(tasks.tenantId, ctx.tenant.id),
        eq(tasks.projectId, projectId),
        ctx.membership.kind === "client" ? eq(tasks.clientVisible, true) : undefined,
      ),
    )
    .orderBy(asc(tasks.position), asc(tasks.createdAt));
}

/** Tasks assigned to the member that are due within `days` (dashboard). */
export async function myDueTasks(database: DbOrTx, ctx: TenantContext, until: string) {
  return database
    .select({ task: tasks, projectName: projects.name })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.tenantId, ctx.tenant.id),
        eq(tasks.assigneeMembershipId, ctx.membership.id),
        sql`${tasks.status} <> 'done'`,
        lte(tasks.dueDate, until),
      ),
    )
    .orderBy(asc(tasks.dueDate))
    .limit(10);
}

async function loadTaskForWrite(tx: DbOrTx, ctx: TenantContext, scope: Scope, id: string) {
  const [task] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.tenant.id)));
  if (!task) throw new UserError(t("tasks.missing"));
  await assertTaskScope(tx, ctx, scope, task.projectId, task.assigneeMembershipId);
  return task;
}

async function assertTaskScope(
  tx: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  projectId: string,
  assignee: string | null,
) {
  if (scope === "all") return;
  if (scope === "own") {
    if (assignee !== ctx.membership.id) throw new UserError(t("tasks.notAssigned"));
    return;
  }
  const [member] = await tx
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.membershipId, ctx.membership.id)));
  if (!member && assignee !== ctx.membership.id) throw new UserError(t("tasks.notAssigned"));
}

export type TaskInput = {
  title: string;
  description: string;
  status: "todo" | "in_progress" | "review" | "done";
  assigneeMembershipId: string | null;
  dueDate: string | null;
  clientVisible: boolean;
  needsApproval: boolean;
};

export async function createTask(
  database: Database,
  ctx: TenantContext,
  scope: Scope,
  projectId: string,
  input: TaskInput,
) {
  return database.transaction(async (tx) => {
    const [p] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, ctx.tenant.id)));
    if (!p) throw new UserError(t("projects.missing"));
    if (input.assigneeMembershipId)
      await assertTeamMember(tx, ctx, input.assigneeMembershipId, t("tasks.badAssignee"));
    await assertTaskScope(
      tx,
      ctx,
      scope === "own" ? "assigned" : scope,
      projectId,
      input.assigneeMembershipId,
    );
    const [max] = await tx
      .select({ v: sql<number>`coalesce(max(${tasks.position}), -1)` })
      .from(tasks)
      .where(eq(tasks.projectId, projectId));
    const [row] = await tx
      .insert(tasks)
      .values({ tenantId: ctx.tenant.id, projectId, ...input, position: Number(max?.v ?? -1) + 1 })
      .returning({ id: tasks.id });
    if (!row) throw new Error("Task insert failed");
    if (input.assigneeMembershipId && input.assigneeMembershipId !== ctx.membership.id) {
      const [assignee] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(eq(memberships.id, input.assigneeMembershipId));
      if (assignee) {
        await notify(tx, ctx.tenant.id, [assignee.userId], {
          title: input.title,
          link: `/${ctx.tenant.slug}/projects/${projectId}`,
        });
      }
    }
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "task.create",
      entityType: "task",
      entityId: row.id,
      data: { title: input.title },
    });
    await markChanged(tx, ctx.tenant.id, "task", row.id);
    return row.id;
  });
}

export async function updateTask(
  database: Database,
  ctx: TenantContext,
  scope: Scope,
  id: string,
  input: Partial<TaskInput>,
) {
  await database.transaction(async (tx) => {
    const task = await loadTaskForWrite(tx, ctx, scope, id);
    if (input.assigneeMembershipId && input.assigneeMembershipId !== task.assigneeMembershipId)
      await assertTeamMember(tx, ctx, input.assigneeMembershipId, t("tasks.badAssignee"));
    await tx
      .update(tasks)
      .set({
        ...input,
        updatedAt: new Date(),
        ...(input.needsApproval === false ? { approvedAt: null, approvedBy: null } : {}),
      })
      .where(eq(tasks.id, id));
    // Moving a client-approval task to review asks the client to approve it.
    if (input.status === "review" && task.status !== "review" && task.needsApproval && task.clientVisible) {
      const [p] = await tx
        .select({ clientId: projects.clientId })
        .from(projects)
        .where(eq(projects.id, task.projectId));
      if (p?.clientId) {
        await notify(
          tx,
          ctx.tenant.id,
          await clientUserIds(tx, ctx.tenant.id, p.clientId, "portal.approve"),
          {
            title: t("tasks.approvalTitle", { name: ctx.tenant.name }),
            body: task.title,
            link: `/${ctx.tenant.slug}/portal/projects/${task.projectId}`,
            email: true,
          },
        );
      }
    }
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "task.update",
      entityType: "task",
      entityId: id,
      data: input,
    });
    await markChanged(tx, ctx.tenant.id, "task", id);
  });
}

/** The task's active assignee; with none, the project's audience. */
async function taskAudience(tx: DbOrTx, tenantId: string, projectId: string, assignee: string | null) {
  if (assignee) {
    const [m] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.id, assignee), eq(memberships.status, "active")));
    if (m) return [m.userId];
  }
  return projectAudience(tx, tenantId, projectId);
}

/** Active members on the project's team; with no team, everyone who can change projects. */
async function projectAudience(tx: DbOrTx, tenantId: string, projectId: string) {
  const team = await tx
    .select({ userId: memberships.userId })
    .from(projectMembers)
    .innerJoin(memberships, eq(memberships.id, projectMembers.membershipId))
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(memberships.status, "active"),
        eq(memberships.kind, "internal"),
      ),
    );
  if (team.length > 0) return team.map((m) => m.userId);
  return usersWithPermission(tx, tenantId, "projects.write");
}

/** Client approves a task from the portal. Only a task the team moved to review can be approved. */
export async function approveTask(database: Database, ctx: TenantContext, id: string) {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .select({ task: tasks, clientId: projects.clientId })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.tenant.id)))
      .for("update", { of: tasks });
    if (
      !row ||
      ctx.membership.kind !== "client" ||
      !row.task.needsApproval ||
      !row.task.clientVisible ||
      row.clientId !== ctx.membership.clientId
    ) {
      throw new UserError(t("tasks.missing"));
    }
    if (row.task.status !== "review" || row.task.approvedAt) throw new UserError(t("tasks.notInReview"));
    await tx
      .update(tasks)
      .set({ approvedAt: new Date(), approvedBy: ctx.user.id, status: "done", updatedAt: new Date() })
      .where(eq(tasks.id, id));
    await notify(
      tx,
      ctx.tenant.id,
      await taskAudience(tx, ctx.tenant.id, row.task.projectId, row.task.assigneeMembershipId),
      {
        title: t("tasks.approvedTitle", { title: row.task.title }),
        link: `/${ctx.tenant.slug}/projects/${row.task.projectId}`,
        email: true,
      },
    );
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "task.approve",
      entityType: "task",
      entityId: id,
    });
    await markChanged(tx, ctx.tenant.id, "task", id);
  });
}

/** Client sends a task under review back to the team with a note (portal). */
export async function requestTaskChanges(
  database: Database,
  ctx: TenantContext,
  id: string,
  comment: string,
) {
  const note = comment.trim();
  if (!note) throw new UserError(t("form.required"));
  await database.transaction(async (tx) => {
    const [row] = await tx
      .select({ task: tasks, clientId: projects.clientId })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.tenant.id)))
      .for("update", { of: tasks });
    if (
      !row ||
      ctx.membership.kind !== "client" ||
      !row.task.needsApproval ||
      !row.task.clientVisible ||
      row.clientId !== ctx.membership.clientId
    ) {
      throw new UserError(t("tasks.missing"));
    }
    if (row.task.status !== "review") throw new UserError(t("tasks.notInReview"));
    await tx
      .update(tasks)
      .set({ status: "in_progress", approvedAt: null, approvedBy: null, updatedAt: new Date() })
      .where(eq(tasks.id, id));
    // The note goes on the project discussion so both sides see it.
    await tx.insert(comments).values({
      tenantId: ctx.tenant.id,
      entityType: "project",
      entityId: row.task.projectId,
      authorUserId: ctx.user.id,
      body: t("tasks.changesComment", { title: row.task.title, comment: note }),
      clientVisible: true,
    });
    const recipients = await taskAudience(
      tx,
      ctx.tenant.id,
      row.task.projectId,
      row.task.assigneeMembershipId,
    );
    await notify(tx, ctx.tenant.id, recipients, {
      title: t("tasks.changesTitle", { title: row.task.title }),
      body: note.slice(0, 200),
      link: `/${ctx.tenant.slug}/projects/${row.task.projectId}`,
      email: true,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "task.requestChanges",
      entityType: "task",
      entityId: id,
      data: { comment: note.slice(0, 500) },
    });
    await markChanged(tx, ctx.tenant.id, "task", id);
  });
}

export async function deleteTask(database: Database, ctx: TenantContext, scope: Scope, id: string) {
  await database.transaction(async (tx) => {
    await loadTaskForWrite(tx, ctx, scope, id);
    await tx.delete(tasks).where(eq(tasks.id, id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "task.delete",
      entityType: "task",
      entityId: id,
    });
    await markChanged(tx, ctx.tenant.id, "task", id, "delete");
  });
}

/* ─── Comments ─────────────────────────────────────────────────── */

export async function listComments(
  database: DbOrTx,
  ctx: TenantContext,
  entityType: "project" | "task",
  entityId: string,
) {
  return database
    .select({ comment: comments, authorName: user.name })
    .from(comments)
    .leftJoin(user, eq(user.id, comments.authorUserId))
    .where(
      and(
        eq(comments.tenantId, ctx.tenant.id),
        eq(comments.entityType, entityType),
        eq(comments.entityId, entityId),
        ctx.membership.kind === "client" ? eq(comments.clientVisible, true) : undefined,
      ),
    )
    .orderBy(asc(comments.createdAt));
}

export async function addComment(
  database: Database,
  ctx: TenantContext,
  input: { projectId: string; body: string; clientVisible: boolean },
) {
  const isClient = ctx.membership.kind === "client";
  // Staff comment only on projects their projects.read scope shows them.
  const scope = isClient ? "all" : ctx.permissions.get("projects.read");
  if (!scope) throw new UserError(t("projects.missing"));
  await database.transaction(async (tx) => {
    const [p] = await tx
      .select({ id: projects.id, clientId: projects.clientId, name: projects.name })
      .from(projects)
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(projects.tenantId, ctx.tenant.id),
          projectScopeFilter(ctx, scope),
        ),
      );
    if (!p) throw new UserError(t("projects.missing"));
    const visible = isClient ? true : input.clientVisible;
    await tx.insert(comments).values({
      tenantId: ctx.tenant.id,
      entityType: "project",
      entityId: p.id,
      authorUserId: ctx.user.id,
      body: input.body,
      clientVisible: visible,
    });
    const title = t("portalWork.commentTitle", { name: ctx.user.name, project: p.name });
    if (isClient) {
      // The project's team hears about it; a project with no team goes to whoever runs projects.
      await notify(tx, ctx.tenant.id, await projectAudience(tx, ctx.tenant.id, p.id), {
        title,
        body: input.body.slice(0, 500),
        link: `/${ctx.tenant.slug}/projects/${p.id}`,
        email: true,
      });
    } else if (visible && p.clientId) {
      await notify(tx, ctx.tenant.id, await clientUserIds(tx, ctx.tenant.id, p.clientId, "portal.projects"), {
        title,
        body: input.body.slice(0, 500),
        link: `/${ctx.tenant.slug}/portal/projects/${p.id}`,
        email: true,
      });
    }
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "comment.create",
      entityType: "project",
      entityId: p.id,
      data: { clientVisible: visible },
    });
  });
}

/**
 * What a client sees billed for a project: the proposal it started from and the
 * invoices made from that proposal or from the project's time (never drafts).
 */
export async function projectBilling(
  database: DbOrTx,
  tenantId: string,
  project: { id: string; proposalId: string | null; clientId: string | null },
) {
  const [proposal] = project.proposalId
    ? await database
        .select({
          id: proposals.id,
          number: proposals.number,
          title: proposals.title,
          status: proposals.status,
          validUntil: proposals.validUntil,
          totalMinor: proposals.totalMinor,
          currency: proposals.currency,
        })
        .from(proposals)
        .where(
          and(
            eq(proposals.id, project.proposalId),
            eq(proposals.tenantId, tenantId),
            ne(proposals.status, "draft"),
          ),
        )
    : [];
  const fromTime = sql`${invoices.id} in (select ${timeEntries.invoiceId} from ${timeEntries} where ${timeEntries.projectId} = ${project.id} and ${timeEntries.invoiceId} is not null)`;
  const linked = project.clientId
    ? await database
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            eq(invoices.clientId, project.clientId),
            ne(invoices.status, "draft"),
            project.proposalId ? or(eq(invoices.proposalId, project.proposalId), fromTime) : fromTime,
          ),
        )
        .orderBy(asc(invoices.issueDate), asc(invoices.createdAt))
    : [];
  return { proposal: proposal ?? null, invoices: linked };
}

/* ─── Time ─────────────────────────────────────────────────────── */

export function timeScopeFilter(ctx: TenantContext, scope: Scope): SQL | undefined {
  if (scope === "all") return undefined;
  const own = eq(timeEntries.membershipId, ctx.membership.id);
  return scope === "assigned" ? or(own, sql`${timeEntries.projectId} in ${myProjectIds(ctx)}`) : own;
}

export type TimeFilter = {
  from: string;
  to: string;
  projectId?: string;
  membershipId?: string;
  /** Words to find in the note, project or member name. */
  q?: string;
};

function timeWhere(ctx: TenantContext, scope: Scope, filter: TimeFilter): SQL | undefined {
  return and(
    eq(timeEntries.tenantId, ctx.tenant.id),
    timeScopeFilter(ctx, scope),
    gte(timeEntries.date, filter.from),
    lte(timeEntries.date, filter.to),
    filter.projectId ? eq(timeEntries.projectId, filter.projectId) : undefined,
    filter.membershipId ? eq(timeEntries.membershipId, filter.membershipId) : undefined,
    matchesSearch(filter.q, [timeEntries.note, projects.name, user.name]),
  );
}

async function timeRows(database: DbOrTx, where: SQL | undefined, limit: number, offset = 0) {
  return database
    .select({ entry: timeEntries, projectName: projects.name, memberName: user.name })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .innerJoin(memberships, eq(memberships.id, timeEntries.membershipId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(where)
    .orderBy(desc(timeEntries.date), desc(timeEntries.createdAt), desc(timeEntries.id))
    .limit(limit)
    .offset(offset);
}

/** Up to 1000 entries, newest first. The time page uses pageTime and timeTotals. */
export async function listTime(database: DbOrTx, ctx: TenantContext, scope: Scope, filter: TimeFilter) {
  return timeRows(database, timeWhere(ctx, scope, filter), 1000);
}

/** One page of time entries, plus count and minutes for everything the filter matches. */
export async function pageTime(
  database: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  filter: TimeFilter,
  page: PageRequest,
) {
  const where = timeWhere(ctx, scope, filter);
  const totals = timeTotals(database, ctx, scope, filter);
  const paged = await paginate(
    page,
    async () => (await totals).count,
    (limit, offset) => timeRows(database, where, limit, offset),
  );
  return { ...paged, totals: await totals };
}

/** Entry count and minutes (all, billable, billable not yet invoiced) for the whole filter. */
export async function timeTotals(database: DbOrTx, ctx: TenantContext, scope: Scope, filter: TimeFilter) {
  const [row] = await database
    .select({
      count: count(),
      minutes: sql<string>`coalesce(sum(${timeEntries.minutes}), 0)`,
      billable: sql<string>`coalesce(sum(case when ${timeEntries.billable} then ${timeEntries.minutes} else 0 end), 0)`,
      unbilled: sql<string>`coalesce(sum(case when ${timeEntries.billable} and ${timeEntries.invoiceId} is null then ${timeEntries.minutes} else 0 end), 0)`,
    })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .innerJoin(memberships, eq(memberships.id, timeEntries.membershipId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(timeWhere(ctx, scope, filter));
  return {
    count: row?.count ?? 0,
    minutes: Number(row?.minutes ?? 0),
    billable: Number(row?.billable ?? 0),
    unbilled: Number(row?.unbilled ?? 0),
  };
}

export async function logTime(
  database: Database,
  ctx: TenantContext,
  scope: Scope,
  input: {
    projectId: string;
    taskId: string | null;
    membershipId: string | null;
    date: string;
    minutes: number;
    note: string;
    billable: boolean;
  },
) {
  if (input.minutes <= 0 || input.minutes > 24 * 60) throw new UserError(t("time.badDuration"));
  const membershipId = scope === "all" && input.membershipId ? input.membershipId : ctx.membership.id;
  await database.transaction(async (tx) => {
    // Without "all" scope, people log time only on projects they are on.
    const [p] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(projects.tenantId, ctx.tenant.id),
          scope === "all" ? undefined : sql`${projects.id} in ${myProjectIds(ctx)}`,
        ),
      );
    if (!p) throw new UserError(t("projects.missing"));
    if (membershipId !== ctx.membership.id)
      await assertTeamMember(tx, ctx, membershipId, t("time.badMember"));
    if (input.taskId) {
      const [task] = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.id, input.taskId),
            eq(tasks.tenantId, ctx.tenant.id),
            eq(tasks.projectId, input.projectId),
          ),
        );
      if (!task) throw new UserError(t("time.badTask"));
    }
    const [rate] = await tx.select().from(memberRates).where(eq(memberRates.membershipId, membershipId));
    const [row] = await tx
      .insert(timeEntries)
      .values({
        tenantId: ctx.tenant.id,
        projectId: input.projectId,
        taskId: input.taskId,
        membershipId,
        date: input.date,
        minutes: input.minutes,
        note: input.note,
        billable: input.billable,
        hourlyRateMinor: rate?.billRateMinor ?? 0n,
      })
      .returning({ id: timeEntries.id });
    if (row) await markChanged(tx, ctx.tenant.id, "time", row.id);
  });
}

export async function deleteTime(database: Database, ctx: TenantContext, scope: Scope, id: string) {
  await database.transaction(async (tx) => {
    const mine = and(
      eq(timeEntries.id, id),
      eq(timeEntries.tenantId, ctx.tenant.id),
      scope === "all" ? undefined : eq(timeEntries.membershipId, ctx.membership.id),
    );
    // Billed time stays: the invoice was built from it.
    const [row] = await tx
      .delete(timeEntries)
      .where(and(mine, isNull(timeEntries.invoiceId)))
      .returning({ id: timeEntries.id });
    if (!row) {
      const [billed] = await tx.select({ id: timeEntries.id }).from(timeEntries).where(mine);
      throw new UserError(billed ? t("time.alreadyBilled") : t("tasks.notAssigned"));
    }
    await markChanged(tx, ctx.tenant.id, "time", id, "delete");
  });
}

/** Minutes, labour cost and billable value of a project. */
export async function projectEconomics(database: DbOrTx, projectId: string) {
  const [row] = await database
    .select({
      minutes: sql<string>`coalesce(sum(${timeEntries.minutes}), 0)`,
      cost: sql<string>`coalesce(sum(${timeEntries.minutes} * coalesce(${memberRates.costRateMinor}, 0) / 60), 0)`,
      billable: sql<string>`coalesce(sum(case when ${timeEntries.billable} then ${timeEntries.minutes} * ${timeEntries.hourlyRateMinor} / 60 else 0 end), 0)`,
    })
    .from(timeEntries)
    .leftJoin(memberRates, eq(memberRates.membershipId, timeEntries.membershipId))
    .where(eq(timeEntries.projectId, projectId));
  return {
    minutes: Number(row?.minutes ?? 0),
    costMinor: BigInt(String(row?.cost ?? "0").split(".")[0] ?? "0"),
    billableMinor: BigInt(String(row?.billable ?? "0").split(".")[0] ?? "0"),
  };
}

export async function listRates(database: DbOrTx, tenantId: string) {
  return database
    .select({
      membershipId: memberships.id,
      name: user.name,
      cost: memberRates.costRateMinor,
      bill: memberRates.billRateMinor,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .leftJoin(memberRates, eq(memberRates.membershipId, memberships.id))
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.kind, "internal"),
        eq(memberships.status, "active"),
      ),
    )
    .orderBy(asc(user.name));
}

export async function setRate(
  database: Database,
  ctx: TenantContext,
  input: { membershipId: string; costRateMinor: bigint; billRateMinor: bigint },
) {
  await database.transaction(async (tx) => {
    await assertTeamMember(tx, ctx, input.membershipId, t("team.memberMissing"));
    await tx
      .insert(memberRates)
      .values(input)
      .onConflictDoUpdate({
        target: memberRates.membershipId,
        set: { costRateMinor: input.costRateMinor, billRateMinor: input.billRateMinor },
      });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "member.rate",
      entityType: "membership",
      entityId: input.membershipId,
      data: { costRateMinor: input.costRateMinor, billRateMinor: input.billRateMinor },
    });
    await markChanged(tx, ctx.tenant.id, "memberRate", input.membershipId);
  });
}

/* ─── Billing time ─────────────────────────────────────────────── */

const unbilled = (tenantId: string, projectId: string) =>
  and(
    eq(timeEntries.tenantId, tenantId),
    eq(timeEntries.projectId, projectId),
    eq(timeEntries.billable, true),
    isNull(timeEntries.invoiceId),
  );

/** Billable time on a project that is not on an invoice yet, valued exactly as it will be invoiced. */
export async function unbilledTime(database: DbOrTx, tenantId: string, projectId: string) {
  const entries = await database
    .select({
      membershipId: timeEntries.membershipId,
      minutes: timeEntries.minutes,
      hourlyRateMinor: timeEntries.hourlyRateMinor,
    })
    .from(timeEntries)
    .where(unbilled(tenantId, projectId));
  return {
    count: entries.length,
    minutes: entries.reduce((sum, e) => sum + e.minutes, 0),
    valueMinor: timeValue(entries),
  };
}

/**
 * Draft invoice for a project's unbilled billable time: one line per person and rate,
 * hours × hourly rate, the tenant's default tax. The entries are stamped with the
 * invoice in the same transaction so they are never billed twice.
 */
export async function invoiceUnbilledTime(
  database: Database,
  ctx: TenantContext,
  scope: Scope,
  projectId: string,
  today: string,
): Promise<string> {
  return database.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id, name: projects.name, clientId: projects.clientId })
      .from(projects)
      .where(
        and(eq(projects.id, projectId), eq(projects.tenantId, ctx.tenant.id), projectScopeFilter(ctx, scope)),
      );
    if (!project) throw new UserError(t("projects.missing"));
    if (!project.clientId) throw new UserError(t("projects.noClient"));
    // Lock the entries so two clicks cannot bill the same time twice.
    const entries = await tx
      .select({
        id: timeEntries.id,
        membershipId: timeEntries.membershipId,
        minutes: timeEntries.minutes,
        hourlyRateMinor: timeEntries.hourlyRateMinor,
      })
      .from(timeEntries)
      .where(unbilled(ctx.tenant.id, project.id))
      .orderBy(asc(timeEntries.date), asc(timeEntries.createdAt))
      .for("update");
    if (entries.length === 0) throw new UserError(t("projects.nothingToInvoice"));
    const names = await tx
      .select({ id: memberships.id, name: user.name })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(inArray(memberships.id, [...new Set(entries.map((e) => e.membershipId))]));
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    const items = timeInvoiceLines(entries, {
      taxRateBp: ctx.tenant.settings.tax.rateBp,
      describe: (membershipId) =>
        t("projects.timeInvoiceLine", { member: nameOf.get(membershipId) ?? "—", project: project.name }),
    });
    const invoiceId = await insertInvoice(tx, actorOf(ctx), {
      clientId: project.clientId,
      issueDate: today,
      dueDate: addDays(today, ctx.tenant.settings.paymentTermsDays),
      items,
      notes: t("projects.timeInvoiceNotes", { project: project.name }),
      custom: {},
    });
    const ids = entries.map((e) => e.id);
    await tx.update(timeEntries).set({ invoiceId }).where(inArray(timeEntries.id, ids));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "project.invoiceTime",
      entityType: "project",
      entityId: project.id,
      data: { invoiceId, entries: ids.length },
    });
    for (const id of ids) await markChanged(tx, ctx.tenant.id, "time", id);
    return invoiceId;
  });
}
