"use server";

import { z } from "zod";
import { t } from "@/i18n";
import { PERMISSIONS } from "@/modules/catalog";
import { fields, formObject, runAction, type ActionState } from "@/server/action";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { appUrl } from "@/server/mail";
import { SCOPES, type Grant } from "@/server/rbac/resolve";
import {
  addOverride,
  createInvitation,
  createRole,
  deleteRole,
  removeOverride,
  resendInvitation,
  resetRole,
  revokeInvitation,
  setMemberRoles,
  updateMember,
  updateRole,
} from "./service";

const kind = z.enum(["internal", "client"]);

export async function inviteAction(slug: string, _p: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "members.invite");
    const raw = formObject(formData);
    const input = z
      .object({
        email: z.email(t("form.email")),
        kind: kind.default("internal"),
        clientId: fields.optionalId(),
      })
      .parse(raw);
    const roleIds = fields.all(formData, "roleIds");
    // createInvitation queues the invitation email in its transaction.
    const { token } = await createInvitation(db(), ctx, { ...input, roleIds });
    const link = appUrl(`/invite/${token}`);
    return t("team.inviteSent", { link });
  });
}

export async function revokeInvitationAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "members.invite");
    await revokeInvitation(db(), ctx, fields.id().parse(formObject(formData).id));
    return t("access.invite.revoked");
  });
}

/** Emails a pending or expired invitation again with a fresh link (the old one stops working). */
export async function resendInvitationAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "members.invite");
    await resendInvitation(db(), ctx, fields.id().parse(formObject(formData).id));
    return t("access.invite.resent");
  });
}

export async function setMemberRolesAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "members.manage");
    const id = fields.id().parse(formObject(formData).membershipId);
    await setMemberRoles(db(), ctx, id, z.array(z.uuid()).parse(fields.all(formData, "roleIds")));
  });
}

export async function updateMemberAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "members.manage");
    const input = z
      .object({ membershipId: fields.id(), title: fields.text(120), status: z.enum(["active", "disabled"]) })
      .parse(formObject(formData));
    await updateMember(db(), ctx, input.membershipId, { title: input.title, status: input.status });
  });
}

export async function addOverrideAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "members.manage");
    const input = z
      .object({
        membershipId: fields.id(),
        permission: z.string().refine((p) => PERMISSIONS.some((d) => d.key === p), t("form.invalid")),
        effect: z.enum(["allow", "deny"]),
        scope: z.enum(SCOPES).default("all"),
        expires: fields.optionalDate(),
        reason: fields.text(300),
      })
      .parse(formObject(formData));
    const { expires, ...rest } = input;
    await addOverride(db(), ctx, { ...rest, expiresAt: expires ? new Date(`${expires}T23:59:59Z`) : null });
  });
}

export async function removeOverrideAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "members.manage");
    await removeOverride(db(), ctx, fields.id().parse(formObject(formData).id));
  });
}

export async function createRoleAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "roles.manage");
    const input = z
      .object({
        name: fields.required(80),
        description: fields.text(300),
        audience: kind.default("internal"),
        copyFromRoleId: fields.optionalId(),
      })
      .parse(formObject(formData));
    await createRole(db(), ctx, input);
  });
}

/** Grants arrive as `g_<permission>` = scope ("" = not granted). */
export async function updateRoleAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "roles.manage");
    const raw = formObject(formData);
    const input = z
      .object({ roleId: fields.id(), name: fields.required(80), description: fields.text(300) })
      .parse(raw);
    const grants: Grant[] = [];
    for (const def of PERMISSIONS) {
      const value = raw[`g_${def.key}`];
      if (!value) continue;
      const scope = z.enum(SCOPES).parse(value);
      grants.push({ permission: def.key, scope });
    }
    await updateRole(db(), ctx, input.roleId, { name: input.name, description: input.description, grants });
  });
}

export async function deleteRoleAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "roles.manage");
    await deleteRole(db(), ctx, fields.id().parse(formObject(formData).roleId));
  });
}

export async function resetRoleAction(
  slug: string,
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await actionContext(slug, "roles.manage");
    await resetRole(db(), ctx, fields.id().parse(formObject(formData).roleId));
  });
}
