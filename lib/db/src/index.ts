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

/**
 * Directly applies missing column additions via raw SQL.
 * Runs BEFORE the Drizzle migration system on every startup.
 * All statements use IF NOT EXISTS / safe defaults — completely idempotent.
 *
 * This bypasses the Drizzle migration tracker entirely, guaranteeing the
 * columns exist even if the Drizzle journal previously recorded them as
 * applied without actually executing the SQL.
 */
export async function applyColumnFixes(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      -- users table
      ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_admin_billing_rate real;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS default_token_window_minutes real;

      -- license_keys table
      ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS custom_billing_rate real;
      ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS use_custom_billing_rate boolean DEFAULT false;
      ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS billing_rate_last_updated_at timestamp;
      ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS token_window_minutes real;
      ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS is_new_key boolean DEFAULT false;

      -- license_wallet table
      ALTER TABLE license_wallet ADD COLUMN IF NOT EXISTS session_billable_seconds integer DEFAULT 0;
      ALTER TABLE license_wallet ADD COLUMN IF NOT EXISTS api_cost_credits real DEFAULT 0;
      ALTER TABLE license_wallet ADD COLUMN IF NOT EXISTS retail_credits real DEFAULT 0;
    `);
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
