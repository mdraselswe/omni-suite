import postgres from "postgres";
import { serverEnv } from "@/config/env";

/**
 * Custom-domain lookups for the proxy and Better Auth's trusted origins.
 * Deliberately free of "server-only" and the app db module, because the proxy
 * is bundled outside the React Server environment. Results are cached (verified
 * domains for a minute, unknown hosts for five) in a bounded LRU, so normal
 * traffic never waits on the database and random Host headers can't grow memory.
 */

type Entry = { slug: string | null; until: number };
const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 5 * 60_000;
export const HOST_CACHE_MAX = 1_000;
/** A plausible public hostname: labels of a-z, 0-9 and "-", at least one dot. */
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

const globalForHosts = globalThis as unknown as {
  __omnisuiteHostSql?: postgres.Sql;
  __omnisuiteHostCache?: Map<string, Entry>;
};

function sql(): postgres.Sql {
  globalForHosts.__omnisuiteHostSql ??= postgres(serverEnv().DATABASE_URL, { max: 2, idle_timeout: 30 });
  return globalForHosts.__omnisuiteHostSql;
}

function cache(): Map<string, Entry> {
  globalForHosts.__omnisuiteHostCache ??= new Map();
  return globalForHosts.__omnisuiteHostCache;
}

/** The app's own hostname (from APP_URL). */
export function appHostname(): string {
  return new URL(serverEnv().APP_URL).hostname.toLowerCase();
}

/** Hostname without port, lower case. */
export function cleanHost(value: string | null): string {
  return (value ?? "").split(":")[0]?.trim().toLowerCase() ?? "";
}

/** True for the app host and local development hosts: no tenant lookup needed. */
export function isAppHost(host: string): boolean {
  return (
    host === "" ||
    host === appHostname() ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost")
  );
}

function remember(host: string, slug: string | null): void {
  const map = cache();
  map.delete(host);
  map.set(host, { slug, until: Date.now() + (slug ? HIT_TTL_MS : MISS_TTL_MS) });
  // Map keeps insertion order: the first key is the least recently used.
  while (map.size > HOST_CACHE_MAX) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/** Number of cached hosts (tests). */
export function hostCacheSize(): number {
  return cache().size;
}

/** Tenant slug for a verified custom domain, or null. */
export async function slugForHost(host: string): Promise<string | null> {
  if (isAppHost(host) || !HOSTNAME.test(host)) return null;
  const hit = cache().get(host);
  if (hit && hit.until > Date.now()) {
    // Refresh its place in the LRU order.
    cache().delete(host);
    cache().set(host, hit);
    return hit.slug;
  }
  let slug: string | null = null;
  try {
    const rows = await sql()<{ slug: string }[]>`
      select t.slug from tenant_domains d join tenants t on t.id = d.tenant_id
      where d.hostname = ${host} and d.verified_at is not null and t.status = 'active'
      limit 1`;
    slug = rows[0]?.slug ?? null;
  } catch (error) {
    console.error("[hosts] lookup failed", error);
    return null;
  }
  remember(host, slug);
  return slug;
}

/**
 * The hostname a request was made to. Caddy passes the original Host header
 * through, so Host is used; X-Forwarded-Host is client-controlled and only
 * trusted when TRUST_FORWARDED_HOST is set (a proxy that rewrites Host).
 */
export function requestHost(headers: Headers): string {
  const forwarded = serverEnv().TRUST_FORWARDED_HOST ? headers.get("x-forwarded-host") : null;
  return cleanHost(forwarded?.split(",")[0] ?? headers.get("host"));
}

/** Forget cached lookups (after a domain is verified or removed). */
export function clearHostCache(): void {
  cache().clear();
}
