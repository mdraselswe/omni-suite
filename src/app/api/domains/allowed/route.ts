import { type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { safeEqual } from "@/server/crypto";
import { appHostname, cleanHost, isAppHost, requestHost, slugForHost } from "@/server/tenancy/hosts";

/**
 * Only Caddy may ask. With DOMAIN_CHECK_SECRET set, the request must carry it
 * (`?secret=…`, see deploy/Caddyfile). Without it, only requests that didn't
 * come in through a public host (the app host or a tenant domain) are answered:
 * Caddy calls the app directly as http://app:3000.
 */
async function fromCaddy(request: NextRequest): Promise<boolean> {
  const secret = serverEnv().DOMAIN_CHECK_SECRET;
  if (secret !== "") return safeEqual(request.nextUrl.searchParams.get("secret") ?? "", secret);
  const host = requestHost(request.headers);
  if (host === "" || host === appHostname()) return false;
  return (await slugForHost(host)) === null;
}

/**
 * Caddy on-demand TLS "ask" endpoint: 200 only for the app host and verified
 * tenant domains, so certificates are never issued for random hostnames.
 * Answers with a bare status code and no body.
 */
export async function GET(request: NextRequest) {
  if (!(await fromCaddy(request))) return new Response(null, { status: 404 });
  const host = cleanHost(request.nextUrl.searchParams.get("domain"));
  const ok = host !== "" && (isAppHost(host) || (await slugForHost(host)) !== null);
  return new Response(null, { status: ok ? 200 : 404 });
}
