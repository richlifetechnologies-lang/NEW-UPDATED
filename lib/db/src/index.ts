import { drizzle } from "drizzle-orm/node-postgres";
  import { migrate } from "drizzle-orm/node-postgres/migrator";
  import pg from "pg";
  import path from "path";
  import { fileURLToPath } from "url";
  import { existsSync } from "fs";
  import * as schema from "./schema";

  const { Pool } = pg;

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }

  export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  export const db = drizzle(pool, { schema });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  // Each entry: [table, column, DDL-suffix]
  // Run individually — pg rejects multi-statement queries.
  // Skipped silently if the table doesn't exist yet (migrations will create it).
  const COLUMN_FIXES: [string, string, string][] = [
    ["users",           "sub_admin_billing_rate",        "real"],
    ["users",           "default_token_window_minutes",  "real"],
    ["license_keys",    "custom_billing_rate",            "real"],
    ["license_keys",    "use_custom_billing_rate",        "boolean DEFAULT false"],
    ["license_keys",    "billing_rate_last_updated_at",   "timestamp"],
    ["license_keys",    "token_window_minutes",           "real"],
    ["license_keys",    "is_new_key",                     "boolean DEFAULT false"],
    ["license_wallet",  "session_billable_seconds",       "integer DEFAULT 0"],
    ["license_wallet",  "api_cost_credits",               "real DEFAULT 0"],
    ["license_wallet",  "retail_credits",                 "real DEFAULT 0"],
    ["sessions",        "decart_session_id",              "VARCHAR(255)"],
    // LEAK-07: persist pool cooldown across restarts
    ["decart_api_keys", "cooldown_until",                 "timestamp"],
  ];

  // All values for billing_event_type enum — kept in sync with session-billing-events.ts schema.
  const BILLING_EVENT_ENUM_VALUES = [
    "token_issued",
    "token_cache_hit",
    "token_cache_miss",
    "connect",
    "stream_start",
    "heartbeat_ok",
    "heartbeat_exhausted",
    "hard_kill",
    "settle",
    "startup_orphan_kill",
    "disconnect",
    "stop",
    "orphan_kill",
    "freeze_kill",
    "ai_explanation_generated",
  ] as const;

  /**
   * Applies missing column additions via raw SQL on every startup.
   *
   * ALSO creates the session_billing_events table + billing_event_type enum if they
   * don't exist. This table is managed by drizzle-kit push, not SQL migrations, so
   * on a fresh Railway deploy it may never have been created — causing every
   * logSessionBillingEvent insert to silently fail (heartbeatCount=0 in audit trail,
   * no stop/settle events, etc.).
   *
   * All statements are idempotent (IF NOT EXISTS / ADD VALUE IF NOT EXISTS).
   * Never aborts startup — errors are warnings, not fatals.
   *
   * IMPORTANT: ALTER TYPE ... ADD VALUE must run outside a transaction block (PostgreSQL
   * limitation). pool.connect() auto-commits individual .query() calls, satisfying that.
   */
  export async function applyColumnFixes(): Promise<void> {
    const client = await pool.connect();
    try {
      // ── 1. Column additions ───────────────────────────────────────────────────
      for (const [table, column, ddl] of COLUMN_FIXES) {
        try {
          await client.query(
            `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${ddl}`
          );
        } catch (err: unknown) {
          const msg = (err as Error)?.message ?? String(err);
          if (msg.includes("does not exist")) {
            console.warn(`[applyColumnFixes] skipping ${table}.${column}: ${msg}`);
          } else {
            console.error(`[applyColumnFixes] ${table}.${column} failed:`, msg);
          }
        }
      }

      // ── 2. Ensure billing_event_type enum exists ──────────────────────────────
      // The session_billing_events table is managed by drizzle-kit push, not SQL
      // migrations. On a fresh DB it may never have been created. We create the enum
      // and table here so logSessionBillingEvent never silently fails.
      try {
        // Create enum if it doesn't exist (PL/pgSQL anonymous block for IF NOT EXISTS)
        await client.query(`
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_event_type') THEN
              CREATE TYPE billing_event_type AS ENUM (
                'token_issued', 'token_cache_hit', 'token_cache_miss',
                'connect', 'stream_start',
                'heartbeat_ok', 'heartbeat_exhausted',
                'hard_kill', 'settle', 'startup_orphan_kill',
                'disconnect', 'stop', 'orphan_kill', 'freeze_kill',
                'ai_explanation_generated'
              );
            END IF;
          END $$
        `);
        console.log("[applyColumnFixes] billing_event_type enum ready ✓");
      } catch (err: unknown) {
        console.error("[applyColumnFixes] billing_event_type enum creation failed:", (err as Error)?.message ?? String(err));
      }

      // ── 3. Add any missing enum values (for deployments that already had the enum) ──
      // ALTER TYPE ... ADD VALUE cannot run inside a transaction — pool.connect() auto-commits.
      for (const value of BILLING_EVENT_ENUM_VALUES) {
        try {
          await client.query(
            `ALTER TYPE billing_event_type ADD VALUE IF NOT EXISTS '${value}'`
          );
        } catch (err: unknown) {
          const msg = (err as Error)?.message ?? String(err);
          // "cannot be executed from a function" only happens inside an explicit txn — safe to warn
          if (!msg.includes("cannot be executed from a function")) {
            console.error(`[applyColumnFixes] billing_event_type ADD VALUE '${value}' failed:`, msg);
          }
        }
      }

      // ── 4. Create session_billing_events table if it doesn't exist ────────────
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS session_billing_events (
            id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
            session_id  TEXT            NOT NULL,
            decart_session_id TEXT,
            event_type  billing_event_type NOT NULL,
            wallet_remaining_seconds INTEGER,
            token_window_seconds     INTEGER,
            cost_snapshot            REAL,
            metadata                 JSONB,
            created_at  TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_sbe_session_id         ON session_billing_events(session_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_sbe_decart_session_id  ON session_billing_events(decart_session_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_sbe_event_type         ON session_billing_events(event_type)`);
        console.log("[applyColumnFixes] session_billing_events table ready ✓");
      } catch (err: unknown) {
        console.error("[applyColumnFixes] session_billing_events table creation failed:", (err as Error)?.message ?? String(err));
      }

    } finally {
      client.release();
    }
  }

  /**
   * Runs all pending Drizzle migrations from lib/db/drizzle/.
   * Safe to call on every startup — already-applied migrations are skipped.
   */
  export async function runMigrations(): Promise<void> {
    // Resolve the drizzle folder robustly regardless of cwd or bundle location.
    // When esbuild bundles lib/db into the API server bundle, import.meta.url
    // points to artifacts/api-server/dist/index.mjs (3 levels below workspace root).
    // When lib/db/dist/index.js runs standalone, it's 2 levels below workspace root.
    // We try all candidate paths and use the first one that actually exists.
    const _thisDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(_thisDir, "../../../lib/db/drizzle"),   // from bundled API server dist
      path.resolve(_thisDir, "../drizzle"),                 // from lib/db/dist standalone
      path.resolve(process.cwd(), "lib/db/drizzle"),        // from workspace root cwd
    ];
    const migrationsFolder = candidates.find(p => existsSync(p)) ?? candidates[2]!;
    await migrate(db, { migrationsFolder });
  }

  export * from "./schema";
  