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
 * PER-LICENSE BILLING RATE (additive):
 *   getBillingRateForLicense(licenseKeyId) returns the EFFECTIVE rate for a key:
 *   - If the key has use_custom_billing_rate = true AND custom_billing_rate IS NOT NULL
 *     → returns custom_billing_rate (NEVER falls back during active session)
 *   - Otherwise → returns global billing rate from settings table
 *
 * PATCH SPEC (DYNAMIC BILLING RATE SYNC — CRITICAL):
 *   Billing rate MUST be fetched live from the admin Billing Rate Monitor.
 *   It MUST NOT be cached. Any change MUST instantly reflect in:
 *     - Stream Ledger (license_key grouped)
 *     - Wallet Monitor (license_key grouped)
 *     - Reconciliation engine
 *     - Profit calculation engine
 */

import { db, settingsTable, licenseKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SETTING_KEY = "billing_credits_per_sec";

/**
 * Safe fallback billing rate used when the DB is unreachable or no setting exists.
 * This is the BILLING rate (admin revenue control) — completely separate from
 * DECART_API_COST_PER_SEC (2.3 cr/s) which is the fixed infrastructure cost rate.
 */
const BILLING_RATE_FALLBACK = 5;

/**
 * Returns the active GLOBAL billing rate (credits/sec).
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

    const parsed = row ? parseFloat(row.value) : NaN;
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : BILLING_RATE_FALLBACK;
  } catch {
    return BILLING_RATE_FALLBACK;
  }
}

/**
 * Returns the EFFECTIVE billing rate for a specific license key.
 *
 * Priority rule (spec §1):
 *   1. If license.use_custom_billing_rate = true AND license.custom_billing_rate IS NOT NULL
 *      → use custom_billing_rate ONLY (NEVER fall back to global during an active session)
 *   2. Otherwise → use global billing rate from settings table
 *
 * Safe fallback (spec §12): if custom rate lookup fails entirely, falls back to global rate.
 *
 * @param licenseKeyId  The integer PK of the license key (license_keys.id)
 * @returns Effective billing rate in cr/s
 */
export async function getBillingRateForLicense(licenseKeyId: number | null | undefined): Promise<number> {
  if (licenseKeyId == null) return getBillingRate();
  try {
    const [row] = await db
      .select({
        customBillingRate:    licenseKeysTable.customBillingRate,
        useCustomBillingRate: licenseKeysTable.useCustomBillingRate,
      })
      .from(licenseKeysTable)
      .where(eq(licenseKeysTable.id, licenseKeyId));

    if (row?.useCustomBillingRate && row.customBillingRate != null && row.customBillingRate >= 1) {
      return row.customBillingRate;
    }
  } catch {
    // safe fallback to global rate on any DB error
  }
  return getBillingRate();
}

/**
 * No-op kept for backward compatibility — caching is disabled per patch spec.
 * Billing rate changes must reflect instantly; no invalidation needed.
 */
export function invalidateBillingRateCache(): void {
  // No-op: caching removed per patch spec (dynamic billing rate sync)
}
