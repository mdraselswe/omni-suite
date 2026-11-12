import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { limits, site } from "@/config";
import { serverEnv } from "@/config/env";
import { assertSeatAvailable } from "@/features/billing";
import { t } from "@/i18n";
import { businessName, businessNameOf } from "@/lib/business-name";
import { randomToken } from "@/lib/ids";
import { paginate, type PageRequest } from "@/lib/pagination";
import { DEFAULT_ROLE_KEYS, defaultRoleTemplates, permissionDef, type Audience } from "@/modules/catalog";
import { UserError } from "@/server/action";
import { audit, markChanged } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { appUrl } from "@/server/mail";
import { takeRecipientMail } from "@/server/mail-quota";
import { notify, queueMail } from "@/server/shared";
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
import { canGrant, widerScope, type Grant, type Scope } from "@/server/rbac/resolve";
import { bumpPermissionsVersion, ownerMembershipIds, resetRoleToDefault } from "@/server/rbac/service";
import { matchesSearch } from "@/server/search";
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

export type InvitationState = "open" | "accepted" | "revoked" | "expired";

/** Where an invitation stands (pure, so pages, actions and tests agree). */
export function invitationState(
  inv: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): InvitationState {
  if (inv.acceptedAt) return "accepted";
  if (inv.revokedAt) return "revoked";
  return inv.expiresAt <= now ? "expired" : "open";
}

/** What an invitee is told when a link no longer works, and what to do about it. */
export function invitationStateMessage(state: Exclude<InvitationState, "open">, business: string): string {
  return t(`access.invite.state.${state}`, { business });
}

/**
 * Proof that a link came from the invitation email: an HMAC of the token. The
 * team sees (and may copy) the bare link but never this, so only someone who can
 * read the invited mailbox holds it. It lets a new invitee skip confirming the
 * address again; without it, signing up still needs the usual confirmation email.
 */
export function inviteProof(token: string): string {
  return createHmac("sha256", serverEnv().BETTER_AUTH_SECRET)
    .update(`invite-mail:${token}`)
    .digest("base64url")
    .slice(0, 32);
}

export function isInviteProof(token: string, proof: unknown): boolean {
  if (typeof proof !== "string" || proof === "") return false;
  const expected = Buffer.from(inviteProof(token));
  const given = Buffer.from(proof);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The link the team may copy and share by hand. */
export function inviteLink(token: string): string {
  return appUrl(`/invite/${token}`);
}

async function queueInvitationMail(
  tx: DbOrTx,
  ctx: TenantContext,
  inv: { email: string; kind: Audience; token: string },
): Promise<void> {
  const vars = {
    inviter: ctx.user.name,
    business: businessName(ctx.tenant),
    app: site.name,
    email: inv.email,
    link: appUrl(`/invite/${inv.token}?k=${inviteProof(inv.token)}`),
    days: INVITE_DAYS,
  };
  const kind = inv.kind === "client" ? "client" : "team";
  await queueMail(
    tx,
    {
      to: inv.email,
      subject: t(`access.mail.${kind}.subject`, vars),
      text: t(`access.mail.${kind}.body`, vars),
    },
    { tenantId: ctx.tenant.id },
  );
}

/**
 * Creates an invitation and queues its email inside the caller's transaction
 * (onboarding uses this to invite a client's first portal user).
 */
export async function createInvitationIn(
  tx: DbOrTx,
  ctx: TenantContext,
  input: { email: string; kind: Audience; clientId: string | null; roleIds: string[] },
): Promise<{ id: string; token: string }> {
  const email = input.email.trim().toLowerCase();
  if (input.roleIds.length === 0) throw new UserError(t("team.pickRole"));
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
    .where(and(eq(memberships.tenantId, ctx.tenant.id), sql`lower(${user.email}) = ${email}`));
  if (existing.length > 0) throw new UserError(t("team.alreadyMember"));
  const [pending] = await tx
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.tenantId, ctx.tenant.id),
        eq(invitations.email, email),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (pending) throw new UserError(t("access.invite.alreadyInvited", { email }));
  if (input.kind === "internal") await assertSeatAvailable(tx, ctx.tenant);

  const token = randomToken(24);
  const [row] = await tx
    .insert(invitations)
    .values({
      tenantId: ctx.tenant.id,
      email,
      kind: input.kind,
      clientId: input.kind === "client" ? input.clientId : null,
      roleIds: input.roleIds,
      token,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      invitedBy: ctx.user.id,
    })
    .returning({ id: invitations.id });
  if (!row) throw new Error("Invitation insert failed");
  // Sent by the job runner only if this transaction commits.
  await queueInvitationMail(tx, ctx, { email, kind: input.kind, token });
  await audit(tx, {
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: "invitation.create",
    entityType: "invitation",
    entityId: row.id,
    data: { email, kind: input.kind, clientId: input.clientId, roles: picked.map((r) => r.key) },
  });
  await markChanged(tx, ctx.tenant.id, "invitation", row.id);
  return { id: row.id, token };
}

