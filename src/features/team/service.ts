import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { site } from "@/config";
import { assertSeatAvailable } from "@/features/billing";
import { t } from "@/i18n";
import { randomToken } from "@/lib/ids";
import { DEFAULT_ROLE_KEYS, defaultRoleTemplates, permissionDef, type Audience } from "@/modules/catalog";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { appUrl } from "@/server/mail";
import { queueMail } from "@/server/shared";
import {
  clients,
  invitations,
  memberOverrides,
  memberRoles,
  memberships,
  rolePermissions,
  roles,
  tenants,
  user,
} from "@/server/db/schema";
import { canGrant, type Grant, type Scope } from "@/server/rbac/resolve";
import { bumpPermissionsVersion, ownerMembershipIds, resetRoleToDefault } from "@/server/rbac/service";
import type { TenantContext } from "@/server/tenancy/context";

/** Days an invitation link stays valid (also quoted in the invitation email). */
export const INVITE_DAYS = 14;

/* ─── Guards ───────────────────────────────────────────────────── */

async function grantsOfRoles(database: DbOrTx, roleIds: readonly string[]): Promise<Grant[]> {
  if (roleIds.length === 0) return [];
  return database
    .select({ permission: rolePermissions.permission, scope: rolePermissions.scope })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, [...roleIds]));
}

/** Throws unless the actor holds every internal grant they hand out or take away (no privilege escalation). */
function assertCanGrantAll(ctx: TenantContext, grants: readonly Grant[]): void {
  for (const g of grants) {
    const def = permissionDef(g.permission);
    if (!def) throw new UserError(t("team.unknownPermission", { permission: g.permission }));
    if (def.audience === "client") continue; // client permissions are never held by staff
    if (!canGrant(ctx.permissions, g.permission, g.scope)) {
      throw new UserError(t("team.escalation", { permission: t(def.label) }));
    }
  }
}

async function tenantRoles(database: DbOrTx, tenantId: string, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const rows = await database
    .select()
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), inArray(roles.id, [...ids])));
  if (rows.length !== new Set(ids).size) throw new UserError(t("team.roleMissing"));
  return rows;
}

/* ─── Invitations ──────────────────────────────────────────────── */

export async function createInvitation(
  database: Database,
  ctx: TenantContext,
  input: { email: string; kind: Audience; clientId: string | null; roleIds: string[] },
): Promise<{ token: string }> {
  const email = input.email.trim().toLowerCase();
  if (input.roleIds.length === 0) throw new UserError(t("team.pickRole"));
  return database.transaction(async (tx) => {
    const picked = await tenantRoles(tx, ctx.tenant.id, input.roleIds);
    if (picked.some((r) => r.audience !== input.kind)) throw new UserError(t("team.audienceMismatch"));
    if (input.kind === "client") {
      if (!input.clientId) throw new UserError(t("team.pickClient"));
      const [client] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, input.clientId), eq(clients.tenantId, ctx.tenant.id)));
      if (!client) throw new UserError(t("team.pickClient"));
    }
    assertCanGrantAll(ctx, await grantsOfRoles(tx, input.roleIds));

    const existing = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(and(eq(memberships.tenantId, ctx.tenant.id), eq(user.email, email)));
    if (existing.length > 0) throw new UserError(t("team.alreadyMember"));
    if (input.kind === "internal") await assertSeatAvailable(tx, ctx.tenant);

    const token = randomToken(24);
    await tx.insert(invitations).values({
      tenantId: ctx.tenant.id,
      email,
      kind: input.kind,
      clientId: input.kind === "client" ? input.clientId : null,
      roleIds: input.roleIds,
      token,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      invitedBy: ctx.user.id,
    });
    // Sent by the job runner only if this transaction commits.
    const vars = {
      inviter: ctx.user.name,
      name: ctx.tenant.name,
      app: site.name,
      link: appUrl(`/invite/${token}`),
      days: INVITE_DAYS,
    };
    await queueMail(tx, {
      to: email,
      subject: t("invite.mail.subject", vars),
      text: t("invite.mail.body", vars),
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "invitation.create",
      entityType: "invitation",
      data: { email, kind: input.kind, roles: picked.map((r) => r.key) },
    });
    return { token };
  });
}

