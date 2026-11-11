import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { buildEnv, serverEnv } from "@/config/env";
import { db } from "@/server/db";
import { account, session, user, verification } from "@/server/db/schema";
import { cleanHost, slugForHost } from "@/server/tenancy/hosts";

/** Is the development-only quick sign-in available? Never in production. */
export function devLoginEnabled(): boolean {
  return serverEnv().DEV_LOGIN && buildEnv.NODE_ENV !== "production";
}

export function authMethods() {
  const env = serverEnv();
  return {
    google: env.GOOGLE_CLIENT_ID !== "" && env.GOOGLE_CLIENT_SECRET !== "",
    emailPassword: env.AUTH_EMAIL_PASSWORD,
    devLogin: devLoginEnabled(),
  };
}

function createAuth() {
  const env = serverEnv();
  const methods = authMethods();
  return betterAuth({
    appName: "OmniSuite",
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), { provider: "pg", schema: { user, session, account, verification } }),
    emailAndPassword: {
      // Dev login signs in seeded demo users with a password, so it needs this on too.
      enabled: methods.emailPassword || methods.devLogin,
      disableSignUp: !methods.emailPassword,
      minPasswordLength: 10,
    },
    socialProviders: methods.google
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: "select_account",
          },
        }
      : {},
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, window: 60, max: 100 },
    // Verified custom domains may call the auth API (sign-out, session) from their own origin.
    trustedOrigins: async (request) => {
      const origin = request?.headers.get("origin");
      if (!origin) return [];
      const host = cleanHost(new URL(origin).host);
      return (await slugForHost(host)) ? [origin] : [];
    },
    plugins: [
      // Custom-domain sign-in handoff (/api/handoff/*): short-lived, single use, server-side only.
      oneTimeToken({ expiresIn: 1, disableClientRequest: true, storeToken: "hashed" }),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __omnisuiteAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__omnisuiteAuth ??= createAuth();
  return globalForAuth.__omnisuiteAuth;
}

export function isPlatformAdminEmail(email: string): boolean {
  return serverEnv().PLATFORM_ADMIN_EMAILS.includes(email.toLowerCase());
}
