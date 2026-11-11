DROP INDEX "profit_rule_approvals_rule_idx";--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profit_rule_approvals_rule_partner_uq" ON "profit_rule_approvals" USING btree ("rule_id","partner_id");--> statement-breakpoint
CREATE INDEX "transactions_tenant_to_account_idx" ON "transactions" USING btree ("tenant_id","to_account_id");--> statement-breakpoint
CREATE INDEX "transactions_tenant_partner_idx" ON "transactions" USING btree ("tenant_id","partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_reverses_uq" ON "transactions" USING btree ("reverses_id") WHERE "transactions"."reverses_id" is not null;