export async function revokeInvitation(database: Database, ctx: TenantContext, id: string): Promise<void> {
  await database
    .delete(invitations)
    .where(
      and(eq(invitations.id, id), eq(invitations.tenantId, ctx.tenant.id), isNull(invitations.acceptedAt)),
    );
}

export async function invitationByToken(database: DbOrTx, token: string) {
  const [row] = await database
    .select({ invitation: invitations, tenantName: tenants.name, tenantSlug: tenants.slug })
    .from(invitations)
    .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
    .where(eq(invitations.token, token));
  return row ?? null;
}

/**
 * Accepts an invitation for the signed-in user. The email must match and be
 * verified (read from the database, never trusted from the caller), so nobody
 * can claim an invitation by signing up with someone else's address.
 */
export async function acceptInvitation(
  database: Database,
  token: string,
  signedIn: { id: string },
): Promise<{ slug: string; kind: Audience }> {
  return database.transaction(async (tx) => {
    const row = await invitationByToken(tx, token);
    if (!row || row.invitation.acceptedAt) throw new UserError(t("invite.invalid"));
    const inv = row.invitation;
    if (inv.expiresAt < new Date()) throw new UserError(t("invite.expired"));
    const [account] = await tx
      .select({ email: user.email, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, signedIn.id));
    if (!account || inv.email !== account.email.toLowerCase()) {
      throw new UserError(t("invite.wrongEmail", { email: inv.email }));
    }
    if (!account.emailVerified) throw new UserError(t("invite.verifyEmail", { email: inv.email }));

    const [existing] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.tenantId, inv.tenantId), eq(memberships.userId, signedIn.id)));
    let membershipId = existing?.id;
    if (!membershipId) {
      const [created] = await tx
        .insert(memberships)
        .values({ tenantId: inv.tenantId, userId: signedIn.id, kind: inv.kind, clientId: inv.clientId })
        .returning({ id: memberships.id });
      if (!created) throw new Error("Membership insert failed");
      membershipId = created.id;
    }
    const validRoles =
      inv.roleIds.length > 0
        ? await tx
            .select({ id: roles.id })
            .from(roles)
            .where(
              and(
                eq(roles.tenantId, inv.tenantId),
                inArray(roles.id, inv.roleIds),
                eq(roles.audience, inv.kind),
              ),
            )
        : [];
    if (validRoles.length > 0) {
      const id = membershipId;
      await tx
        .insert(memberRoles)
        .values(validRoles.map((r) => ({ membershipId: id, roleId: r.id })))
        .onConflictDoNothing();
    }
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    await bumpPermissionsVersion(tx, inv.tenantId);
    await audit(tx, {
      tenantId: inv.tenantId,
      actorUserId: signedIn.id,
      action: "invitation.accept",
      entityType: "membership",
      entityId: membershipId,
      data: { email: inv.email },
    });
    return { slug: row.tenantSlug, kind: inv.kind };
  });
}

export async function pendingInvitations(database: DbOrTx, tenantId: string) {
  return database
    .select()
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), isNull(invitations.acceptedAt)))
    .orderBy(asc(invitations.createdAt));
}

/* ─── Members ──────────────────────────────────────────────────── */

export async function listMembers(database: DbOrTx, tenantId: string) {
  const rows = await database
    .select({
      id: memberships.id,
      kind: memberships.kind,
      status: memberships.status,
      title: memberships.title,
      clientId: memberships.clientId,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId))
    .orderBy(asc(user.name));
  const ids = rows.map((r) => r.id);
  const roleRows = ids.length
    ? await database
        .select({
          membershipId: memberRoles.membershipId,
          roleId: roles.id,
          name: roles.name,
          key: roles.key,
        })
        .from(memberRoles)
        .innerJoin(roles, eq(roles.id, memberRoles.roleId))
        .where(inArray(memberRoles.membershipId, ids))
    : [];
  return rows.map((r) => ({ ...r, roles: roleRows.filter((x) => x.membershipId === r.id) }));
}

