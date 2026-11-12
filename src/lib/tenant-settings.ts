import { z } from "zod";
import { SIDEBAR_STYLES, THEME_PRESETS } from "@/config";

/** Who gets the client portal AI assistant. */
export const PORTAL_ASSISTANT_MODES = ["off", "all", "selected"] as const;
export type PortalAssistantMode = (typeof PORTAL_ASSISTANT_MODES)[number];

/**
 * Everything a business can configure without code (ADR 0009).
 * Stored as one JSON column on `tenants`, always parsed through this schema,
 * so older rows pick up new defaults automatically.
 */
export const tenantSettingsSchema = z.object({
  currency: z.string().length(3).default("AUD"),
  timezone: z.string().min(1).default("Australia/Sydney"),
  locale: z.string().min(2).default("en-AU"),
  tax: z
    .object({
      name: z.string().min(1).default("GST"),
      /** Basis points: 1000 = 10%. */
      rateBp: z.number().int().min(0).max(10000).default(1000),
      pricesIncludeTax: z.boolean().default(false),
      registrationNumber: z.string().default(""),
    })
    .prefault({}),
  /** 1–12: month the financial year starts (Australia: 7 = July). */
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(7),
  invoicePrefix: z.string().max(10).default("INV-"),
  proposalPrefix: z.string().max(10).default("PRO-"),
  creditNotePrefix: z.string().max(10).default("CN-"),
  paymentTermsDays: z.number().int().min(0).max(365).default(14),
  invoiceFooter: z.string().max(2000).default(""),
  /** Replies to emails sent for the business go here (blank: the platform's address, no replies). */
  replyToEmail: z.email().or(z.literal("")).catch("").default(""),
  /**
   * Payment reminders for sent invoices: `daysBefore` the due date (0 = none),
   * then on each of `daysAfter` days past it.
   */
  reminders: z
    .object({
      enabled: z.boolean().default(true),
      daysBefore: z.number().int().min(0).max(60).default(3),
      daysAfter: z.array(z.number().int().min(1).max(365)).max(6).default([1, 7, 14]),
    })
    .prefault({}),
  pipelineStages: z
    .array(
      z.object({ key: z.string().min(1), label: z.string().min(1), kind: z.enum(["open", "won", "lost"]) }),
    )
    .min(1)
    .default([
      { key: "new", label: "New enquiry", kind: "open" },
      { key: "call", label: "Call booked", kind: "open" },
      { key: "proposal", label: "Proposal sent", kind: "open" },
      { key: "pilot", label: "Pilot", kind: "open" },
      { key: "won", label: "Won", kind: "won" },
      { key: "lost", label: "Lost", kind: "lost" },
    ]),
  projectStatuses: z
    .array(z.object({ key: z.string().min(1), label: z.string().min(1), done: z.boolean() }))
    .min(1)
    .default([
      { key: "planning", label: "Planning", done: false },
      { key: "active", label: "In progress", done: false },
      { key: "review", label: "Client review", done: false },
      { key: "done", label: "Done", done: true },
    ]),
  disabledModules: z.array(z.string()).default([]),
  /**
   * Client portal AI assistant: off, on for every client, or only for the clients listed.
   * Needs the AI module on and an AI provider key on the server.
   */
  portalAssistant: z
    .object({
      mode: z.enum(PORTAL_ASSISTANT_MODES).catch("off").default("off"),
      clientIds: z.array(z.uuid()).max(10_000).catch([]).default([]),
    })
    .prefault({}),
  /** Look of the team area and client portal. Empty values use the platform defaults (src/config/site.ts). */
  branding: z
    .object({
      displayName: z.string().default(""),
      /** https link to a logo image. */
      logoUrl: z
        .string()
        .regex(/^(https:\/\/\S+)?$/)
        .catch("")
        .default(""),
      /** Colour preset key from src/config/themes.ts, or "". */
      preset: z
        .enum(["", ...THEME_PRESETS])
        .catch("")
        .default(""),
      /** Own brand colour (#rrggbb) that replaces the preset's, or "". */
      brandColor: z
        .string()
        .regex(/^(#[0-9a-fA-F]{6})?$/)
        .catch("")
        .default(""),
      sidebar: z
        .enum(["", ...SIDEBAR_STYLES])
        .catch("")
        .default(""),
    })
    .prefault({}),
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

/** Parses stored settings, filling defaults for anything missing. */
export function parseTenantSettings(value: unknown): TenantSettings {
  const parsed = tenantSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : tenantSettingsSchema.parse({});
}

/** True when the business gives this client the portal assistant (mode "all", or listed). */
export function portalAssistantFor(settings: TenantSettings, clientId: string | null): boolean {
  const { mode, clientIds } = settings.portalAssistant;
  if (!clientId || mode === "off") return false;
  return mode === "all" || clientIds.includes(clientId);
}
