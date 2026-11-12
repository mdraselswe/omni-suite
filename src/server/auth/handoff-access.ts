import { createHash } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import { randomToken, uuidv7 } from "@/lib/ids";
import type { DbOrTx } from "@/server/db";
import { memberships, session, tenants, verification } from "@/server/db/schema";
import { browserHash } from "./handoff-browser";

/**
 * Custom-domain sign-in handoff (ADR 0004), database side.
 *
 * 1. The custom domain's /login gives the browser a nonce cookie and sends its hash
 *    to the app host (see handoff-browser.ts).
 * 2. The app host mints a single-use token for a signed-in user, but only for a
 *    verified domain of a business the user is an active member of, and only for
 *    that browser (the hash is stored in the token).
 * 3. The custom domain redeems it (server-side only, with the nonce cookie) for a
 *    NEW session bound to that one business (session.bound_tenant_id): it can't
 *    open other businesses, the platform admin or account-wide auth endpoints,
 *    even if the domain owner captures it.
 *
 * Tokens live in Better Auth's `verification` table; the binding lives on the session row.
 */

const TOKEN_PREFIX = "handoff:";
/** Bindings used to be kept in `verification` rows with this prefix (before bound_tenant_id). */
const LEGACY_BINDING_PREFIX = "session-tenant:";
const TOKEN_TTL_MS = 60_000;

const grantSchema = z.object({
  userId: z.string().min(1),
  host: z.string().min(1),
  slug: z.string().min(1),
  /** SHA-256 of the starting browser's nonce cookie. */
  browser: z.string().min(1),
});
export type HandoffGrant = z.infer<typeof grantSchema>;
/** A redeemed grant plus the business id the new session is bound to. */
export type RedeemedGrant = HandoffGrant & { tenantId: string };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Is the user an active member of the active business with this slug? */
export async function isActiveMember(database: DbOrTx, userId: string, slug: string): Promise<boolean> {
  return (await memberBusiness(database, userId, slug)) !== null;
}

/** The active business with this slug when the user is an active member of it, else null. */
export async function memberBusiness(
  database: DbOrTx,
  userId: string,
  slug: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await database
    .select({ id: tenants.id, name: tenants.name })
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
  return rows[0] ?? null;
}

/** Name of the business with this slug when the user is an active member of it (and it is active), else null. */
export async function memberBusinessName(
  database: DbOrTx,
  userId: string,
  slug: string,
): Promise<string | null> {
  return (await memberBusiness(database, userId, slug))?.name ?? null;
}

/** Mints a one-minute, single-use token. Returns null when the user isn't a member of that business. */
export async function createHandoffToken(database: DbOrTx, grant: HandoffGrant): Promise<string | null> {
  if (!grant.browser || !(await isActiveMember(database, grant.userId, grant.slug))) return null;
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
 * host it was minted for, in the browser that started the handoff (its nonce
 * cookie), before it expires, while the user is still a member.
 */
export async function redeemHandoffToken(
  database: DbOrTx,
  token: string,
  host: string,
  browserNonce: string,
): Promise<RedeemedGrant | null> {
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
  if (!browserNonce || browserHash(browserNonce) !== grant.data.browser) return null;
  const business = await memberBusiness(database, grant.data.userId, grant.data.slug);
  if (!business) return null;
  return { ...grant.data, tenantId: business.id };
}

/** The business a session is bound to (tenants.id), or null for a normal (app host) session. */
export function boundTenantIdOf(current: object): string | null {
  const value: unknown = Reflect.get(current, "boundTenantId");
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * One-off upgrade: sessions bound the old way (a `verification` row that could be
 * purged) are signed out, so no handoff session can outlive its binding. Users
 * simply sign in on the custom domain again. Safe to run on every boot.
 */
export async function revokeLegacyBoundSessions(database: DbOrTx): Promise<number> {
  const rows = await database
    .select({ id: verification.id, identifier: verification.identifier })
    .from(verification)
    .where(like(verification.identifier, `${LEGACY_BINDING_PREFIX}%`));
  if (rows.length === 0) return 0;
  const sessionIds = rows.map((r) => r.identifier.slice(LEGACY_BINDING_PREFIX.length));
  await database.delete(session).where(inArray(session.id, sessionIds));
  await database.delete(verification).where(
    inArray(
      verification.id,
      rows.map((r) => r.id),
    ),
  );
  return rows.length;
}
