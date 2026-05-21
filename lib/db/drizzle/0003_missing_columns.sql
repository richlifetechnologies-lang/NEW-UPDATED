-- 0003_missing_columns.sql
-- Adds all columns introduced in recent schema updates that are missing from the live DB.
-- All statements use IF NOT EXISTS / safe defaults so they are idempotent.

-- ── users table ──────────────────────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sub_admin_billing_rate" real;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "default_token_window_minutes" real;

-- ── license_keys table ───────────────────────────────────────────────────────
ALTER TABLE "license_keys" ADD COLUMN IF NOT EXISTS "custom_billing_rate" real;
ALTER TABLE "license_keys" ADD COLUMN IF NOT EXISTS "use_custom_billing_rate" boolean DEFAULT false;
ALTER TABLE "license_keys" ADD COLUMN IF NOT EXISTS "billing_rate_last_updated_at" timestamp;
ALTER TABLE "license_keys" ADD COLUMN IF NOT EXISTS "token_window_minutes" real;
ALTER TABLE "license_keys" ADD COLUMN IF NOT EXISTS "is_new_key" boolean DEFAULT false;

-- ── license_wallet table ─────────────────────────────────────────────────────
ALTER TABLE "license_wallet" ADD COLUMN IF NOT EXISTS "session_billable_seconds" integer DEFAULT 0;
ALTER TABLE "license_wallet" ADD COLUMN IF NOT EXISTS "api_cost_credits" real DEFAULT 0;
ALTER TABLE "license_wallet" ADD COLUMN IF NOT EXISTS "retail_credits" real DEFAULT 0;