export type Member = Awaited<ReturnType<typeof listMembers>>[number];

export async function memberById(
  database: DbOrTx,
  tenantId: string,
  membershipId: string,
): Promise<Member | null> {
  const all = await listMembers(database, tenantId);
  return all.find((m) => m.id === membershipId) ?? null;
}

async function assertKeepsAnOwner(tx: DbOrTx, tenantId: string, membershipId: string, remainsOwner: boolean) {
  if (remainsOwner) return;
  const owners = await ownerMembershipIds(tx, tenantId);
  if (owners.length === 1 && owners[0] === membershipId) throw new UserError(t("team.lastOwner"));
}

export async function setMemberRoles(
  database: Database,
  ctx: TenantContext,
  membershipId: string,
  roleIds: string[],
): Promise<void> {
  await database.transaction(async (tx) => {
    const member = await memberById(tx, ctx.tenant.id, membershipId);
    if (!member) throw new UserError(t("team.memberMissing"));
    const picked = await tenantRoles(tx, ctx.tenant.id, roleIds);
    if (picked.some((r) => r.audience !== member.kind)) throw new UserError(t("team.audienceMismatch"));
    // Both the roles taken away and the roles given must be within the actor's own powers.
    const before = member.roles.map((r) => r.roleId);
    const changed = [
      ...roleIds.filter((id) => !before.includes(id)),
      ...before.filter((id) => !roleIds.includes(id)),
    ];
    assertCanGrantAll(ctx, await grantsOfRoles(tx, changed));
    await assertKeepsAnOwner(
      tx,
      ctx.tenant.id,
      membershipId,
      picked.some((r) => r.key === "owner"),
    );

    await tx.delete(memberRoles).where(eq(memberRoles.membershipId, membershipId));
    if (roleIds.length > 0)
      await tx.insert(memberRoles).values(roleIds.map((roleId) => ({ membershipId, roleId })));
    await bumpPermissionsVersion(tx, ctx.tenant.id);
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "member.roles",
      entityType: "membership",
      entityId: membershipId,
      data: { roles: picked.map((r) => r.key) },
    });
  });
}

export async function updateMember(
  database: Database,
  ctx: TenantContext,
  membershipId: string,
  input: { title: string; status: "active" | "disabled" },
): Promise<void> {
  await database.transaction(async (tx) => {
    const member = await memberById(tx, ctx.tenant.id, membershipId);
    if (!member) throw new UserError(t("team.memberMissing"));
    if (input.status !== member.status) {
      if (member.userId === ctx.user.id) throw new UserError(t("team.notSelf"));
      // Switching someone off or on is as strong as changing their roles: only an owner
      // may do it to an owner, and only someone who holds everything the person can do.
      if (member.roles.some((r) => r.key === "owner")) {
        const owners = await ownerMembershipIds(tx, ctx.tenant.id);
        if (!owners.includes(ctx.membership.id)) throw new UserError(t("team.ownerOnly"));
      }
      assertCanGrantAll(
        ctx,
        await grantsOfRoles(
          tx,
          member.roles.map((r) => r.roleId),
        ),
      );
    }
    if (input.status === "disabled") {
      await assertKeepsAnOwner(tx, ctx.tenant.id, membershipId, false);
    }
    // Re-enabling a team member takes a seat again.
    if (input.status === "active" && member.status !== "active" && member.kind === "internal") {
      await assertSeatAvailable(tx, ctx.tenant);
    }
    await tx
      .update(memberships)
      .set({ title: input.title, status: input.status })
      .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, ctx.tenant.id)));
    await bumpPermissionsVersion(tx, ctx.tenant.id);
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "member.update",
      entityType: "membership",
      entityId: membershipId,
      data: input,
    });
  });
}

