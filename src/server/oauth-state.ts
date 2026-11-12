import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { serverEnv } from "@/config/env";
import { randomToken, uuidv7 } from "@/lib/ids";
import { safeEqual, sign, verifySigned } from "@/server/crypto";
import type { DbOrTx } from "@/server/db";
import { verification } from "@/server/db/schema";

/**
 * OAuth "connect" flows (Google Drive backup, Xero). The `state` parameter is
 * - signed with a key for this provider only (a Google state is useless for Xero),
 * - tied to the browser that started it: it carries a nonce that must match an
 *   httpOnly cookie set on the connect response (no login-CSRF style account swap),
 * - single use: the nonce is stored server-side and deleted when the callback runs.
 * Callbacks must still re-check the user's permission in the business.
 */

export type OAuthPurpose = "google-backup" | "xero";

export const OAUTH_STATE_TTL_SECONDS = 600;
const NONCE_PREFIX = "oauth-nonce:";

const payloadSchema = z.object({
  purpose: z.string(),
  nonce: z.string().min(16),
  tenantId: z.uuid(),
  slug: z.string().min(1),
  userId: z.string().min(1),
});
export type OAuthState = Omit<z.infer<typeof payloadSchema>, "nonce" | "purpose">;

/** Cookie holding the nonce; scoped to the provider's callback path. */
export function oauthCookie(purpose: OAuthPurpose): { name: string; path: string } {
  const callback = purpose === "xero" ? "/api/xero/callback" : "/api/google/callback";
  return { name: `omnisuite.oauth.${purpose}`, path: callback };
}

function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("base64url");
}

export type CookieToSet = {
  name: string;
  value: string;
  options: { httpOnly: true; secure: boolean; sameSite: "lax"; path: string; maxAge: number };
};

function cookieOptions(purpose: OAuthPurpose, maxAge: number): CookieToSet["options"] {
  return {
    httpOnly: true,
    secure: serverEnv().APP_URL.startsWith("https://"),
    // Lax: the provider redirects back with a top-level GET, which still carries it.
    sameSite: "lax",
    path: oauthCookie(purpose).path,
    maxAge,
  };
}

/** Starts a flow: returns the state for the provider URL and the cookie to set on the redirect. */
export async function startOAuth(
  database: DbOrTx,
  purpose: OAuthPurpose,
  state: OAuthState,
): Promise<{ state: string; cookie: CookieToSet }> {
  const nonce = randomToken(24);
  const now = new Date();
  await database.insert(verification).values({
    id: uuidv7(),
    identifier: `${NONCE_PREFIX}${purpose}:${hashNonce(nonce)}`,
    value: state.userId,
    expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_SECONDS * 1000),
    createdAt: now,
    updatedAt: now,
  });
  return {
    state: sign(`oauth:${purpose}`, { ...state, purpose, nonce }, OAUTH_STATE_TTL_SECONDS),
    cookie: {
      name: oauthCookie(purpose).name,
      value: nonce,
      options: cookieOptions(purpose, OAUTH_STATE_TTL_SECONDS),
    },
  };
}

/** The cookie that clears the nonce (set it on every callback response). */
export function clearOAuthCookie(purpose: OAuthPurpose): CookieToSet {
  return { name: oauthCookie(purpose).name, value: "", options: cookieOptions(purpose, 0) };
}

/**
 * Checks a callback's state: right provider, not expired, nonce matches this
 * browser's cookie and hasn't been used. Consumes the nonce. Null when invalid.
 */
export async function finishOAuth(
  database: DbOrTx,
  purpose: OAuthPurpose,
  stateParam: string,
  cookieNonce: string | undefined,
): Promise<OAuthState | null> {
  const parsed = payloadSchema.safeParse(verifySigned(`oauth:${purpose}`, stateParam));
  if (!parsed.success || parsed.data.purpose !== purpose) return null;
  if (!cookieNonce || !safeEqual(cookieNonce, parsed.data.nonce)) return null;
  const [row] = await database
    .delete(verification)
    .where(eq(verification.identifier, `${NONCE_PREFIX}${purpose}:${hashNonce(parsed.data.nonce)}`))
    .returning();
  if (!row || row.expiresAt <= new Date() || row.value !== parsed.data.userId) return null;
  const { tenantId, slug, userId } = parsed.data;
  return { tenantId, slug, userId };
}
