-- Client portal AI assistant: the new permission for client roles of businesses that already
-- exist (new ones get it from the catalog). Clients only see it once the business turns the
-- assistant on for them in Settings → AI assistant (off by default).
INSERT INTO "role_permissions" ("role_id", "permission", "scope")
SELECT r."id", 'portal.assistant', 'all'
FROM "roles" r
WHERE r."is_system" AND r."key" IN ('client_owner', 'client_member')
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "tenants" SET "permissions_version" = "permissions_version" + 1;
