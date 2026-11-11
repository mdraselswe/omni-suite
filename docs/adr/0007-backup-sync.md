# 7. One-way backup to Google Sheets and JSON in Drive

## Decision

- The owner connects Google Drive with the `drive.file` scope only (the app sees just the files it created). Tokens are encrypted with AES-256-GCM (`ENCRYPTION_KEY`).
- Every write adds a `sync_outbox` row in the same transaction. The worker runs every minute: it groups pending rows by entity and **rewrites that entity's tab** in the tenant's spreadsheet (header + all rows), then marks the rows done.
- Nightly: a full JSON snapshot (`latest.json` plus `daily/YYYY-MM-DD.json`, 30 kept) with `schemaVersion`, importable back through the app.
- The sheet is labelled read-only. Edits there are never read back.
- Real backups remain `pg_dump` (see deployment docs); the sheet is for people and portability.

## Why

Two-way sync of financial data creates conflicts with no safe winner. Rewriting a whole tab is simpler and more robust than row-level patching and is well within Sheets limits for a small business. Per-tab rewrites only happen for tabs that changed.
