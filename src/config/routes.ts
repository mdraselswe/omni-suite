/**
 * Fixed app routes. Tenant pages live under /<tenant-slug>/… and are built with
 * `tenantHref` (src/lib/href.ts). Plain data (no Next imports) so scripts can read it too.
 */
export const ROUTES = {
  home: "/",
  login: "/login",
  newBusiness: "/onboarding",
  admin: "/admin",
} as const;

/** The app is private: only the sign-in page is listed in the sitemap. */
export const SITEMAP_ROUTES: readonly string[] = [ROUTES.login];

/** The served URL of a route (`/login` → `/login/`). */
export const pageUrl = (route: string) => (route.endsWith("/") ? route : `${route}/`);
