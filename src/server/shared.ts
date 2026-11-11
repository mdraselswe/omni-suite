import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { CustomFieldDef } from "@/lib/custom-fields";
import type { DbOrTx } from "@/server/db";
import {
  customFieldDefs,
  memberRoles,
  memberships,
  notifications,
  rolePermissions,
  tenantCounters,
  user,
} from "@/server/db/schema";
import { sendMail } from "@/server/mail";

/** Next value of a per-tenant counter (invoice and proposal numbers). Safe under concurrency. */
export async function nextCounter(tx: DbOrTx, tenantId: string, key: string): Promise<number> {
  const [row] = await tx
    .insert(tenantCounters)
    .values({ tenantId, key, value: 1 })
    .onConflictDoUpdate({
      target: [tenantCounters.tenantId, tenantCounters.key],
      set: { value: sql`${tenantCounters.value} + 1` },
    })
    .returning({ value: tenantCounters.value });
  if (!row) throw new Error("Counter failed");
  return row.value;
}

/** In-app notifications (and optionally an email) for a list of users. */
export async function notify(
  tx: DbOrTx,
  tenantId: string,
  userIds: readonly string[],
  message: { title: string; body?: string; link?: string; email?: boolean },
): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  await tx.insert(notifications).values(
    ids.map((userId) => ({
      tenantId,
      userId,
      title: message.title,
      body: message.body ?? "",
      link: message.link ?? null,
    })),
  );
  if (message.email) {
    const recipients = await tx.select({ email: user.email }).from(user).where(inArray(user.id, ids));
    // Fire and forget: mail never blocks the action.
    for (const r of recipients) {
      void sendMail({
        to: r.email,
        subject: message.title,
        text: `${message.body ?? ""}\n\n${message.link ?? ""}`.trim(),
      });
    }
  }
}

export async function listNotifications(database: DbOrTx, tenantId: string, userId: string, limit = 20) {
  return database
    .select()
    .from(notifications)
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId)))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function unreadCount(database: DbOrTx, tenantId: string, userId: string): Promise<number> {
  const [row] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function markAllRead(database: DbOrTx, tenantId: string, userId: string): Promise<void> {
  await database
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    );
}

/** User ids of active members holding a permission through a role (for notifications). */
export async function usersWithPermission(
  database: DbOrTx,
  tenantId: string,
  permission: string,
): Promise<string[]> {
  const rows = await database
    .selectDistinct({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(memberRoles, eq(memberRoles.membershipId, memberships.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, memberRoles.roleId))
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.status, "active"),
        eq(rolePermissions.permission, permission),
      ),
    );
  return rows.map((r) => r.userId);
}

/** User ids of a client's portal users. */
export async function clientUserIds(database: DbOrTx, tenantId: string, clientId: string): Promise<string[]> {
  const rows = await database
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.kind, "client"),
        eq(memberships.clientId, clientId),
        eq(memberships.status, "active"),
      ),
    );
  return rows.map((r) => r.userId);
}

export async function customFieldsFor(
  database: DbOrTx,
  tenantId: string,
  entity: "client" | "lead" | "project" | "invoice",
): Promise<(CustomFieldDef & { id: string })[]> {
  return database
    .select({
      id: customFieldDefs.id,
      key: customFieldDefs.key,
      label: customFieldDefs.label,
      type: customFieldDefs.type,
      options: customFieldDefs.options,
      required: customFieldDefs.required,
    })
    .from(customFieldDefs)
    .where(and(eq(customFieldDefs.tenantId, tenantId), eq(customFieldDefs.entity, entity)))
    .orderBy(asc(customFieldDefs.position), asc(customFieldDefs.createdAt));
}
