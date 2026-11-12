import { z } from "zod";
import { FX_PROVIDERS, RENDER_MODES } from "./schema.ts";

/**
 * The only place that reads process.env (ESLint enforces this).
 * Every variable is listed in .env.example. Add server-only secrets to
 * `serverSchema` and import `serverEnv` only from server code.
 *
 * NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so
 * they must be read with a literal `process.env.NEXT_PUBLIC_X`.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
});

const buildSchema = z.object({
  RENDER_MODE: z.enum(RENDER_MODES).optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

/**
 * Public development defaults for the two secrets. Anyone can read them in the
 * repository, so a production server refuses to start with them (see
 * `insecureSecrets`, checked in src/server/boot.ts).
 */
export const DEV_SECRETS = {
  BETTER_AUTH_SECRET: "dev-only-secret-change-me-please-0000",
  ENCRYPTION_KEY: "ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzItYnl0ZXM=",
} as const;

const serverSchema = z.object({
  /** Postgres connection string. */
  DATABASE_URL: z.string().default("postgres://omnisuite:omnisuite@localhost:5432/omnisuite"),
  /** Public base URL of the app (sign-in happens here). No trailing slash. */
  APP_URL: z.url().default("http://localhost:3000"),
  /** Better Auth signing secret (32+ random characters). */
  BETTER_AUTH_SECRET: z.string().min(16).default(DEV_SECRETS.BETTER_AUTH_SECRET),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  /** Turns on email + password sign-in and sign-up. */
  AUTH_EMAIL_PASSWORD: bool,
  /** Development/test only: one-click sign-in as seeded users. Ignored in production. */
  DEV_LOGIN: bool,
  /** Comma-separated emails with platform admin rights. */
  PLATFORM_ADMIN_EMAILS: list,
  /** 32-byte key (base64) for encrypting stored tokens. */
  ENCRYPTION_KEY: z.string().default(DEV_SECRETS.ENCRYPTION_KEY),
  /** SMTP connection string. Mailpit locally: smtp://localhost:1025 */
  SMTP_URL: z.string().default("smtp://localhost:1025"),
  MAIL_FROM: z.string().default("OmniSuite <no-reply@localhost>"),
  /** Where uploaded files are stored on disk. */
  FILE_STORAGE_DIR: z.string().default("./storage"),
  /**
   * Trust X-Forwarded-Host for the request's host (only behind a proxy that
   * rewrites Host and always sets this header). Caddy keeps Host: leave off.
   */
  TRUST_FORWARDED_HOST: bool,
  /** Hostname tenants point their custom domain at (CNAME target). */
  CUSTOM_DOMAIN_TARGET: z.string().default("tenants.localhost"),
  /** Run background jobs inside the web process. */
  WORKER_ENABLED: z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => v !== "false" && v !== "0"),
  /** Apply database migrations when the server starts. */
  AUTO_MIGRATE: z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => v !== "false" && v !== "0"),
  /**
   * Shared secret for Caddy's on-demand TLS check (/api/domains/allowed?secret=…).
   * Empty: the check only answers requests that don't come in through a public host.
   */
  DOMAIN_CHECK_SECRET: z.string().default(""),
  /** Max upload size in megabytes. */
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),

  /** Platform Stripe account: businesses pay their OmniSuite subscription here. Empty = billing off. */
  STRIPE_SECRET_KEY: z.string().default(""),
  /** Signing secret of the platform webhook endpoint (<APP_URL>/api/stripe/webhook). */
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  /** Stripe Price ids (price_…) for the plans in src/config/billing.ts. */
  STRIPE_PRICE_STARTER: z.string().default(""),
  STRIPE_PRICE_GROWTH: z.string().default(""),
  STRIPE_PRICE_SCALE: z.string().default(""),

  /** Xero app (developer.xero.com → My Apps). Empty = Xero integration off. */
  XERO_CLIENT_ID: z.string().default(""),
  XERO_CLIENT_SECRET: z.string().default(""),

  /** Claude API key (platform.claude.com). Empty = features that use Claude are off. */
  ANTHROPIC_API_KEY: z.string().default(""),
  /** Other AI providers (src/config/ai.ts). Each one is off while its key is empty. */
  OPENAI_API_KEY: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  DEEPSEEK_API_KEY: z.string().default(""),
  XAI_API_KEY: z.string().default(""),
  MISTRAL_API_KEY: z.string().default(""),
  GROQ_API_KEY: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),
  /** Key for the spare "openai-compatible" slot (any non-empty value for a local Ollama). */
  OPENAI_COMPATIBLE_API_KEY: z.string().default(""),

  /** Exchange-rate source for "Use today's rate" (default: src/config/regional.ts). "off" hides it. */
  FX_PROVIDER: z.enum(FX_PROVIDERS).optional(),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
});

export const buildEnv = buildSchema.parse({
  RENDER_MODE: process.env.RENDER_MODE || undefined,
  NODE_ENV: process.env.NODE_ENV,
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

/** Server-only values. Never import this from a client component. */
export const serverEnv = (): ServerEnv => {
  cached ??= serverSchema.parse(
    Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v])),
  );
  return cached;
};

/**
 * Names of secrets still set to their public development default on a server
 * that is reachable from outside (production mode and an APP_URL that isn't a
 * local host). Local `pnpm start` and the e2e run on localhost stay allowed.
 */
function isPublicProduction(appUrl: string, nodeEnv: string): boolean {
  if (nodeEnv !== "production") return false;
  const host = new URL(appUrl).hostname;
  return !(host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost"));
}

export function insecureSecrets(
  env: Pick<ServerEnv, "APP_URL" | "BETTER_AUTH_SECRET" | "ENCRYPTION_KEY">,
  nodeEnv: string = buildEnv.NODE_ENV,
): string[] {
  if (!isPublicProduction(env.APP_URL, nodeEnv)) return [];
  return (Object.keys(DEV_SECRETS) as (keyof typeof DEV_SECRETS)[]).filter(
    (name) => env[name] === DEV_SECRETS[name],
  );
}

/** Shortest BETTER_AUTH_SECRET / DOMAIN_CHECK_SECRET a public production server accepts. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Secrets too weak to use: ENCRYPTION_KEY must always decode to 32 bytes (AES-256),
 * and on a public production server BETTER_AUTH_SECRET (and DOMAIN_CHECK_SECRET,
 * when set) must be at least MIN_SECRET_LENGTH characters. Checked at boot.
 */
export function weakSecrets(
  env: Pick<ServerEnv, "APP_URL" | "BETTER_AUTH_SECRET" | "ENCRYPTION_KEY" | "DOMAIN_CHECK_SECRET">,
  nodeEnv: string = buildEnv.NODE_ENV,
): string[] {
  const weak: string[] = [];
  if (Buffer.from(env.ENCRYPTION_KEY, "base64").length !== 32) weak.push("ENCRYPTION_KEY");
  if (!isPublicProduction(env.APP_URL, nodeEnv)) return weak;
  if (env.BETTER_AUTH_SECRET.length < MIN_SECRET_LENGTH) weak.push("BETTER_AUTH_SECRET");
  if (env.DOMAIN_CHECK_SECRET !== "" && env.DOMAIN_CHECK_SECRET.length < MIN_SECRET_LENGTH) {
    weak.push("DOMAIN_CHECK_SECRET");
  }
  return weak;
}
