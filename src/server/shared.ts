import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { limits } from "@/config";
import type { CustomFieldDef } from "@/lib/custom-fields";
import type { DbOrTx } from "@/server/db";
import {
  customFieldDefs,
  memberOverrides,
  memberRoles,
  memberships,
  notifications,
  rolePermissions,
  tenantCounters,
  tenants,
  user,
} from "@/server/db/schema";
import { parseTenantSettings } from "@/lib/tenant-settings";
import { t } from "@/i18n";
import { UserError } from "@/server/action";
import { enqueue } from "@/server/jobs/queue";
import { appUrl, type MailMessage } from "@/server/mail";
import { takeBusinessMail, takeRecipientMail } from "@/server/mail-quota";

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

/** App-relative links ("/acme/invoices/…") as absolute URLs: whole-line paths in text, href="/…" in HTML. */
export function absoluteLinks(mail: MailMessage): MailMessage {
  const html = mail.html?.replace(
    /(href=["'])(\/(?!\/)[^"']*)/g,
    (_match, attr: string, path: string) => attr + appUrl(path),
  );
  return {
    ...mail,
    text: mail.text.replace(/^\/(?!\/)\S*$/gm, (path) => appUrl(path)),
    ...(html === undefined ? {} : { html }),
  };
}

/** Job type that delivers one queued email (handler in src/server/jobs/handlers.ts). */
export const MAIL_JOB = "mail.send";

/**
 * Queues an email as a job in the same transaction: it is sent only if the
 * transaction commits, and retried if SMTP fails or the server restarts.
 * App-relative links ("/acme/…" on their own line, or href="/…") become absolute URLs.
 *
 * Mail a business triggers must pass its `tenantId`: it counts against the business's
 * hourly and daily quota (src/config/limits.ts). Over the quota it throws a UserError
 * (the transaction rolls back), or with `onLimit: "skip"` returns false and sends nothing.
 * Mail without a business is throttled per recipient instead.
 */
export async function queueMail(
  tx: DbOrTx,
  mail: { to: string; subject: string; text: string; html?: string },
  options: { tenantId?: string; onLimit?: "throw" | "skip" } = {},
): Promise<boolean> {
  const onLimit = options.onLimit ?? "throw";
  if (options.tenantId) {
    if (!(await takeBusinessMail(tx, options.tenantId, onLimit))) return false;
  } else if (!(await takeRecipientMail(tx, mail.to))) {
    if (onLimit === "skip") return false;
    throw new UserError(t("security.mailLimitHour", { limit: limits.mail.perRecipientPerHour }));
  }
  const payload: MailMessage = absoluteLinks(mail);
  if (options.tenantId) {
    // Business mail: sent under the business's name, replies go to its own address.
    const [row] = await tx
      .select({ name: tenants.name, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, options.tenantId));
    if (row) {
      const settings = parseTenantSettings(row.settings);
      payload.fromName = (settings.branding.displayName || row.name).slice(0, 80);
      if (settings.replyToEmail) payload.replyTo = settings.replyToEmail;
    }
  }
  await enqueue(tx, { type: MAIL_JOB, tenantId: options.tenantId ?? null, payload });
  return true;
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
    const link = message.link?.startsWith("/") ? appUrl(message.link) : (message.link ?? "");
    for (const r of recipients) {
      // Over the business's mail quota the in-app notification still arrives; the email is skipped.
      await queueMail(
        tx,
        {
          to: r.email,
          subject: message.title,
          text: `${message.body ?? ""}

${link}`.trim(),
        },
        { tenantId, onLimit: "skip" },
      );
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

/**
 * User ids of a client's active portal users. With `permission`, only those who
 * hold it and can open the portal at all (`portal.access`): a role grant or an
 * allow override, and no deny override. So nobody is emailed a link they can't open.
 */
export async function clientUserIds(
  database: DbOrTx,
  tenantId: string,
  clientId: string,
  permission?: string,
): Promise<string[]> {
  const live = sql`(${memberOverrides.expiresAt} is null or ${memberOverrides.expiresAt} > now())`;
  const holds = (p: string) => sql`(
        (exists (select 1 from ${memberRoles}
          inner join ${rolePermissions} on ${rolePermissions.roleId} = ${memberRoles.roleId}
          where ${memberRoles.membershipId} = ${memberships.id} and ${rolePermissions.permission} = ${p})
        or exists (select 1 from ${memberOverrides}
          where ${memberOverrides.membershipId} = ${memberships.id} and ${memberOverrides.permission} = ${p}
          and ${memberOverrides.effect} = 'allow' and ${live}))
        and not exists (select 1 from ${memberOverrides}
          where ${memberOverrides.membershipId} = ${memberships.id} and ${memberOverrides.permission} = ${p}
          and ${memberOverrides.effect} = 'deny' and ${live})
      )`;
  const rows = await database
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.kind, "client"),
        eq(memberships.clientId, clientId),
        eq(memberships.status, "active"),
        permission ? and(holds("portal.access"), holds(permission)) : undefined,
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
