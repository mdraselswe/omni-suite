import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/config/env";

function key(): Buffer {
  const k = Buffer.from(serverEnv().ENCRYPTION_KEY, "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return k;
}

/** Marks ciphertext bound to a context (additional authenticated data). */
const BOUND = "v2";

/**
 * AES-256-GCM. Output: base64url(iv).base64url(tag).base64url(ciphertext).
 * With `context` (use the tenant id for tenant secrets) the value is bound to it
 * as additional authenticated data: a row copied to another business won't decrypt.
 * Bound output carries a "v2." prefix.
 */
export function encrypt(plain: string, context?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  if (context !== undefined) cipher.setAAD(Buffer.from(context, "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const body = [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
  return context === undefined ? body : `${BOUND}.${body}`;
}

/**
 * Decrypts a value from `encrypt`. A context-bound value needs the same context.
 * Older values written without a context still decrypt (so stored tokens keep
 * working); re-encrypt them with a context when they are next saved.
 */
export function decrypt(value: string, context?: string): string {
  const parts = value.split(".");
  const bound = parts[0] === BOUND;
  if (bound && context === undefined) throw new Error("Bad ciphertext");
  const [iv, tag, data] = (bound ? parts.slice(1) : parts).map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !data) throw new Error("Bad ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  if (bound && context !== undefined) decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** True when the value was written without a context (re-encrypt it with one). */
export function isUnbound(value: string): boolean {
  return !value.startsWith(`${BOUND}.`);
}

/** A separate HMAC key per purpose, so a value signed for one flow is useless in another. */
function macKey(purpose: string): Buffer {
  return createHmac("sha256", serverEnv().BETTER_AUTH_SECRET).update(`omnisuite-signed:${purpose}`).digest();
}

/** Signed, expiring value for one purpose (e.g. an OAuth state parameter). */
export function sign(purpose: string, payload: object, ttlSeconds = 600): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString(
    "base64url",
  );
  const mac = createHmac("sha256", macKey(purpose)).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** The payload of a value signed for this purpose, or null (forged, other purpose, expired, malformed). */
export function verifySigned(purpose: string, value: string): Record<string, unknown> | null {
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", macKey(purpose)).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  return typeof record.exp === "number" && record.exp > Date.now() ? record : null;
}

/** Constant-time string comparison (secrets, nonces). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
