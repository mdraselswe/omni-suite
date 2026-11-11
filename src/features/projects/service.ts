import "server-only";
import { and, asc, desc, eq, gte, lte, or, sql, type SQL } from "drizzle-orm";
import { t } from "@/i18n";
import type { CustomValues } from "@/lib/custom-fields";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import {
  clients,
  comments,
  memberRates,
  memberships,
  projectMembers,
  projects,
  projectTemplates,
  tasks,
  timeEntries,
  user,
} from "@/server/db/schema";
import type { Scope } from "@/server/rbac/resolve";
import { clientUserIds, notify, usersWithPermission } from "@/server/shared";
import type { TenantContext } from "@/server/tenancy/context";

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

/* ─── Projects ─────────────────────────────────────────────────── */

export async function listProjects(
  database: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  filter: { status?: string; clientId?: string } = {},
) {
  const taskCounts = sql<string>`(select count(*) from ${tasks} where ${tasks.projectId} = ${projects.id})`;
  const doneCounts = sql<string>`(select count(*) from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.status} = 'done')`;
  const rows = await database
    .select({ project: projects, clientName: clients.name, taskCount: taskCounts, doneCount: doneCounts })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(
      and(
        eq(projects.tenantId, ctx.tenant.id),
        projectScopeFilter(ctx, scope),
        filter.status ? eq(projects.status, filter.status) : undefined,
        filter.clientId ? eq(projects.clientId, filter.clientId) : undefined,
      ),
    )
    .orderBy(desc(projects.createdAt))
    .limit(500);
  return rows.map((r) => ({
    ...r.project,
    clientName: r.clientName,
    taskCount: Number(r.taskCount),
    doneCount: Number(r.doneCount),
  }));
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
  assertStatus(ctx, input.status);
  return database.transaction(async (tx) => {
    if (input.clientId) {
      const [c] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, input.clientId), eq(clients.tenantId, ctx.tenant.id)));
      if (!c) throw new UserError(t("clients.missing"));
    }
    const { templateId, ...values } = input;
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
            clientVisible: task.clientVisible,
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
  });
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
  input: { id: string | null; name: string; tasks: { title: string; clientVisible: boolean }[] },
) {
  if (input.id) {
    await database
      .update(projectTemplates)
      .set({ name: input.name, tasks: input.tasks })
      .where(and(eq(projectTemplates.id, input.id), eq(projectTemplates.tenantId, ctx.tenant.id)));
  } else {
    await database
      .insert(projectTemplates)
      .values({ tenantId: ctx.tenant.id, name: input.name, tasks: input.tasks });
  }
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
        await notify(tx, ctx.tenant.id, await clientUserIds(tx, ctx.tenant.id, p.clientId), {
          title: t("tasks.approvalTitle", { name: ctx.tenant.name }),
          body: task.title,
          link: `/${ctx.tenant.slug}/portal/projects/${task.projectId}`,
          email: true,
        });
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

/** Client approves a task from the portal. */
export async function approveTask(database: Database, ctx: TenantContext, id: string) {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .select({ task: tasks, clientId: projects.clientId })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.tenant.id)));
    if (
      !row ||
      !row.task.needsApproval ||
      !row.task.clientVisible ||
      row.clientId !== ctx.membership.clientId
    ) {
      throw new UserError(t("tasks.missing"));
    }
    await tx
      .update(tasks)
      .set({ approvedAt: new Date(), approvedBy: ctx.user.id, status: "done" })
      .where(eq(tasks.id, id));
    await notify(tx, ctx.tenant.id, await usersWithPermission(tx, ctx.tenant.id, "projects.write"), {
      title: t("tasks.approvedTitle", { title: row.task.title }),
      link: `/${ctx.tenant.slug}/projects/${row.task.projectId}`,
    });
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
  await database.transaction(async (tx) => {
    const [p] = await tx
      .select({ id: projects.id, clientId: projects.clientId, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.tenantId, ctx.tenant.id)));
    const isClient = ctx.membership.kind === "client";
    if (!p || (isClient && p.clientId !== ctx.membership.clientId))
      throw new UserError(t("projects.missing"));
    const visible = isClient ? true : input.clientVisible;
    await tx.insert(comments).values({
      tenantId: ctx.tenant.id,
      entityType: "project",
      entityId: p.id,
      authorUserId: ctx.user.id,
      body: input.body,
      clientVisible: visible,
    });
    if (isClient) {
      const team = await tx
        .select({ userId: memberships.userId })
        .from(projectMembers)
        .innerJoin(memberships, eq(memberships.id, projectMembers.membershipId))
        .where(eq(projectMembers.projectId, p.id));
      await notify(
        tx,
        ctx.tenant.id,
        team.map((m) => m.userId),
        { title: p.name, body: input.body.slice(0, 200), link: `/${ctx.tenant.slug}/projects/${p.id}` },
      );
    } else if (visible && p.clientId) {
      await notify(tx, ctx.tenant.id, await clientUserIds(tx, ctx.tenant.id, p.clientId), {
        title: p.name,
        body: input.body.slice(0, 200),
        link: `/${ctx.tenant.slug}/portal/projects/${p.id}`,
      });
    }
  });
}

/* ─── Time ─────────────────────────────────────────────────────── */

export function timeScopeFilter(ctx: TenantContext, scope: Scope): SQL | undefined {
  if (scope === "all") return undefined;
  const own = eq(timeEntries.membershipId, ctx.membership.id);
  return scope === "assigned" ? or(own, sql`${timeEntries.projectId} in ${myProjectIds(ctx)}`) : own;
}

export async function listTime(
  database: DbOrTx,
  ctx: TenantContext,
  scope: Scope,
  filter: { from: string; to: string; projectId?: string; membershipId?: string },
) {
  return database
    .select({ entry: timeEntries, projectName: projects.name, memberName: user.name })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .innerJoin(memberships, eq(memberships.id, timeEntries.membershipId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(
      and(
        eq(timeEntries.tenantId, ctx.tenant.id),
        timeScopeFilter(ctx, scope),
        gte(timeEntries.date, filter.from),
        lte(timeEntries.date, filter.to),
        filter.projectId ? eq(timeEntries.projectId, filter.projectId) : undefined,
        filter.membershipId ? eq(timeEntries.membershipId, filter.membershipId) : undefined,
      ),
    )
    .orderBy(desc(timeEntries.date), desc(timeEntries.createdAt))
    .limit(1000);
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
    const [row] = await tx
      .delete(timeEntries)
      .where(
        and(
          eq(timeEntries.id, id),
          eq(timeEntries.tenantId, ctx.tenant.id),
          scope === "all" ? undefined : eq(timeEntries.membershipId, ctx.membership.id),
        ),
      )
      .returning({ id: timeEntries.id });
    if (!row) throw new UserError(t("tasks.notAssigned"));
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
  const [m] = await database
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.id, input.membershipId), eq(memberships.tenantId, ctx.tenant.id)));
  if (!m) throw new UserError(t("team.memberMissing"));
  await database
    .insert(memberRates)
    .values(input)
    .onConflictDoUpdate({
      target: memberRates.membershipId,
      set: { costRateMinor: input.costRateMinor, billRateMinor: input.billRateMinor },
    });
}
