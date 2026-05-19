/**
 * migrate-billing-rate-per-key.ts
 *
 * Additive migration: adds 3 new nullable columns to the license_keys table.
 * SAFE to run against production — all columns are nullable/default false,
 * so existing rows are unaffected and all existing queries continue to work.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts run migrate:billing-rate-per-key
 *
 * Idempotent: uses IF NOT EXISTS guards on each ALTER TABLE statement.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("[migrate] Adding per-license billing rate columns to license_keys…");

  // custom_billing_rate — nullable real, admin-assigned credits/sec for this key
  await db.execute(sql`
    ALTER TABLE license_keys
    ADD COLUMN IF NOT EXISTS custom_billing_rate REAL
  `);
  console.log("[migrate] ✓ custom_billing_rate");

  // use_custom_billing_rate — boolean default false
  //   When true, this key uses custom_billing_rate instead of global rate
  await db.execute(sql`
    ALTER TABLE license_keys
    ADD COLUMN IF NOT EXISTS use_custom_billing_rate BOOLEAN NOT NULL DEFAULT FALSE
  `);
  console.log("[migrate] ✓ use_custom_billing_rate");

  // billing_rate_last_updated_at — nullable timestamp
  //   Tracks when the custom rate was last set/changed for this key
  await db.execute(sql`
    ALTER TABLE license_keys
    ADD COLUMN IF NOT EXISTS billing_rate_last_updated_at TIMESTAMP
  `);
  console.log("[migrate] ✓ billing_rate_last_updated_at");

  console.log("[migrate] Done. Per-license billing rate columns added successfully.");
  console.log("[migrate] All existing rows default to: custom_billing_rate=NULL, use_custom_billing_rate=FALSE");
  console.log("[migrate] No wallet, session, or stream data was modified.");
  process.exit(0);
}

main().catch(err => {
  console.error("[migrate] FAILED:", err);
  process.exit(1);
});
