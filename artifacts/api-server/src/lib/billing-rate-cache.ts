/**
 * billing-rate-cache.ts — Runtime-configurable credits-per-second billing rate.
 *
 * Reads the billing rate from the `settings` table (key: `billing_credits_per_sec`).
 * Falls back to BILLING_RATE_FALLBACK (5 cr/s) if no override is set or the DB
 * is unreachable.
 *
 * IMPORTANT: The billing rate is ENTIRELY SEPARATE from DECART_API_COST_PER_SEC.
 *   - Billing rate  → admin-controlled, affects retail revenue / wallet drain ONLY
 *   - API cost rate → DECART_API_COST_PER_SEC = 2.3 cr/s (fixed, analytics only)
 *   These two values MUST NEVER be mixed or aliased together.
 *
 * PATCH SPEC (DYNAMIC BILLING RATE SYNC — CRITICAL):
 *   Billing rate MUST be fetched live from the admin Billing Rate Monitor.
 *   It MUST NOT be cached. Any change MUST instantly reflect in:
 *     - Stream Ledger (license_key grouped)
 *     - Wallet Monitor (license_key grouped)
 *     - Reconciliation engine
 *     - Profit calculation engine
 *
 * Usage:
 *   const rate = await getBillingRate();
 *   const licenceIncrement = Math.round(rawSec * rate / 2);
 *
 * The "/2" denominator is the original baseline rate (2 credits/sec).  Any
 * value stored in the DB is the new credits-per-second target; the formula
 * automatically scales licence drain relative to that baseline:
 *   rate = 2  → 1× (original speed)
 *   rate = 5  → 2.5× faster  ($0.05/sec, $180/hr)
 *   rate = 10 → 5× faster    ($0.10/sec, $360/hr)
 *
 * NOTE: billing rate affects REVENUE ONLY — not streaming speed.
 * Streaming duration is controlled ONLY by wallet allocation.
 */

import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SETTING_KEY = "billing_credits_per_sec";

/**
 * Safe fallback billing rate used when the DB is unreachable or no setting exists.
 * This is the BILLING rate (admin revenue control) — completely separate from
 * DECART_API_COST_PER_SEC (2.3 cr/s) which is the fixed infrastructure cost rate.
 */
const BILLING_RATE_FALLBACK = 5;

/**
 * Returns the active billing rate (credits/sec).
 * Fetched live from the DB on every call — NO cache.
 * This ensures billing rate changes reflect instantly across all dashboards.
 *
 * NOTE: This rate is for RETAIL REVENUE only. For API cost calculations,
 * use DECART_API_COST_PER_SEC (2.3 cr/s) from billing-math.ts — never this value.
 */
export async function getBillingRate(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, SETTING_KEY));

    const parsed = row ? parseInt(row.value, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : BILLING_RATE_FALLBACK;
  } catch {
    return BILLING_RATE_FALLBACK;
  }
}

/**
 * No-op kept for backward compatibility — caching is disabled per patch spec.
 * Billing rate changes must reflect instantly; no invalidation needed.
 */
export function invalidateBillingRateCache(): void {
  // No-op: caching removed per patch spec (dynamic billing rate sync)
}
