import type { NextConfig } from "next";

/**
 * OmniSuite is a server-mode app (ADR 0008): every page depends on the signed-in
 * user, so pages render per request and stream with loading states. Cache
 * Components stay off; speed comes from indexed, tenant-scoped queries.
 */
const nextConfig: NextConfig = {
  reactCompiler: true,
  typedRoutes: true,
  trailingSlash: true,
  poweredByHeader: false,
  serverExternalPackages: ["postgres", "nodemailer", "@electric-sql/pglite"],
  experimental: {
    serverActions: { bodySizeLimit: "26mb" },
  },
  // Tailwind v4 through its Turbopack loader (set up by create-next-app).
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
