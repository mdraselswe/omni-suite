import postgres from "postgres";
import { serverEnv } from "@/config/env";

/**
 * Custom-domain lookups for the proxy and Better Auth's trusted origins.
 * Deliberately free of "server-only" and the app db module, because the proxy
 * is bundled outside the React Server environment. Results are cached for a
 * minute (misses too), so normal traffic never waits on the database.
 */

type Entry = { slug: string | null; until: number };
const TTL_MS = 60_000;

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

/** Tenant slug for a verified custom domain, or null. */
export async function slugForHost(host: string): Promise<string | null> {
  if (isAppHost(host)) return null;
  const hit = cache().get(host);
  if (hit && hit.until > Date.now()) return hit.slug;
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
  cache().set(host, { slug, until: Date.now() + TTL_MS });
  return slug;
}

/** Forget cached lookups (after a domain is verified or removed). */
export function clearHostCache(): void {
  cache().clear();
}
