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

  // All enum values the billing event logger can emit.
  // ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent and safe to re-run.
  // CRITICAL: This statement CANNOT run inside a transaction block (PostgreSQL limitation).
  // We use a dedicated pool.connect() call and never wrap these in BEGIN/COMMIT.
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
   * Runs BEFORE the Drizzle migration system to guarantee columns exist
   * even if the Drizzle journal previously recorded a migration as applied
   * without actually executing the SQL.
   *
   * Each statement is run individually (pg rejects multi-statement queries).
   * If a table doesn't exist yet (e.g. created later by migrations), its
   * fixes are skipped with a warning — they will be applied on the next startup
   * after migrations have created the table.
   *
   * Never aborts startup — column fix errors are warnings, not fatals.
   *
   * Also ensures billing_event_type enum has all required values.
   * The session_billing_events table is created via drizzle-kit push, not migrations,
   * so the enum may be missing values added after the initial push — causing silent
   * insert failures in logSessionBillingEvent (heartbeat_ok = 0 in audit trail).
   */
  export async function applyColumnFixes(): Promise<void> {
    const client = await pool.connect();
    try {
      // ── Column additions ─────────────────────────────────────────────────────
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

      // ── billing_event_type enum sync ─────────────────────────────────────────
      // Checks whether the enum exists first; if the session_billing_events table
      // was never pushed to this DB the enum won't exist yet — skip gracefully.
      // ALTER TYPE ... ADD VALUE must run outside a transaction (PostgreSQL rule).
      // pool.connect() auto-commits each query, satisfying that requirement.
      try {
        const enumCheck = await client.query(
          `SELECT 1 FROM pg_type WHERE typname = 'billing_event_type' LIMIT 1`
        );
        if (enumCheck.rowCount && enumCheck.rowCount > 0) {
          for (const value of BILLING_EVENT_ENUM_VALUES) {
            try {
              await client.query(
                `ALTER TYPE billing_event_type ADD VALUE IF NOT EXISTS '${value}'`
              );
            } catch (err: unknown) {
              const msg = (err as Error)?.message ?? String(err);
              console.error(`[applyColumnFixes] billing_event_type ADD VALUE '${value}' failed:`, msg);
            }
          }
          console.log("[applyColumnFixes] billing_event_type enum synced ✓");
        } else {
          console.warn("[applyColumnFixes] billing_event_type enum not found — session_billing_events table not yet pushed to this DB");
        }
      } catch (err: unknown) {
        const msg = (err as Error)?.message ?? String(err);
        console.error("[applyColumnFixes] enum sync check failed:", msg);
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
  