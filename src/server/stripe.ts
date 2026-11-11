import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { billing } from "@/config";

/**
 * Minimal Stripe client over fetch (no SDK), like src/server/google.ts.
 * Every request pins `billing.stripeApiVersion` so responses have one known shape.
 */

type Params = { [key: string]: string | number | boolean | null | undefined | Params | Params[] };

/** Stripe's form encoding: nested objects and arrays become `a[b][0][c]=…`. Empty values are left out. */
export function encodeForm(params: Params, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      value.forEach((item, i) => out.push(...encodeForm(item, `${name}[${i}]`)));
    } else if (typeof value === "object") {
      out.push(...encodeForm(value, name));
    } else {
      out.push([name, String(value)]);
    }
  }
  return out;
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

export async function stripeRequest<T>(
  secretKey: string,
  method: "GET" | "POST",
  path: string,
  params: Params = {},
  idempotencyKey?: string,
): Promise<T> {
  const query = new URLSearchParams(encodeForm(params)).toString();
  const url = `https://api.stripe.com/v1/${path}${method === "GET" && query ? `?${query}` : ""}`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${secretKey}`,
    "stripe-version": billing.stripeApiVersion,
  };
  if (method === "POST") headers["content-type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? query : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as { error?: { message?: string; code?: string } };
  if (!res.ok) {
    throw new StripeError(json.error?.message ?? `Stripe ${res.status}`, res.status, json.error?.code ?? "");
  }
  return json as T;
}

/** The parts of a Stripe event the app reads. */
export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

const TOLERANCE_SECONDS = 300;

/**
 * Checks the `Stripe-Signature` header: HMAC-SHA256 of `${t}.${body}` with the endpoint
 * secret, any matching `v1` entry, timestamp within 5 minutes. Returns the event or null.
 */
export function verifyWebhook(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): StripeEvent | null {
  if (!header || !secret) return null;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }
  const t = Number(timestamp);
  if (!Number.isInteger(t) || signatures.length === 0) return null;
  if (Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) return null;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const valid = signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!valid) return null;
  try {
    const event = JSON.parse(rawBody) as StripeEvent;
    return typeof event.id === "string" && typeof event.type === "string" && event.data ? event : null;
  } catch {
    return null;
  }
}

/** "test" or "live" from a secret or restricted key, or null if it isn't one. */
export function keyMode(key: string): "test" | "live" | null {
  const m = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.exec(key.trim());
  return m?.[1] === "test" || m?.[1] === "live" ? m[1] : null;
}

/** Stripe's smallest unit matches ours for 0- and 2-decimal currencies; others aren't offered. */
export function stripeSupportsDigits(digits: number): boolean {
  return digits === 0 || digits === 2;
}

/** Reads a string field from an untyped Stripe object. */
export function str(obj: Record<string, unknown> | undefined, key: string): string {
  const v = obj?.[key];
  return typeof v === "string" ? v : "";
}
