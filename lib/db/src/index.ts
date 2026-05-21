import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
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
];

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
 */
export async function applyColumnFixes(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const [table, column, ddl] of COLUMN_FIXES) {
      try {
        await client.query(
          `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${ddl}`
        );
      } catch (err: unknown) {
        const msg = (err as Error)?.message ?? String(err);
        if (msg.includes("does not exist")) {
          // Table not yet created — migrations will create it; skip silently
          console.warn(`[applyColumnFixes] skipping ${table}.${column}: ${msg}`);
        } else {
          // Unexpected error — log but don't abort
          console.error(`[applyColumnFixes] ${table}.${column} failed:`, msg);
        }
      }
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
  const migrationsFolder = path.join(process.cwd(), "lib/db/drizzle");
  await migrate(db, { migrationsFolder });
}

export * from "./schema";
