import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, ts, updatedAt } from "./columns";
import { user } from "./auth";

/** A business using OmniSuite. */
export const tenants = pgTable("tenants", {
  id: pk(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "suspended"] })
    .notNull()
    .default("active"),
  plan: text("plan").notNull().default("starter"),
  settings: jsonb("settings").notNull().default({}),
  /** Bumped on every role/override change; part of the permission cache key. */
  permissionsVersion: integer("permissions_version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tenantDomains = pgTable(
  "tenant_domains",
  {
    id: pk(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull().unique(),
    verificationToken: text("verification_token").notNull(),
    verifiedAt: ts("verified_at"),
    createdAt: createdAt(),
  },
  (t) => [index("tenant_domains_tenant_idx").on(t.tenantId)],
);

/** A user's place in a tenant. `kind` decides team area vs client portal. */
export const memberships = pgTable(
  "memberships",
  {
    id: pk(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["internal", "client"] }).notNull(),
    /** For client members: the client organisation they belong to. */
    clientId: uuid("client_id"),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    title: text("title").notNull().default(""),
    timezone: text("timezone"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_uq").on(t.tenantId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: pk(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    kind: text("kind", { enum: ["internal", "client"] }).notNull(),
    clientId: uuid("client_id"),
    roleIds: jsonb("role_ids").$type<string[]>().notNull().default([]),
    token: text("token").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    /** Withdrawn by the business: kept (not deleted) so the link can say so. */
    revokedAt: ts("revoked_at"),
    /** When the invitation email last went out (null: only when created). */
    lastSentAt: ts("last_sent_at"),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_tenant_idx").on(t.tenantId, t.email)],
);

export const roles = pgTable(
  "roles",
  {
    id: pk(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    audience: text("audience", { enum: ["internal", "client"] }).notNull(),
    /** Created from a default template; can be reset to it. */
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("roles_tenant_key_uq").on(t.tenantId, t.key)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    scope: text("scope", { enum: ["own", "assigned", "all"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const memberRoles = pgTable(
  "member_roles",
  {
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.roleId] }), index("member_roles_role_idx").on(t.roleId)],
);

export const memberOverrides = pgTable(
  "member_overrides",
  {
    id: pk(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    effect: text("effect", { enum: ["allow", "deny"] }).notNull(),
    scope: text("scope", { enum: ["own", "assigned", "all"] })
      .notNull()
      .default("all"),
    expiresAt: ts("expires_at"),
    reason: text("reason").notNull().default(""),
    grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("member_overrides_member_idx").on(t.membershipId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: pk(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("audit_logs_entity_idx").on(t.tenantId, t.entityType, t.entityId),
  ],
);

export const customFieldDefs = pgTable(
  "custom_field_defs",
  {
    id: pk(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entity: text("entity", { enum: ["client", "lead", "project", "invoice"] }).notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type", { enum: ["text", "number", "date", "select", "checkbox"] }).notNull(),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    required: boolean("required").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("custom_field_defs_uq").on(t.tenantId, t.entity, t.key)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.tenantId, t.createdAt)],
);

/** Per-tenant counters for invoice/proposal numbers. */
export const tenantCounters = pgTable(
  "tenant_counters",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

/** Background jobs. The table is the queue (FOR UPDATE SKIP LOCKED). */
export const jobs = pgTable(
  "jobs",
  {
    id: pk(),
    type: text("type").notNull(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull().default({}),
    runAt: ts("run_at").notNull().defaultNow(),
    status: text("status", { enum: ["pending", "running", "done", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lockedAt: ts("locked_at"),
    /** Prevents duplicate pending jobs (e.g. one sync per tenant). */
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
  },
  (t) => [
    index("jobs_pending_idx").on(t.status, t.runAt),
    uniqueIndex("jobs_dedupe_uq")
      .on(t.dedupeKey)
      .where(sql`status = 'pending' and dedupe_key is not null`),
  ],
);

/** Changes waiting to be mirrored to Google Sheets (ADR 0007). */
export const syncOutbox = pgTable(
  "sync_outbox",
  {
    id: pk(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    op: text("op", { enum: ["upsert", "delete"] }).notNull(),
    createdAt: createdAt(),
    processedAt: ts("processed_at"),
  },
  (t) => [index("sync_outbox_pending_idx").on(t.tenantId, t.processedAt)],
);

export const googleConnections = pgTable("google_connections", {
  id: pk(),
  tenantId: uuid("tenant_id")
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: "cascade" }),
  connectedBy: text("connected_by").references(() => user.id, { onDelete: "set null" }),
  googleEmail: text("google_email").notNull().default(""),
  /** AES-256-GCM encrypted. */
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  folderId: text("folder_id"),
  spreadsheetId: text("spreadsheet_id"),
  lastSyncedAt: ts("last_synced_at"),
  lastSnapshotAt: ts("last_snapshot_at"),
  lastError: text("last_error"),
  createdAt: createdAt(),
});
