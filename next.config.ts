import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * Security headers on every response. No script CSP (it would fight Next's inline
 * scripts); framing is blocked with frame-ancestors + X-Frame-Options instead.
 * HSTS only outside `next dev` (browsers ignore it over plain http anyway). No
 * includeSubDomains: it would also pin subdomains of tenants' custom domains.
 */
function securityHeaders(production: boolean) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
    ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=63072000" }] : []),
  ];
}

/**
 * OmniSuite is a server-mode app (ADR 0008): every page depends on the signed-in
 * user, so pages render per request and stream with loading states. Cache
 * Components stay off; speed comes from indexed, tenant-scoped queries.
 */
export default function config(phase: string): NextConfig {
  return {
    reactCompiler: true,
    typedRoutes: true,
    trailingSlash: true,
    poweredByHeader: false,
    serverExternalPackages: ["postgres", "nodemailer", "@electric-sql/pglite"],
    experimental: {
      // Small on purpose: file uploads go to a route handler (/api/t/<tenant>/files/) with its own
      // limit (MAX_UPLOAD_MB). Forms with a CSV import stay well under this.
      serverActions: { bodySizeLimit: "4mb" },
    },
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders(phase !== PHASE_DEVELOPMENT_SERVER) }];
    },
    // Tailwind v4 through its Turbopack loader (set up by create-next-app).
    turbopack: {
      rules: {
        "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
      },
    },
  };
}
