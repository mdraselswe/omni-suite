/**
 * Post-login / post-handoff destinations (`next=`). Only same-origin paths are
 * allowed: the value is resolved against a fixed origin and must stay on it, so
 * tricks like `//evil.com`, `/\evil.com` or `/\t/evil.com` fall back to "/".
 * Pure (no server imports) so it can be unit tested and used anywhere.
 */
const BASE = "https://app.invalid";

export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value === "") return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  // Browsers treat "\" like "/" and strip tabs/newlines, which turns "/\evil.com" into "//evil.com".
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === "\\" || code < 0x20 || code === 0x7f) return fallback;
  }
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