export async function createInvitation(
  database: Database,
  ctx: TenantContext,
  input: { email: string; kind: Audience; clientId: string | null; roleIds: string[] },
): Promise<{ token: string }> {
  const { token } = await database.transaction((tx) => createInvitationIn(tx, ctx, input));
  return { token };
}

/** A pending invitation of this business (not accepted, not revoked), or a UserError. */
async function pendingInvitation(tx: DbOrTx, tenantId: string, id: string) {
  const [inv] = await tx
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.id, id),
        eq(invitations.tenantId, tenantId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );
  if (!inv) throw new UserError(t("access.invite.notPending"));
  return inv;
}

/** Withdraws an invitation. The row stays, so the link can tell the invitee it was withdrawn. */
export async function revokeInvitation(database: Database, ctx: TenantContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const inv = await pendingInvitation(tx, ctx.tenant.id, id);
    // Expiring it too frees its seat (seat counts look at unexpired, unaccepted invitations).
    const now = new Date();
    await tx.update(invitations).set({ revokedAt: now, expiresAt: now }).where(eq(invitations.id, inv.id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "invitation.revoke",
      entityType: "invitation",
      entityId: inv.id,
      data: { email: inv.email, kind: inv.kind, clientId: inv.clientId },
    });
    await markChanged(tx, ctx.tenant.id, "invitation", inv.id);
  });
}

/**
 * Sends a pending (or expired) invitation again with a fresh link and a new
 * expiry. The old link stops working. Counts against the business's mail quota
 * and the recipient's hourly allowance, and is checked like a new invitation
 * (the actor must hold the roles it hands out; team invitations need a seat).
 */
export async function resendInvitation(
  database: Database,
  ctx: TenantContext,
  id: string,
): Promise<{ token: string }> {
  return database.transaction(async (tx) => {
    const inv = await pendingInvitation(tx, ctx.tenant.id, id);
    assertCanGrantAll(ctx, await grantsOfRoles(tx, inv.roleIds));
    // A live invitation already holds its seat; an expired one takes a seat again.
    if (inv.kind === "internal" && invitationState(inv) === "expired") {
      await assertSeatAvailable(tx, ctx.tenant);
    }
    if (!(await takeRecipientMail(tx, inv.email))) {
      throw new UserError(t("security.mailLimitHour", { limit: limits.mail.perRecipientPerHour }));
    }
    const token = randomToken(24);
    const now = new Date();
    await tx
      .update(invitations)
      .set({ token, expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000), lastSentAt: now })
      .where(eq(invitations.id, inv.id));
    await queueInvitationMail(tx, ctx, { email: inv.email, kind: inv.kind, token });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "invitation.resend",
      entityType: "invitation",
      entityId: inv.id,
      data: { email: inv.email, kind: inv.kind, clientId: inv.clientId },
    });
    await markChanged(tx, ctx.tenant.id, "invitation", inv.id);
    return { token };
  });
}

/** An invitation by its link token, with the business and inviter names the invitee sees. */
export async function invitationByToken(database: DbOrTx, token: string) {
  const [row] = await database
    .select({
      invitation: invitations,
      tenantName: tenants.name,
      tenantSettings: tenants.settings,
      tenantSlug: tenants.slug,
      inviterName: user.name,
    })
    .from(invitations)
    .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
    .leftJoin(user, eq(user.id, invitations.invitedBy))
    .where(eq(invitations.token, token));
  if (!row) return null;
  return {
    invitation: row.invitation,
    tenantSlug: row.tenantSlug,
    business: businessNameOf({ name: row.tenantName, settings: row.tenantSettings }),
    inviterName: row.inviterName,
  };
}

