import "server-only";
import { serverEnv } from "@/config/env";

/**
 * Minimal Google Drive + Sheets client over fetch (no googleapis dependency).
 * Scope: drive.file — the app only sees files it created itself.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export function googleConfigured(): boolean {
  const env = serverEnv();
  return env.GOOGLE_CLIENT_ID !== "" && env.GOOGLE_CLIENT_SECRET !== "";
}

export function driveRedirectUri(): string {
  return `${serverEnv().APP_URL}/api/google/callback`;
}

export function driveAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: serverEnv().GOOGLE_CLIENT_ID,
    redirect_uri: driveRedirectUri(),
    response_type: "code",
    scope: `${DRIVE_SCOPE} openid email`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function tokenRequest(body: Record<string, string>) {
  const env = serverEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      ...body,
    }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok)
    throw new Error(`Google token error: ${String(json.error_description ?? json.error ?? res.status)}`);
  return json;
}

export async function exchangeCode(code: string): Promise<{ refreshToken: string; email: string }> {
  const json = await tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: driveRedirectUri(),
  });
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : "";
  if (!refreshToken) throw new Error("Google did not return a refresh token");
  let email = "";
  if (typeof json.id_token === "string") {
    // The ID token came straight from Google over TLS; we only read the email for display.
    const payload = json.id_token.split(".")[1] ?? "";
    email = String(
      (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string }).email ?? "",
    );
  }
  return { refreshToken, email };
}

const accessCache = new Map<string, { token: string; until: number }>();

export async function accessToken(refreshToken: string): Promise<string> {
  const hit = accessCache.get(refreshToken);
  if (hit && hit.until > Date.now()) return hit.token;
  const json = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  const token = String(json.access_token ?? "");
  accessCache.set(refreshToken, {
    token,
    until: Date.now() + (Number(json.expires_in ?? 3600) - 120) * 1000,
  });
  return token;
}

async function api<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export async function createFolder(token: string, name: string): Promise<string> {
  const json = await api<{ id: string }>(token, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
  });
  return json.id;
}

export async function createSpreadsheet(token: string, title: string, folderId: string): Promise<string> {
  const json = await api<{ id: string }>(token, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    body: JSON.stringify({
      name: title,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [folderId],
    }),
  });
  return json.id;
}

export async function sheetTitles(token: string, spreadsheetId: string): Promise<string[]> {
  const json = await api<{ sheets: { properties: { title: string } }[] }>(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
  );
  return json.sheets.map((s) => s.properties.title);
}

export async function addSheets(token: string, spreadsheetId: string, titles: string[]): Promise<void> {
  if (titles.length === 0) return;
  await api(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: titles.map((title) => ({ addSheet: { properties: { title } } })) }),
  });
}

/** Replaces a whole tab with the given rows (header first). */
export async function replaceSheet(
  token: string,
  spreadsheetId: string,
  title: string,
  rows: string[][],
): Promise<void> {
  const range = encodeURIComponent(`'${title}'`);
  await api(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:clear`, {
    method: "POST",
    body: "{}",
  });
  if (rows.length === 0) return;
  await api(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}!A1?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({ values: rows }),
    },
  );
}

export async function uploadJson(
  token: string,
  folderId: string,
  name: string,
  content: string,
): Promise<string> {
  const boundary = `omnisuite${Date.now()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name, parents: [folderId], mimeType: "application/json" }),
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");
  const json = await api<{ id: string }>(
    token,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  return json.id;
}

/** Deletes JSON snapshots in the folder older than `keep` most recent. */
export async function pruneSnapshots(token: string, folderId: string, keep: number): Promise<void> {
  const q = encodeURIComponent(`'${folderId}' in parents and name contains 'snapshot-' and trashed = false`);
  const json = await api<{ files: { id: string; name: string }[] }>(
    token,
    `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=name desc&pageSize=200&fields=files(id,name)`,
  );
  for (const f of json.files.slice(keep)) {
    await api(token, `https://www.googleapis.com/drive/v3/files/${f.id}`, { method: "DELETE" });
  }
}