/* ─── Per-member overrides ─────────────────────────────────────── */

export async function memberOverridesList(database: DbOrTx, tenantId: string, membershipId: string) {
  return database
    .select()
    .from(memberOverrides)
    .where(and(eq(memberOverrides.tenantId, tenantId), eq(memberOverrides.membershipId, membershipId)))
    .orderBy(asc(memberOverrides.createdAt));
}

export async function addOverride(
  database: Database,
  ctx: TenantContext,
  input: {
    membershipId: string;
    permission: string;
    effect: "allow" | "deny";
    scope: Scope;
    expiresAt: Date | null;
    reason: string;
  },
): Promise<void> {
  await database.transaction(async (tx) => {
    const member = await memberById(tx, ctx.tenant.id, input.membershipId);
    if (!member) throw new UserError(t("team.memberMissing"));
    const def = permissionDef(input.permission);
    if (!def || def.audience !== member.kind) throw new UserError(t("team.audienceMismatch"));
    if (!def.scopes.includes(input.scope)) throw new UserError(t("team.scopeInvalid"));
    assertCanGrantAll(ctx, [{ permission: input.permission, scope: input.scope }]);
    if (member.userId === ctx.user.id && input.effect === "deny") throw new UserError(t("team.notSelf"));
    await tx
      .delete(memberOverrides)
      .where(
        and(
          eq(memberOverrides.membershipId, input.membershipId),
          eq(memberOverrides.permission, input.permission),
        ),
      );
    await tx.insert(memberOverrides).values({ tenantId: ctx.tenant.id, grantedBy: ctx.user.id, ...input });
    await bumpPermissionsVersion(tx, ctx.tenant.id);
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: `override.${input.effect}`,
      entityType: "membership",
      entityId: input.membershipId,
      data: input,
    });
  });
}

export async function removeOverride(
  database: Database,
  ctx: TenantContext,
  overrideId: string,
): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .delete(memberOverrides)
      .where(and(eq(memberOverrides.id, overrideId), eq(memberOverrides.tenantId, ctx.tenant.id)))
      .returning();
    if (!row) return;
    await bumpPermissionsVersion(tx, ctx.tenant.id);
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "override.remove",
      entityType: "membership",
      entityId: row.membershipId,
      data: { permission: row.permission, effect: row.effect },
    });
  });
}

/* ─── Roles ────────────────────────────────────────────────────── */

export async function listRoles(database: DbOrTx, tenantId: string) {
  const rows = await database
    .select()
    .from(roles)
    .where(eq(roles.tenantId, tenantId))
    .orderBy(asc(roles.createdAt));
  const ids = rows.map((r) => r.id);
  const grants = ids.length
    ? await database.select().from(rolePermissions).where(inArray(rolePermissions.roleId, ids))
    : [];
  const counts = ids.length
    ? await database
        .select({ roleId: memberRoles.roleId })
        .from(memberRoles)
        .where(inArray(memberRoles.roleId, ids))
    : [];
  return rows.map((r) => ({
    ...r,
    grants: grants
      .filter((g) => g.roleId === r.id)
      .map((g) => ({ permission: g.permission, scope: g.scope })),
    memberCount: counts.filter((c) => c.roleId === r.id).length,
  }));
}

export type RoleWithGrants = Awaited<ReturnType<typeof listRoles>>[number];