/** Is there already an account for this address? (Emails compare case-insensitively.) */
export async function accountForEmail(database: DbOrTx, email: string) {
  const [row] = await database
    .select({ id: user.id, emailVerified: user.emailVerified })
    .from(user)
    .where(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  return row ?? null;
}

/**
 * Accepts an invitation for the signed-in user. The email must match and be
 * verified (read from the database, never trusted from the caller), so nobody
 * can claim an invitation by signing up with someone else's address. The token
 * is claimed atomically, so it works once even when two requests race.
 */
export async function acceptInvitation(
  database: Database,
  token: string,
  signedIn: { id: string },
): Promise<{ slug: string; kind: Audience }> {
  return database.transaction(async (tx) => {
    const row = await invitationByToken(tx, token);
    if (!row) throw new UserError(t("invite.invalid"));
    const inv = row.invitation;
    const state = invitationState(inv);
    if (state !== "open") throw new UserError(invitationStateMessage(state, row.business));
    const [account] = await tx
      .select({ email: user.email, name: user.name, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, signedIn.id));
    if (!account || inv.email !== account.email.toLowerCase()) {
      throw new UserError(t("invite.wrongEmail", { email: inv.email }));
    }
    if (!account.emailVerified) throw new UserError(t("invite.verifyEmail", { email: inv.email }));

    const [claimed] = await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning({ id: invitations.id });
    if (!claimed) throw new UserError(invitationStateMessage("accepted", row.business));

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
    await bumpPermissionsVersion(tx, inv.tenantId);
    // The person who invited them sees that it worked.
    if (inv.invitedBy && inv.invitedBy !== signedIn.id) {
      await notify(tx, inv.tenantId, [inv.invitedBy], {
        title: t("access.notify.accepted", { name: account.name || inv.email }),
        body: inv.email,
        link:
          inv.kind === "client" && inv.clientId
            ? `/${row.tenantSlug}/clients/${inv.clientId}`
            : `/${row.tenantSlug}/team`,
      });
    }
    await audit(tx, {
      tenantId: inv.tenantId,
      actorUserId: signedIn.id,
      action: "invitation.accept",
      entityType: "membership",
      entityId: membershipId,
      data: { email: inv.email },
    });
    await markChanged(tx, inv.tenantId, "membership", membershipId);
    return { slug: row.tenantSlug, kind: inv.kind };
  });
}

/**
 * Invitations still waiting for an answer (not accepted, not revoked), newest
 * first, with role and inviter names. Expired ones are included (flagged), so
 * the business can resend them. `clientId` narrows to one client's portal invitations.
 */
export async function pendingInvitations(
  database: DbOrTx,
  tenantId: string,
  filter: { clientId?: string } = {},
) {
  const rows = await database
    .select({ invitation: invitations, inviterName: user.name })
    .from(invitations)
    .leftJoin(user, eq(user.id, invitations.invitedBy))
    .where(
      and(
        eq(invitations.tenantId, tenantId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        filter.clientId ? eq(invitations.clientId, filter.clientId) : undefined,
      ),
    )
    .orderBy(desc(invitations.createdAt));
  const roleIds = [...new Set(rows.flatMap((r) => r.invitation.roleIds))];
  const roleRows = roleIds.length
    ? await database
        .select({ id: roles.id, name: roles.name })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), inArray(roles.id, roleIds)))
    : [];
  const roleName = new Map(roleRows.map((r) => [r.id, r.name]));
  const now = new Date();
  return rows.map(({ invitation, inviterName }) => ({
    ...invitation,
    inviterName,
    sentAt: invitation.lastSentAt ?? invitation.createdAt,
    expired: invitationState(invitation, now) === "expired",
    roleNames: invitation.roleIds.flatMap((id) => {
      const name = roleName.get(id);
      return name ? [name] : [];
    }),
  }));
}

export type PendingInvitation = Awaited<ReturnType<typeof pendingInvitations>>[number];

/**
 * Invitations addressed to a (verified) email that are still waiting, across
 * businesses: where a signed-in user with no business yet should be sent.
 */
export async function invitationsForEmail(database: DbOrTx, email: string) {
  const rows = await database
    .select({
      token: invitations.token,
      kind: invitations.kind,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
      tenantName: tenants.name,
      tenantSettings: tenants.settings,
    })
    .from(invitations)
    .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
    .where(
      and(
        eq(invitations.email, email.trim().toLowerCase()),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        eq(tenants.status, "active"),
      ),
    )
    .orderBy(desc(invitations.createdAt));
  const now = new Date();
  return rows.map((r) => ({
    token: r.token,
    kind: r.kind,
    business: businessNameOf({ name: r.tenantName, settings: r.tenantSettings }),
    expired: invitationState(r, now) === "expired",
  }));
}

/** Businesses where the user's access was switched off (so home can say so instead of offering a new business). */
export async function disabledAccess(database: DbOrTx, userId: string) {
  const rows = await database
    .select({ name: tenants.name, settings: tenants.settings })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "disabled")))
    .orderBy(asc(tenants.name));
  return rows.map((r) => businessNameOf(r));
}

