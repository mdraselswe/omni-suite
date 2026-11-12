import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { boundTenantIdOf, type RedeemedGrant } from "./handoff-access";

/**
 * Better Auth side of the custom-domain handoff: one SERVER_ONLY endpoint that
 * redeems a handoff token for a brand-new session (never the app host's session)
 * bound to the token's business, and sets its cookie on the custom domain.
 * SERVER_ONLY endpoints are not routed, so it can't be called over HTTP; only
 * `auth.api.redeemHandoff` from our server.
 */
export function handoffPlugin(options: {
  redeem: (token: string, host: string, browserNonce: string) => Promise<RedeemedGrant | null>;
}) {
  return {
    id: "custom-domain-handoff",
    endpoints: {
      redeemHandoff: createAuthEndpoint(
        "/handoff/redeem",
        {
          method: "POST",
          body: z.object({
            token: z.string().min(1),
            host: z.string().min(1),
            browser: z.string().min(1),
          }),
          metadata: { SERVER_ONLY: true },
        },
        async (c) => {
          if (c.request) throw new APIError("NOT_FOUND");
          const grant = await options.redeem(c.body.token, c.body.host, c.body.browser);
          if (!grant) throw new APIError("BAD_REQUEST", { message: "Invalid token" });
          const user = await c.context.internalAdapter.findUserById(grant.userId);
          if (!user) throw new APIError("BAD_REQUEST", { message: "Invalid token" });
          // The binding is a column of the session row itself: it can't be lost or
          // purged while the session lives, and it isn't writable over HTTP (input: false).
          const session = await c.context.internalAdapter.createSession(user.id, false, {
            boundTenantId: grant.tenantId,
          });
          if (boundTenantIdOf(session) !== grant.tenantId) {
            // Never hand out an unbound session.
            await c.context.internalAdapter.deleteSession(session.token);
            throw new APIError("INTERNAL_SERVER_ERROR");
          }
          await setSessionCookie(c, { session, user });
          return c.json({ slug: grant.slug });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
