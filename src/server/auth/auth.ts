import "server-only";
import { betterAuth } from "better-auth";
import { eq } from "drizzle-orm";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { site } from "@/config";
import { buildEnv, serverEnv } from "@/config/env";
import { t } from "@/i18n";
import { db } from "@/server/db";
import { account, session, user, verification } from "@/server/db/schema";
import { sendMail } from "@/server/mail";
import { cleanHost, slugForHost } from "@/server/tenancy/hosts";
import { bindSessionToTenant, boundTenantOf, redeemHandoffToken } from "./handoff-access";
import { handoffPlugin } from "./handoff-plugin";

/** Shortest password accepted anywhere (sign-up, reset, change). */
export const MIN_PASSWORD_LENGTH = 10;

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

/** Auth endpoints a business-bound (custom-domain) session may call. */
const BOUND_SESSION_PATHS = new Set(["/get-session", "/sign-out", "/update-user", "/change-password"]);
/** Endpoints that don't act on the current session, so they need no check. */
const SESSIONLESS_PATHS = [
  "/sign-in",
  "/sign-up",
  "/callback",
  "/verify-email",
  "/send-verification-email",
  "/request-password-reset",
  "/reset-password",
  "/ok",
  "/error",
];

function isUnchecked(path: string): boolean {
  return (
    BOUND_SESSION_PATHS.has(path) || SESSIONLESS_PATHS.some((p) => path === p || path.startsWith(`${p}/`))
  );
}

function createAuth() {
  const env = serverEnv();
  const methods = authMethods();
  return betterAuth({
    appName: site.name,
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), { provider: "pg", schema: { user, session, account, verification } }),
    emailAndPassword: {
      // Dev login signs in seeded demo users with a password, so it needs this on too.
      enabled: methods.emailPassword || methods.devLogin,
      disableSignUp: !methods.emailPassword,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // An address must be proven before it can sign in (invitations and platform admin trust it).
      // Seeded demo users are created verified, so the dev login keeps working.
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      // Following the emailed link proves the address, so it counts as verified from now on.
      onPasswordReset: async ({ user: u }) => {
        await db().update(user).set({ emailVerified: true, updatedAt: new Date() }).where(eq(user.id, u.id));
      },
      sendResetPassword: async ({ user: u, url }) => {
        // Not awaited: the response time must not reveal whether the address has an account.
        void sendMail({
          to: u.email,
          subject: t("account.mail.resetSubject", { app: site.name }),
          text: t("account.mail.resetBody", { name: u.name, link: url, app: site.name }),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user: u, url }) => {
        void sendMail({
          to: u.email,
          subject: t("account.mail.verifySubject", { app: site.name }),
          text: t("account.mail.verifyBody", { name: u.name, link: url, app: site.name }),
        });
      },
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
    // Google only links to a local account whose email is already verified (Better Auth default).
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
    hooks: {
      // A session made by the custom-domain handoff belongs to one business. Over HTTP it may only
      // read itself, sign out, rename the user or change the password (needs the current one).
      before: createAuthMiddleware(async (ctx) => {
        if (!ctx.request || isUnchecked(ctx.path)) return;
        const current = await getSessionFromCtx(ctx);
        if (current && (await boundTenantOf(db(), current.session))) {
          throw new APIError("FORBIDDEN", { message: t("account.boundSession") });
        }
      }),
    },
    plugins: [
      // Custom-domain sign-in handoff (/api/handoff/*): server-only, single use, new bound session.
      handoffPlugin({
        redeem: (token, host) => redeemHandoffToken(db(), token, host),
        bind: (sessionId, slug, expiresAt) => bindSessionToTenant(db(), sessionId, slug, expiresAt),
      }),
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

/** Platform admins are listed by email, and only count once that address is verified. */
export function isPlatformAdmin(u: { email: string; emailVerified: boolean }): boolean {
  return u.emailVerified && serverEnv().PLATFORM_ADMIN_EMAILS.includes(u.email.toLowerCase());
}