/* ─── Members ──────────────────────────────────────────────────── */

const memberFields = {
  id: memberships.id,
  kind: memberships.kind,
  status: memberships.status,
  title: memberships.title,
  clientId: memberships.clientId,
  userId: user.id,
  name: user.name,
  email: user.email,
  image: user.image,
};

export async function listMembers(database: DbOrTx, tenantId: string) {
  const rows = await database
    .select(memberFields)
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId))
    .orderBy(asc(user.name), asc(memberships.id));
  return withRoles(database, rows);
}

/** One page of members by name; `q` finds words in the name, email or job title. */
export async function pageMembers(
  database: DbOrTx,
  tenantId: string,
  filter: { kind?: "internal" | "client"; q?: string },
  page: PageRequest,
) {
  const where = and(
    eq(memberships.tenantId, tenantId),
    filter.kind ? eq(memberships.kind, filter.kind) : undefined,
    matchesSearch(filter.q, [user.name, user.email, memberships.title]),
  );
  return paginate(
    page,
    async () => {
      const [row] = await database
        .select({ n: count() })
        .from(memberships)
        .innerJoin(user, eq(user.id, memberships.userId))
        .where(where);
      return row?.n ?? 0;
    },
    async (limit, offset) => {
      const rows = await database
        .select(memberFields)
        .from(memberships)
        .innerJoin(user, eq(user.id, memberships.userId))
        .where(where)
        .orderBy(asc(user.name), asc(memberships.id))
        .limit(limit)
        .offset(offset);
      return withRoles(database, rows);
    },
  );
}

async function withRoles<T extends { id: string }>(database: DbOrTx, rows: T[]) {
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

/**
 * Overrides are as strong as role changes, so they get the same guards: never on
 * yourself, only an owner may touch an owner, and the actor must hold everything
 * the change hands out or takes away.
 */
async function assertMayOverride(tx: DbOrTx, ctx: TenantContext, member: Member): Promise<void> {
  if (member.userId === ctx.user.id) throw new UserError(t("security.overrideSelf"));
  if (member.roles.some((r) => r.key === "owner")) {
    const owners = await ownerMembershipIds(tx, ctx.tenant.id);
    if (!owners.includes(ctx.membership.id)) throw new UserError(t("security.overrideOwnerOnly"));
  }
}

/**
 * The widest scope the member gets for a permission from their roles, or `fallback`.
 * Denying (or un-denying) a permission takes away (or gives back) all of it, so the
 * actor must hold it at least that widely.
 */
async function roleScopeOf(tx: DbOrTx, member: Member, permission: string, fallback: Scope): Promise<Scope> {
  const grants = await grantsOfRoles(
    tx,
    member.roles.map((r) => r.roleId),
  );
  return grants.filter((g) => g.permission === permission).reduce((s, g) => widerScope(s, g.scope), fallback);
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
    await assertMayOverride(tx, ctx, member);
    // Allow: the actor must hold what they hand out. Deny: what they take away (all of it).
    const scope =
      input.effect === "deny" ? await roleScopeOf(tx, member, input.permission, input.scope) : input.scope;
    assertCanGrantAll(ctx, [{ permission: input.permission, scope }]);
    // The override this replaces is undone, which must be within the actor's powers too.
    const replaced = await tx
      .delete(memberOverrides)
      .where(
        and(
          eq(memberOverrides.tenantId, ctx.tenant.id),
          eq(memberOverrides.membershipId, input.membershipId),
          eq(memberOverrides.permission, input.permission),
        ),
      )
      .returning();
    for (const old of replaced) {
      assertCanGrantAll(ctx, [
        { permission: old.permission, scope: await roleScopeOf(tx, member, old.permission, old.scope) },
      ]);
    }
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
      .select()
      .from(memberOverrides)
      .where(and(eq(memberOverrides.id, overrideId), eq(memberOverrides.tenantId, ctx.tenant.id)));
    if (!row) return;
    const member = await memberById(tx, ctx.tenant.id, row.membershipId);
    if (!member) throw new UserError(t("team.memberMissing"));
    await assertMayOverride(tx, ctx, member);
    // Removing an allow takes it away; removing a deny gives the role's grant back.
    assertCanGrantAll(ctx, [
      { permission: row.permission, scope: await roleScopeOf(tx, member, row.permission, row.scope) },
    ]);
    await tx.delete(memberOverrides).where(eq(memberOverrides.id, row.id));
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
