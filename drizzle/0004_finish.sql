CREATE TABLE "invoice_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text,
	"date" date NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"refund_payment_id" uuid,
	"reason" text DEFAULT '' NOT NULL,
	"voided_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"date" date NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" text NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"category_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"file_key" text,
	"file_name" text,
	"file_mime" text,
	"file_size" integer,
	"voided_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "credited_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_adjustments_invoice_idx" ON "invoice_adjustments" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_adjustments_number_uq" ON "invoice_adjustments" USING btree ("tenant_id","number") WHERE "invoice_adjustments"."number" is not null;--> statement-breakpoint
CREATE INDEX "bill_payments_bill_idx" ON "bill_payments" USING btree ("tenant_id","bill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_payments_transaction_uq" ON "bill_payments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "bills_tenant_due_idx" ON "bills" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "bills_tenant_supplier_idx" ON "bills" USING btree ("tenant_id","supplier");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_share_token_uq" ON "invoices" USING btree ("share_token");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_share_token_uq" ON "proposals" USING btree ("share_token");
--> statement-breakpoint
-- Earlier write-offs become dated adjustment rows (statements read these).
INSERT INTO "invoice_adjustments" ("id", "tenant_id", "invoice_id", "kind", "date", "amount_minor", "tax_minor", "reason")
SELECT gen_random_uuid(), "tenant_id", "id", 'write_off', COALESCE("written_off_date", "issue_date"), "written_off_minor", 0, ''
FROM "invoices" WHERE "written_off_minor" > 0;
--> statement-breakpoint
-- Bills (payables): new permissions for businesses that already exist (new ones get them from the catalog).
INSERT INTO "role_permissions" ("role_id", "permission", "scope")
SELECT r."id", p.permission, 'all'
FROM "roles" r
CROSS JOIN (VALUES ('bills.read'), ('bills.write')) AS p(permission)
WHERE r."is_system" AND r."key" IN ('owner', 'admin')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission", "scope")
SELECT r."id", 'bills.read', 'all'
FROM "roles" r
WHERE r."is_system" AND r."key" = 'accountant'
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "tenants" SET "permissions_version" = "permissions_version" + 1;
