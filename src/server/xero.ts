import "server-only";
import { serverEnv } from "@/config/env";

/**
 * Minimal Xero client over fetch (no SDK). OAuth 2.0 authorization code flow;
 * granular accounting scopes (required for Xero apps created after 2 March 2026).
 * Access tokens last 30 minutes; refresh tokens are single-use and rotate.
 */
export const XERO_SCOPES = [
  "offline_access",
  "accounting.contacts",
  "accounting.invoices",
  "accounting.payments",
].join(" ");

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const REVOKE_URL = "https://identity.xero.com/connect/revocation";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const API_BASE = "https://api.xero.com/api.xro/2.0";

/** The grant was revoked or expired (60 days unused): the business must reconnect. */
export class XeroAuthError extends Error {}

export function xeroConfigured(): boolean {
  const env = serverEnv();
  return env.XERO_CLIENT_ID !== "" && env.XERO_CLIENT_SECRET !== "";
}

export function xeroRedirectUri(): string {
  return `${serverEnv().APP_URL}/api/xero/callback`;
}

export function xeroAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: serverEnv().XERO_CLIENT_ID,
    redirect_uri: xeroRedirectUri(),
    scope: XERO_SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuth(): string {
  const env = serverEnv();
  return `Basic ${Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64")}`;
}

export type XeroTokens = { accessToken: string; refreshToken: string; expiresIn: number };

async function tokenRequest(body: Record<string, string>): Promise<XeroTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = String(json.error ?? res.status);
    if (code === "invalid_grant") throw new XeroAuthError("Xero grant expired or revoked");
    throw new Error(`Xero token error: ${code}`);
  }
  const accessToken = typeof json.access_token === "string" ? json.access_token : "";
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : "";
  if (!accessToken || !refreshToken) throw new Error("Xero did not return tokens");
  return { accessToken, refreshToken, expiresIn: Number(json.expires_in ?? 1800) };
}

export function exchangeCode(code: string): Promise<XeroTokens> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: xeroRedirectUri() });
}

export function refreshTokens(refreshToken: string): Promise<XeroTokens> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Best effort: revokes the refresh token (and the connection it grants) at Xero. */
export async function revokeToken(refreshToken: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });
  } catch (error) {
    console.error("[xero] revoke failed", error);
  }
}

export type XeroOrg = { tenantId: string; tenantName: string; tenantType: string };

/** Organisations this grant can reach. */
export async function listConnections(accessToken: string): Promise<XeroOrg[]> {
  const res = await fetch(CONNECTIONS_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Xero connections ${res.status}`);
  const rows = (await res.json()) as { tenantId?: string; tenantName?: string; tenantType?: string }[];
  return rows
    .filter((r) => typeof r.tenantId === "string")
    .map((r) => ({
      tenantId: r.tenantId ?? "",
      tenantName: r.tenantName ?? "",
      tenantType: r.tenantType ?? "",
    }));
}

const MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One Accounting API call. On 429 it waits for Retry-After (Xero: 60 calls/minute
 * and 5,000/day per organisation) and tries again a few times.
 */
export async function xeroApi<T>(
  accessToken: string,
  xeroTenantId: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "xero-tenant-id": xeroTenantId,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const wait = Number(res.headers.get("retry-after") ?? "5");
      await sleep(Math.min(Number.isFinite(wait) ? wait : 5, 60) * 1000);
      continue;
    }
    if (res.status === 401) throw new XeroAuthError("Xero rejected the access token");
    if (!res.ok) throw new Error(`Xero API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }
}
