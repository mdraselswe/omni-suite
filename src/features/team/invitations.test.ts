// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));
// Email + password sign-up is a deployment switch; these tests exercise it.
vi.stubEnv("AUTH_EMAIL_PASSWORD", "true");

let database: Database;
let owner: TenantContext;

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx: owner } = await setupTenant(database, "inv"));
});

async function roleId(key: string): Promise<string> {
  const { listRoles } = await import("./service");
  const role = (await listRoles(database, owner.tenant.id)).find((r) => r.key === key);
  if (!role) throw new Error(`no role ${key}`);
  return role.id;
}

async function queuedMailTo(email: string) {
  const { jobs } = await import("@/server/db/schema");
  const rows = await database.select().from(jobs).where(eq(jobs.type, "mail.send"));
  return rows
    .map((r) => r.payload as { to?: string; subject?: string; text?: string })
    .filter((p) => p.to === email);
}

describe("invitation links", () => {
  it("knows open, expired, revoked and accepted invitations apart", async () => {
    const { invitationState } = await import("./service");
    const now = new Date("2026-01-10T00:00:00Z");
    const later = new Date("2026-01-20T00:00:00Z");
    const base = { acceptedAt: null, revokedAt: null, expiresAt: later };
    expect(invitationState(base, now)).toBe("open");
    expect(invitationState({ ...base, expiresAt: now }, now)).toBe("expired");
    expect(invitationState({ ...base, revokedAt: now }, now)).toBe("revoked");
    expect(invitationState({ ...base, acceptedAt: now, revokedAt: now }, now)).toBe("accepted");
  });

  it("emails a link with a mailbox proof the shared link doesn't have", async () => {
    const { createInvitation, inviteLink, inviteProof, isInviteProof } = await import("./service");
    const { token } = await createInvitation(database, owner, {
      email: "Proof@Example.com",
      kind: "internal",
      clientId: null,
      roleIds: [await roleId("staff")],
    });
    const [mail] = await queuedMailTo("proof@example.com");
    expect(mail?.text).toContain(`/invite/${token}?k=${inviteProof(token)}`);
    expect(mail?.subject).toContain("Biz inv");
    expect(inviteLink(token)).not.toContain("?k=");
    expect(isInviteProof(token, inviteProof(token))).toBe(true);
    expect(isInviteProof(token, "")).toBe(false);
    expect(isInviteProof(token, inviteProof(`${token}x`))).toBe(false);
    // One pending invitation per address: a second one is refused (resend instead).
    await expect(
      createInvitation(database, owner, {
        email: "proof@example.com",
        kind: "internal",
        clientId: null,
        roleIds: [await roleId("staff")],
      }),
    ).rejects.toThrow(/pending invitation/);
  });
});

describe("pending invitations", () => {
  it("revokes with an audit entry, and the link then says it was withdrawn", async () => {
    const { createUser } = await import("@/server/testing/db");
    const { auditLogs } = await import("@/server/db/schema");
    const { acceptInvitation, createInvitation, invitationByToken, pendingInvitations, revokeInvitation } =
      await import("./service");
    const { token } = await createInvitation(database, owner, {
      email: "gone@example.com",
      kind: "internal",
      clientId: null,
      roleIds: [await roleId("staff")],
    });
    const pending = (await pendingInvitations(database, owner.tenant.id)).find(
      (i) => i.email === "gone@example.com",
    );
    if (!pending) throw new Error("not listed");
    expect(pending.roleNames.length).toBe(1);
    expect(pending.inviterName).toBe("Owner inv");
    expect(pending.expired).toBe(false);

    await revokeInvitation(database, owner, pending.id);
    await expect(revokeInvitation(database, owner, pending.id)).rejects.toThrow();
    expect((await pendingInvitations(database, owner.tenant.id)).some((i) => i.id === pending.id)).toBe(
      false,
    );
    expect((await invitationByToken(database, token))?.invitation.revokedAt).not.toBeNull();
    const userId = await createUser(database, "Gone", "gone@example.com");
    await expect(acceptInvitation(database, token, { id: userId })).rejects.toThrow(/withdrew/);
    const logged = await database
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, owner.tenant.id), eq(auditLogs.action, "invitation.revoke")));
    expect(logged.length).toBe(1);
  });

  it("resends with a fresh link and expiry; the old link stops working", async () => {
    const { createUser } = await import("@/server/testing/db");
    const { invitations } = await import("@/server/db/schema");
    const { acceptInvitation, createInvitation, invitationByToken, pendingInvitations, resendInvitation } =
      await import("./service");
    const { token } = await createInvitation(database, owner, {
      email: "late@example.com",
      kind: "internal",
      clientId: null,
      roleIds: [await roleId("staff")],
    });
    // Let it expire.
    await database
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.token, token));
    const expired = (await pendingInvitations(database, owner.tenant.id)).find(
      (i) => i.email === "late@example.com",
    );
    if (!expired) throw new Error("not listed");
    expect(expired.expired).toBe(true);
    const userId = await createUser(database, "Late", "late@example.com");
    await expect(acceptInvitation(database, token, { id: userId })).rejects.toThrow(/expired/);

    const { token: fresh } = await resendInvitation(database, owner, expired.id);
    expect(fresh).not.toBe(token);
    expect(await invitationByToken(database, token)).toBeNull();
    const after = (await pendingInvitations(database, owner.tenant.id)).find((i) => i.id === expired.id);
    expect(after?.expired).toBe(false);
    expect(after?.lastSentAt).not.toBeNull();
    expect((await queuedMailTo("late@example.com")).length).toBe(2);
    expect(await acceptInvitation(database, fresh, { id: userId })).toEqual({
      slug: "inv",
      kind: "internal",
    });
    await expect(resendInvitation(database, owner, expired.id)).rejects.toThrow();
  });

  it("lists a client's portal invitations only on that client", async () => {
    const { createClient } = await import("@/features/clients");
    const { createInvitation, pendingInvitations } = await import("./service");
    const base = { email: "", phone: "", website: "", address: "", notes: "", status: "active" as const };
    const a = await createClient(database, owner, { ...base, name: "A", custom: {} });
    const b = await createClient(database, owner, { ...base, name: "B", custom: {} });
    await createInvitation(database, owner, {
      email: "client-a@example.com",
      kind: "client",
      clientId: a,
      roleIds: [await roleId("client_owner")],
    });
    expect(
      (await pendingInvitations(database, owner.tenant.id, { clientId: a })).map((i) => i.email),
    ).toEqual(["client-a@example.com"]);
    expect(await pendingInvitations(database, owner.tenant.id, { clientId: b })).toEqual([]);
  });
});

