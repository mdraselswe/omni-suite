import type { Route } from "next";

/**
 * Link inside a tenant: tenantHref("omniscope", "invoices/123") → "/omniscope/invoices/123".
 * The one place that turns runtime paths into typed routes.
 */
export function tenantHref(slug: string, path = ""): Route {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return (clean ? `/${slug}/${clean}` : `/${slug}`) as Route;
}

/** Absolute or app-level dynamic path as a typed route (e.g. "/invite/abc"). */
export function appHref(path: string): Route {
  return path as Route;
}
