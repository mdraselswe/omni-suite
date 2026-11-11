import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { randomToken, uuidv7 } from "@/lib/ids";
import type { DbOrTx } from "@/server/db";
import { memberships, tenants, verification } from "@/server/db/schema";

/**
 * Custom-domain sign-in handoff (ADR 0004), database side.
 *
 * 1. The app host mints a single-use token for a signed-in user, but only for a
 *    verified domain of a business the user is an active member of.
 * 2. The custom domain redeems it (server-side only) for a NEW session that is
 *    bound to that one business: it can't open other businesses, the platform
 *    admin or account-wide auth endpoints, even if the domain owner captures it.
 *
 * Tokens and bindings live in Better Auth's `verification` table (no extra schema).
 */

const TOKEN_PREFIX = "handoff:";
const BINDING_PREFIX = "session-tenant:";
const TOKEN_TTL_MS = 60_000;
/** Bindings outlive their session by this much and are pushed forward as the session is refreshed. */
const BINDING_SLACK_MS = 60 * 86_400_000;

const grantSchema = z.object({ userId: z.string().min(1), host: z.string().min(1), slug: z.string().min(1) });
export type HandoffGrant = z.infer<typeof grantSchema>;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Is the user an active member of the active business with this slug? */
export async function isActiveMember(database: DbOrTx, userId: string, slug: string): Promise<boolean> {
  return (await memberBusinessName(database, userId, slug)) !== null;
}

/** Name of the business with this slug when the user is an active member of it (and it is active), else null. */
export async function memberBusinessName(
  database: DbOrTx,
  userId: string,
  slug: string,
): Promise<string | null> {
  const rows = await database
    .select({ name: tenants.name })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(
      and(
        eq(tenants.slug, slug),
        eq(tenants.status, "active"),
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
      ),
    )
    .limit(1);
  return rows[0]?.name ?? null;
}

/** Mints a one-minute, single-use token. Returns null when the user isn't a member of that business. */
export async function createHandoffToken(database: DbOrTx, grant: HandoffGrant): Promise<string | null> {
  if (!(await isActiveMember(database, grant.userId, grant.slug))) return null;
  const token = randomToken(32);
  const now = new Date();
  await database.insert(verification).values({
    id: uuidv7(),
    identifier: `${TOKEN_PREFIX}${hashToken(token)}`,
    value: JSON.stringify(grant),
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
    createdAt: now,
    updatedAt: now,
  });
  return token;
}

/**
 * Consumes a token (atomically: a second use finds nothing). Valid only on the
 * host it was minted for, before it expires, while the user is still a member.
 */
export async function redeemHandoffToken(
  database: DbOrTx,
  token: string,
  host: string,
): Promise<HandoffGrant | null> {
  if (!token) return null;
  const [row] = await database
    .delete(verification)
    .where(eq(verification.identifier, `${TOKEN_PREFIX}${hashToken(token)}`))
    .returning();
  if (!row || row.expiresAt <= new Date()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return null;
  }
  const grant = grantSchema.safeParse(parsed);
  if (!grant.success || grant.data.host !== host) return null;
  if (!(await isActiveMember(database, grant.data.userId, grant.data.slug))) return null;
  return grant.data;
}

/** Marks a session as usable only inside one business. */
export async function bindSessionToTenant(
  database: DbOrTx,
  sessionId: string,
  slug: string,
  sessionExpiresAt: Date,
): Promise<void> {
  const now = new Date();
  await database.insert(verification).values({
    id: uuidv7(),
    identifier: `${BINDING_PREFIX}${sessionId}`,
    value: slug,
    expiresAt: new Date(sessionExpiresAt.getTime() + BINDING_SLACK_MS),
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * The business a session is bound to, or null for a normal (app host) session.
 * Keeps the binding alive for as long as the session itself can live. Any row,
 * even one past its expiry, counts as bound: this fails closed.
 */
export async function boundTenantOf(
  database: DbOrTx,
  session: { id: string; expiresAt: Date },
): Promise<string | null> {
  const identifier = `${BINDING_PREFIX}${session.id}`;
  const [row] = await database
    .select({ id: verification.id, value: verification.value, expiresAt: verification.expiresAt })
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() - session.expiresAt.getTime() < BINDING_SLACK_MS / 2) {
    await database
      .update(verification)
      .set({ expiresAt: new Date(session.expiresAt.getTime() + BINDING_SLACK_MS), updatedAt: new Date() })
      .where(eq(verification.id, row.id));
  }
  return row.value;
}
