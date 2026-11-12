CREATE TABLE "rate_counters" (
	"key" text NOT NULL,
	"bucket" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_counters_key_bucket_pk" PRIMARY KEY("key","bucket")
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "bound_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "last_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "capital_contributions" ADD COLUMN "ownership_event_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "to_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "tax_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "base_tax_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "contact_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "written_off_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "written_off_date" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reminder_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "next_reminder_on" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "prices_include_tax" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "follow_up_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "prices_include_tax" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "decline_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN "anchor_day" integer;--> statement-breakpoint
CREATE INDEX "rate_counters_expires_idx" ON "rate_counters" USING btree ("expires_at");
--> statement-breakpoint
-- Existing documents keep the tax setting the business had when they were made.
UPDATE "invoices" SET "prices_include_tax" = COALESCE(("tenants"."settings"->'tax'->>'pricesIncludeTax')::boolean, false) FROM "tenants" WHERE "tenants"."id" = "invoices"."tenant_id";
--> statement-breakpoint
UPDATE "proposals" SET "prices_include_tax" = COALESCE(("tenants"."settings"->'tax'->>'pricesIncludeTax')::boolean, false) FROM "tenants" WHERE "tenants"."id" = "proposals"."tenant_id";
--> statement-breakpoint
-- Recurring schedules bill on the day they were set up for.
UPDATE "recurring_invoices" SET "anchor_day" = EXTRACT(DAY FROM "next_run_date")::int WHERE "anchor_day" IS NULL;