export async function createRole(
  database: Database,
  ctx: TenantContext,
  input: { name: string; description: string; audience: Audience; copyFromRoleId: string | null },
): Promise<string> {
  return database.transaction(async (tx) => {
    const key = `custom_${randomToken(6)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")}`;
    const [role] = await tx
      .insert(roles)
      .values({
        tenantId: ctx.tenant.id,
        key,
        name: input.name,
        description: input.description,
        audience: input.audience,
      })
      .returning({ id: roles.id });
    if (!role) throw new Error("Role insert failed");
    if (input.copyFromRoleId) {
      const [source] = await tenantRoles(tx, ctx.tenant.id, [input.copyFromRoleId]);
      if (source && source.audience === input.audience) {
        const grants = await grantsOfRoles(tx, [source.id]);
        assertCanGrantAll(ctx, grants);
        if (grants.length)
          await tx.insert(rolePermissions).values(grants.map((g) => ({ roleId: role.id, ...g })));
      }
    }
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "role.create",
      entityType: "role",
      entityId: role.id,
      data: { name: input.name, audience: input.audience },
    });
    return role.id;
  });
}

/** Replaces a role's permissions. The owner role is fixed (it always has everything). */
export async function updateRole(
  database: Database,
  ctx: TenantContext,
  roleId: string,
  input: { name: string; description: string; grants: Grant[] },
): Promise<void> {
  await database.transaction(async (tx) => {
    const [role] = await tenantRoles(tx, ctx.tenant.id, [roleId]);
    if (!role) throw new UserError(t("team.roleMissing"));
    if (role.key === "owner") throw new UserError(t("team.ownerFixed"));
    for (const g of input.grants) {
      const def = permissionDef(g.permission);
      if (!def || def.audience !== role.audience) throw new UserError(t("team.audienceMismatch"));
      if (!def.scopes.includes(g.scope)) throw new UserError(t("team.scopeInvalid"));
    }
    const before = await grantsOfRoles(tx, [roleId]);
    const key = (g: Grant) => `${g.permission}:${g.scope}`;
    const changed = [
      ...input.grants.filter((g) => !before.some((b) => key(b) === key(g))),
      ...before.filter((b) => !input.grants.some((g) => key(g) === key(b))),
    ];
    assertCanGrantAll(ctx, changed);
    await tx
      .update(roles)
      .set({ name: input.name, description: input.description })
      .where(eq(roles.id, roleId));
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (input.grants.length)
      await tx.insert(rolePermissions).values(input.grants.map((g) => ({ roleId, ...g })));
    await bumpPermissionsVersion(tx, ctx.tenant.id);
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "role.update",
      entityType: "role",
      entityId: roleId,
      data: { name: input.name, grants: input.grants },
    });
  });
}

export async function deleteRole(database: Database, ctx: TenantContext, roleId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [role] = await tenantRoles(tx, ctx.tenant.id, [roleId]);
    if (!role) throw new UserError(t("team.roleMissing"));
    if (role.isSystem || (DEFAULT_ROLE_KEYS as readonly string[]).includes(role.key)) {
      throw new UserError(t("team.systemRole"));
    }
    const used = await tx.select().from(memberRoles).where(eq(memberRoles.roleId, roleId));
    if (used.length > 0) throw new UserError(t("team.roleInUse"));
    await tx.delete(roles).where(eq(roles.id, roleId));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "role.delete",
      entityType: "role",
      entityId: roleId,
      data: { name: role.name },
    });
  });
}

export async function resetRole(database: Database, ctx: TenantContext, roleId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [role] = await tenantRoles(tx, ctx.tenant.id, [roleId]);
    const template = defaultRoleTemplates().find((r) => r.key === role?.key);
    if (!role || !role.isSystem || !template) throw new UserError(t("team.roleMissing"));
    // Resetting is an edit like any other: everything it adds or removes must be within the actor's powers.
    const before = await grantsOfRoles(tx, [roleId]);
    const key = (g: Grant) => `${g.permission}:${g.scope}`;
    const changed = [
      ...template.grants.filter((g) => !before.some((b) => key(b) === key(g))),
      ...before.filter((b) => !template.grants.some((g) => key(g) === key(b))),
    ];
    assertCanGrantAll(ctx, changed);
    await resetRoleToDefault(tx, ctx.tenant.id, roleId);
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "role.reset",
      entityType: "role",
      entityId: roleId,
    });
  });
}
