import { z } from "zod";
import { RENDER_MODES } from "./schema.ts";

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

const serverSchema = z.object({
  /** Postgres connection string. */
  DATABASE_URL: z.string().default("postgres://omnisuite:omnisuite@localhost:5432/omnisuite"),
  /** Public base URL of the app (sign-in happens here). No trailing slash. */
  APP_URL: z.url().default("http://localhost:3000"),
  /** Better Auth signing secret (32+ random characters). */
  BETTER_AUTH_SECRET: z.string().min(16).default("dev-only-secret-change-me-please-0000"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  /** Turns on email + password sign-in and sign-up. */
  AUTH_EMAIL_PASSWORD: bool,
  /** Development/test only: one-click sign-in as seeded users. Ignored in production. */
  DEV_LOGIN: bool,
  /** Comma-separated emails with platform admin rights. */
  PLATFORM_ADMIN_EMAILS: list,
  /** 32-byte key (base64) for encrypting stored tokens. */
  ENCRYPTION_KEY: z.string().default("ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzItYnl0ZXM="),
  /** SMTP connection string. Mailpit locally: smtp://localhost:1025 */
  SMTP_URL: z.string().default("smtp://localhost:1025"),
  MAIL_FROM: z.string().default("OmniSuite <no-reply@localhost>"),
  /** Where uploaded files are stored on disk. */
  FILE_STORAGE_DIR: z.string().default("./storage"),
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
  /** Max upload size in megabytes. */
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),
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
