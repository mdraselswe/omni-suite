import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

/**
 * next.config has `trailingSlash: true`, so Next redirects /api/auth/x to
 * /api/auth/x/. Better Auth matches paths without the slash: strip it here.
 */
async function withoutTrailingSlash(request: Request): Promise<Request> {
  const url = new URL(request.url);
  if (!url.pathname.endsWith("/")) return request;
  url.pathname = url.pathname.replace(/\/+$/, "");
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  });
}

export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(await withoutTrailingSlash(request));
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(await withoutTrailingSlash(request));
}
