import { createHash, randomBytes } from "node:crypto";

/**
 * Ties a custom-domain sign-in handoff to the browser that started it (no login
 * CSRF: a token minted for someone else's browser can't be finished in yours).
 *
 * The custom domain's /login sets a random nonce in an httpOnly cookie on that
 * domain and sends only its hash to the app host, which stores the hash in the
 * one-time token. /api/handoff/finish accepts the token only together with the
 * matching cookie. No "server-only" import: the proxy uses this too.
 */

export const HANDOFF_COOKIE = "omnisuite.handoff";
/** The cookie only travels to the finish endpoint. */
export const HANDOFF_COOKIE_PATH = "/api/handoff/finish";
export const HANDOFF_COOKIE_MAX_AGE = 600;

const BROWSER_HASH = /^[A-Za-z0-9_-]{43}$/;

export function newBrowserNonce(): string {
  return randomBytes(32).toString("base64url");
}

/** What the app host sees and stores: the nonce's SHA-256 (base64url). */
export function browserHash(nonce: string): string {
  return createHash("sha256").update(nonce).digest("base64url");
}

/** A well-formed browser hash from a query string or form, else "". */
export function cleanBrowserHash(value: unknown): string {
  return typeof value === "string" && BROWSER_HASH.test(value) ? value : "";
}
