import { type NextRequest } from "next/server";
import { cleanHost, isAppHost, slugForHost } from "@/server/tenancy/hosts";

/**
 * Caddy on-demand TLS "ask" endpoint: 200 only for the app host and verified
 * tenant domains, so certificates are never issued for random hostnames.
 */
export async function GET(request: NextRequest) {
  const host = cleanHost(request.nextUrl.searchParams.get("domain"));
  const ok = host !== "" && (isAppHost(host) || (await slugForHost(host)) !== null);
  return new Response(ok ? "ok" : "no", { status: ok ? 200 : 404 });
}
