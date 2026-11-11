import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, day, money, pk, ts, updatedAt } from "./columns";
import { user } from "./auth";
import { memberships, tenants } from "./core";

const tenantRef = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

const custom = () => jsonb("custom").$type<Record<string, unknown>>().notNull().default({});

/* ─── Clients & CRM ─────────────────────────────────────────────── */

export const clients = pgTable(
  "clients",
  {
    id: pk(),
    tenantId: tenantRef(),
    name: text("name").notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    website: text("website").notNull().default(""),
    address: text("address").notNull().default(""),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    notes: text("notes").notNull().default(""),
    custom: custom(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("clients_tenant_name_idx").on(t.tenantId, t.name)],
);

export const leads = pgTable(
  "leads",
  {
    id: pk(),
    tenantId: tenantRef(),
    name: text("name").notNull(),
    company: text("company").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    source: text("source").notNull().default(""),
    stage: text("stage").notNull(),
    valueMinor: money("value_minor"),
    notes: text("notes").notNull().default(""),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    ownerMembershipId: uuid("owner_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    custom: custom(),
    /** Archived leads (spam, duplicates, dead) leave the board but stay in the record. */
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("leads_tenant_stage_idx").on(t.tenantId, t.stage)],
);

/** Onboarding questionnaires built per tenant (fields as JSON schema). */
export const onboardingTemplates = pgTable(
  "onboarding_templates",
  {
    id: pk(),
    tenantId: tenantRef(),
    name: text("name").notNull(),
    fields: jsonb("fields").notNull().default([]),
    checklist: jsonb("checklist").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("onboarding_templates_tenant_idx").on(t.tenantId)],
);

export const onboardingRequests = pgTable(
  "onboarding_requests",
  {
    id: pk(),
    tenantId: tenantRef(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => onboardingTemplates.id),
    status: text("status", { enum: ["sent", "submitted", "completed"] })
      .notNull()
      .default("sent"),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
    checklistDone: jsonb("checklist_done").$type<string[]>().notNull().default([]),
    submittedAt: ts("submitted_at"),
    createdAt: createdAt(),
  },
  (t) => [index("onboarding_requests_tenant_client_idx").on(t.tenantId, t.clientId)],
);

/* ─── Proposals & invoices ─────────────────────────────────────── */

export type LineItem = { description: string; quantity: string; unitPriceMinor: string; taxRateBp: number };

export const proposals = pgTable(
  "proposals",
  {
    id: pk(),
    tenantId: tenantRef(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    number: text("number").notNull(),
    title: text("title").notNull(),
    intro: text("intro").notNull().default(""),
    terms: text("terms").notNull().default(""),
    items: jsonb("items").$type<LineItem[]>().notNull().default([]),
    currency: text("currency").notNull(),
    subtotalMinor: money("subtotal_minor"),
    taxMinor: money("tax_minor"),
    totalMinor: money("total_minor"),
    status: text("status", { enum: ["draft", "sent", "accepted", "declined"] })
      .notNull()
      .default("draft"),
    validUntil: day("valid_until"),
    respondedAt: ts("responded_at"),
    respondedByName: text("responded_by_name"),
    respondedIp: text("responded_ip"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("proposals_tenant_client_idx").on(t.tenantId, t.clientId),
    uniqueIndex("proposals_tenant_number_uq").on(t.tenantId, t.number),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: pk(),
    tenantId: tenantRef(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    number: text("number").notNull(),
    status: text("status", { enum: ["draft", "sent", "partially_paid", "paid", "void"] })
      .notNull()
      .default("draft"),
    issueDate: day("issue_date").notNull(),
    dueDate: day("due_date").notNull(),
    currency: text("currency").notNull(),
    items: jsonb("items").$type<LineItem[]>().notNull().default([]),
    subtotalMinor: money("subtotal_minor"),
    taxMinor: money("tax_minor"),
    totalMinor: money("total_minor"),
    paidMinor: money("paid_minor"),
    notes: text("notes").notNull().default(""),
    recurringId: uuid("recurring_id"),
    proposalId: uuid("proposal_id"),
    custom: custom(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("invoices_tenant_status_due_idx").on(t.tenantId, t.status, t.dueDate),
    index("invoices_tenant_client_idx").on(t.tenantId, t.clientId),
    uniqueIndex("invoices_tenant_number_uq").on(t.tenantId, t.number),
  ],
);

export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: pk(),
    tenantId: tenantRef(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    transactionId: uuid("transaction_id").notNull(),
    amountMinor: money("amount_minor"),
    date: day("date").notNull(),
    method: text("method").notNull().default(""),
    /** Provider reference (e.g. Stripe Checkout Session id) so a webhook never records twice. */
    externalRef: text("external_ref"),
    /** Set when the payment's ledger row was reversed (the amount no longer counts as paid). */
    reversedAt: ts("reversed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("invoice_payments_invoice_idx").on(t.tenantId, t.invoiceId),
    uniqueIndex("invoice_payments_external_idx").on(t.tenantId, t.externalRef),
  ],
);

export const recurringInvoices = pgTable(
  "recurring_invoices",
  {
    id: pk(),
    tenantId: tenantRef(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    name: text("name").notNull(),
    intervalMonths: integer("interval_months").notNull().default(1),
    nextRunDate: day("next_run_date").notNull(),
    items: jsonb("items").$type<LineItem[]>().notNull().default([]),
    currency: text("currency").notNull(),
    active: boolean("active").notNull().default(true),
    autoSend: boolean("auto_send").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("recurring_tenant_next_idx").on(t.tenantId, t.active, t.nextRunDate)],
);

/* ─── Projects, tasks, time, files ─────────────────────────────── */

export const projectTemplates = pgTable(
  "project_templates",
  {
    id: pk(),
    tenantId: tenantRef(),
    name: text("name").notNull(),
    tasks: jsonb("tasks").$type<{ title: string; clientVisible: boolean }[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("project_templates_tenant_idx").on(t.tenantId)],
);

export const projects = pgTable(
  "projects",
  {
    id: pk(),
    tenantId: tenantRef(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull(),
    startDate: day("start_date"),
    dueDate: day("due_date"),
    budgetMinor: money("budget_minor"),
    custom: custom(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("projects_tenant_status_idx").on(t.tenantId, t.status),
    index("projects_client_idx").on(t.tenantId, t.clientId),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("project_members_uq").on(t.projectId, t.membershipId),
    index("project_members_member_idx").on(t.membershipId),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: pk(),
    tenantId: tenantRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: ["todo", "in_progress", "review", "done"] })
      .notNull()
      .default("todo"),
    assigneeMembershipId: uuid("assignee_membership_id").references(() => memberships.id, {
      onDelete: "set null",
    }),
    dueDate: day("due_date"),
    position: integer("position").notNull().default(0),
    clientVisible: boolean("client_visible").notNull().default(false),
    needsApproval: boolean("needs_approval").notNull().default(false),
    approvedAt: ts("approved_at"),
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_tenant_project_idx").on(t.tenantId, t.projectId, t.position),
    index("tasks_assignee_idx").on(t.tenantId, t.assigneeMembershipId),
  ],
);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: pk(),
    tenantId: tenantRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    date: day("date").notNull(),
    minutes: integer("minutes").notNull(),
    note: text("note").notNull().default(""),
    billable: boolean("billable").notNull().default(true),
    hourlyRateMinor: money("hourly_rate_minor"),
    /** The invoice this billable time was billed on (null = not billed yet). */
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("time_tenant_member_date_idx").on(t.tenantId, t.membershipId, t.date),
    index("time_tenant_project_idx").on(t.tenantId, t.projectId),
  ],
);

export const files = pgTable(
  "files",
  {
    id: pk(),
    tenantId: tenantRef(),
    entityType: text("entity_type", { enum: ["project", "client", "transaction", "general"] }).notNull(),
    entityId: uuid("entity_id"),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    clientVisible: boolean("client_visible").notNull().default(false),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("files_tenant_entity_idx").on(t.tenantId, t.entityType, t.entityId)],
);

export const comments = pgTable(
  "comments",
  {
    id: pk(),
    tenantId: tenantRef(),
    entityType: text("entity_type", { enum: ["project", "task"] }).notNull(),
    entityId: uuid("entity_id").notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    clientVisible: boolean("client_visible").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("comments_entity_idx").on(t.tenantId, t.entityType, t.entityId, t.createdAt)],
);

/** Hourly rate per member, used for project profitability. */
export const memberRates = pgTable("member_rates", {
  membershipId: uuid("membership_id")
    .primaryKey()
    .references(() => memberships.id, { onDelete: "cascade" }),
  costRateMinor: money("cost_rate_minor"),
  billRateMinor: money("bill_rate_minor"),
});
