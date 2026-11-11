import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import type { HandoffGrant } from "./handoff-access";

/**
 * Better Auth side of the custom-domain handoff: one SERVER_ONLY endpoint that
 * redeems a handoff token for a brand-new session (never the app host's session)
 * and sets its cookie on the custom domain. SERVER_ONLY endpoints are not routed,
 * so it can't be called over HTTP; only `auth.api.redeemHandoff` from our server.
 */
export function handoffPlugin(options: {
  redeem: (token: string, host: string) => Promise<HandoffGrant | null>;
  bind: (sessionId: string, slug: string, sessionExpiresAt: Date) => Promise<void>;
}) {
  return {
    id: "custom-domain-handoff",
    endpoints: {
      redeemHandoff: createAuthEndpoint(
        "/handoff/redeem",
        {
          method: "POST",
          body: z.object({ token: z.string().min(1), host: z.string().min(1) }),
          metadata: { SERVER_ONLY: true },
        },
        async (c) => {
          if (c.request) throw new APIError("NOT_FOUND");
          const grant = await options.redeem(c.body.token, c.body.host);
          if (!grant) throw new APIError("BAD_REQUEST", { message: "Invalid token" });
          const user = await c.context.internalAdapter.findUserById(grant.userId);
          if (!user) throw new APIError("BAD_REQUEST", { message: "Invalid token" });
          const session = await c.context.internalAdapter.createSession(user.id);
          try {
            await options.bind(session.id, grant.slug, session.expiresAt);
          } catch (error) {
            // Never hand out an unbound session.
            await c.context.internalAdapter.deleteSession(session.token);
            throw error;
          }
          await setSessionCookie(c, { session, user });
          return c.json({ slug: grant.slug });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
