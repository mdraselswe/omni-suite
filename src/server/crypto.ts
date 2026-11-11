import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/config/env";

function key(): Buffer {
  const k = Buffer.from(serverEnv().ENCRYPTION_KEY, "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return k;
}

/** AES-256-GCM. Output: base64url(iv).base64url(tag).base64url(ciphertext). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(value: string): string {
  const [iv, tag, data] = value.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !data) throw new Error("Bad ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Signed, expiring value for OAuth state parameters. */
export function sign(payload: object, ttlSeconds = 600): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString(
    "base64url",
  );
  const mac = createHmac("sha256", serverEnv().BETTER_AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySigned<T>(value: string): T | null {
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", serverEnv().BETTER_AUTH_SECRET).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
  return parsed.exp > Date.now() ? parsed : null;
}