describe("home routing data", () => {
  it("finds the invitations waiting for an address, and switched-off access", async () => {
    const { addMember } = await import("@/server/testing/db");
    const { createInvitation, disabledAccess, invitationsForEmail, updateMember } = await import("./service");
    const { token } = await createInvitation(database, owner, {
      email: "waiting@example.com",
      kind: "internal",
      clientId: null,
      roleIds: [await roleId("staff")],
    });
    expect(await invitationsForEmail(database, "Waiting@Example.com")).toEqual([
      { token, kind: "internal", business: "Biz inv", expired: false },
    ]);
    const { membershipId, userId } = await addMember(database, "inv", "staff", "Sam Switched");
    await updateMember(database, owner, membershipId, { title: "", status: "disabled" });
    expect(await disabledAccess(database, userId)).toEqual(["Biz inv"]);
  });
});

describe("signing up from an invitation", () => {
  it("creates a verified account and joins in one step from the emailed link", async () => {
    const { user } = await import("@/server/db/schema");
    const { createInvitation } = await import("./service");
    const { signUpForInvitation } = await import("./invite-signup");
    const { token } = await createInvitation(database, owner, {
      email: "fresh@example.com",
      kind: "internal",
      clientId: null,
      roleIds: [await roleId("staff")],
    });
    const result = await signUpForInvitation(database, token, {
      name: "Fresh Person",
      password: "a-long-enough-password",
      emailProven: true,
    });
    expect(result).toEqual({ status: "joined", email: "fresh@example.com", slug: "inv", kind: "internal" });
    const [account] = await database.select().from(user).where(eq(user.email, "fresh@example.com"));
    expect(account?.emailVerified).toBe(true);
    // Single use: the link can't create or join again.
    await expect(
      signUpForInvitation(database, token, {
        name: "X",
        password: "a-long-enough-password",
        emailProven: true,
      }),
    ).rejects.toThrow(/already been accepted/);
  });

  it("never takes over an existing account, and needs email confirmation from a shared link", async () => {
    const { createUser } = await import("@/server/testing/db");
    const { user } = await import("@/server/db/schema");
    const { createInvitation, invitationByToken } = await import("./service");
    const { signUpForInvitation } = await import("./invite-signup");
    await createUser(database, "Taken", "taken@example.com");
    const { token: taken } = await createInvitation(database, owner, {
      email: "taken@example.com",
      kind: "internal",
      clientId: null,
      roleIds: [await roleId("staff")],
    });
    await expect(
      signUpForInvitation(database, taken, {
        name: "Evil",
        password: "a-long-enough-password",
        emailProven: true,
      }),
    ).rejects.toThrow(/already exists/);

    const { token: shared } = await createInvitation(database, owner, {
      email: "shared@example.com",
      kind: "internal",
      clientId: null,
      roleIds: [await roleId("staff")],
    });
    const result = await signUpForInvitation(database, shared, {
      name: "Shared",
      password: "a-long-enough-password",
      emailProven: false,
    });
    expect(result).toEqual({ status: "confirmEmail", email: "shared@example.com" });
    const [account] = await database.select().from(user).where(eq(user.email, "shared@example.com"));
    expect(account?.emailVerified).toBe(false);
    // Still open: accepted only after the address is confirmed and they sign in.
    expect((await invitationByToken(database, shared))?.invitation.acceptedAt).toBeNull();
  });
});
