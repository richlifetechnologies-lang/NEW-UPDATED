-- 0004_decart_session_id.sql
-- Adds decart_session_id to sessions for Decart SDK cross-reference tracking.
-- Idempotent: IF NOT EXISTS guards make it safe to re-run.

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "decart_session_id" VARCHAR(255);

CREATE INDEX IF NOT EXISTS "idx_sessions_decart_session_id"
  ON "sessions"("decart_session_id");
