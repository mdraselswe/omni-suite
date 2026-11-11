"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { t } from "@/i18n";
import { parseDuration, today } from "@/lib/dates";
import { customValues, fields, formObject, runAction, UserError, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { customFieldsFor } from "@/server/shared";
import {
  addComment,
  approveTask,
  createProject,
  createTask,
  deleteProjectTemplate,
  deleteTask,
  deleteTime,
  invoiceUnbilledTime,
  logTime,
  requestTaskChanges,
  saveProjectTemplate,
  setProjectMember,
  setRate,
  updateProject,
  updateTask,
} from "./service";

async function parseProject(slug: string, formData: FormData) {
  const { ctx, scope } = await actionContext(slug, "projects.write");
  const raw = formObject(formData);
  const input = z
    .object({
      name: fields.required(200),
      description: fields.text(10000),
      clientId: fields.optionalId(),
      status: fields.required(50),
      startDate: fields.optionalDate().transform((v) => v || null),
      dueDate: fields.optionalDate().transform((v) => v || null),
      budget: fields.money(ctx.tenant.settings.currency, { optional: true }),
    })
    .parse(raw);
  const custom = customValues(await customFieldsFor(db(), ctx.tenant.id, "project"), raw);
  const { budget, ...rest } = input;
  return { ctx, scope, raw, project: { ...rest, budgetMinor: budget, custom } };
}

export async function createProjectAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let id = "";
  const state = await runAction(async () => {
    const { ctx, raw, project } = await parseProject(slug, formData);
    id = await createProject(db(), ctx, {
      ...project,
      templateId: fields.optionalId().parse(raw.templateId ?? ""),
    });
  });
  if (state?.ok && id) redirect(`/${slug}/projects/${id}` as "/");
  return state;
}

export async function updateProjectAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, scope, raw, project } = await parseProject(slug, formData);
    await updateProject(db(), ctx, scope, fields.id().parse(raw.id), project);
  });
}

export async function setProjectMemberAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "projects.write");
    const input = z
      .object({ projectId: fields.id(), membershipId: fields.id(), add: z.enum(["true", "false"]) })
      .parse(formObject(formData));
    await setProjectMember(db(), ctx, { ...input, add: input.add === "true" });
  });
}

export async function saveProjectTemplateAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "projects.write", "all");
    const input = z
      .object({ id: fields.optionalId(), name: fields.required(120), tasks: fields.text(10000) })
      .parse(formObject(formData));
    const tasks = input.tasks
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [title = "", flag = ""] = line.split("|").map((p) => p.trim());
        return { title: title.slice(0, 200), clientVisible: flag.toLowerCase() === "client" };
      });
    await saveProjectTemplate(db(), ctx, { id: input.id, name: input.name, tasks });
  });
}

export async function deleteProjectTemplateAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "projects.write", "all");
    await deleteProjectTemplate(db(), ctx, fields.id().parse(formObject(formData).id));
    return t("projects.templateDeleted");
  });
}

/** Draft invoice from the project's unbilled time, then opens it. */
export async function invoiceUnbilledTimeAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let invoiceId = "";
  const state = await runAction(async () => {
    await actionContext(slug, "invoices.write");
    const { ctx, scope } = await actionContext(slug, "projects.read");
    const { projectId } = z.object({ projectId: fields.id() }).parse(formObject(formData));
    invoiceId = await invoiceUnbilledTime(db(), ctx, scope, projectId, today(ctx.tenant.settings.timezone));
  });
  if (state?.ok && invoiceId) redirect(`/${slug}/invoices/${invoiceId}` as "/");
  return state;
}

const taskSchema = z.object({
  title: fields.required(300),
  description: fields.text(10000),
  status: z.enum(["todo", "in_progress", "review", "done"]).default("todo"),
  assigneeMembershipId: fields.optionalId(),
  dueDate: fields.optionalDate().transform((v) => v || null),
  clientVisible: fields.checkbox(),
  needsApproval: fields.checkbox(),
});

export async function createTaskAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, scope } = await actionContext(slug, "tasks.write");
    const raw = formObject(formData);
    const input = taskSchema.parse(raw);
    await createTask(db(), ctx, scope, fields.id().parse(raw.projectId), input);
  });
}

export async function updateTaskAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, scope } = await actionContext(slug, "tasks.write");
    const raw = formObject(formData);
    await updateTask(db(), ctx, scope, fields.id().parse(raw.id), taskSchema.parse(raw));
  });
}

export async function setTaskStatusAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, scope } = await actionContext(slug, "tasks.write");
    const { id, status } = z
      .object({ id: fields.id(), status: z.enum(["todo", "in_progress", "review", "done"]) })
      .parse(formObject(formData));
    await updateTask(db(), ctx, scope, id, { status });
  });
}

export async function deleteTaskAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, scope } = await actionContext(slug, "tasks.write");
    await deleteTask(db(), ctx, scope, fields.id().parse(formObject(formData).id));
  });
}

export async function approveTaskAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "portal.approve");
    await approveTask(db(), ctx, fields.id().parse(formObject(formData).id));
  });
}

export async function requestTaskChangesAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "portal.approve");
    const { id, comment } = z
      .object({ id: fields.id(), comment: fields.required(2000) })
      .parse(formObject(formData));
    await requestTaskChanges(db(), ctx, id, comment);
    return t("tasks.changesSent");
  });
}

export async function addCommentAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctxPerm = await actionContext(slug, "portal.projects").catch(() =>
      actionContext(slug, "projects.read"),
    );
    const input = z
      .object({ projectId: fields.id(), body: fields.required(5000), clientVisible: fields.checkbox() })
      .parse(formObject(formData));
    await addComment(db(), ctxPerm.ctx, input);
  });
}

export async function logTimeAction(slug: string, _p: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, scope } = await actionContext(slug, "time.write");
    const raw = formObject(formData);
    const input = z
      .object({
        projectId: fields.id(),
        taskId: fields.optionalId(),
        membershipId: fields.optionalId(),
        date: fields.date(),
        duration: fields.required(20),
        note: fields.text(1000),
        billable: fields.checkbox(),
      })
      .parse(raw);
    const minutes = parseDuration(input.duration);
    if (minutes === null) throw new UserError(t("time.badDuration"));
    await logTime(db(), ctx, scope, { ...input, minutes });
  });
}

export async function deleteTimeAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx, scope } = await actionContext(slug, "time.write");
    await deleteTime(db(), ctx, scope, fields.id().parse(formObject(formData).id));
  });
}

export async function setRateAction(slug: string, _p: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "members.manage", "all");
    const cur = ctx.tenant.settings.currency;
    const input = z
      .object({
        membershipId: fields.id(),
        cost: fields.money(cur, { optional: true }),
        bill: fields.money(cur, { optional: true }),
      })
      .parse(formObject(formData));
    await setRate(db(), ctx, {
      membershipId: input.membershipId,
      costRateMinor: input.cost,
      billRateMinor: input.bill,
    });
  });
}
