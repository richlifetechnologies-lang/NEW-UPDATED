/**
 * billing-rate-cache.ts — Runtime-configurable credits-per-second billing rate.
 *
 * Reads the billing rate from the `settings` table (key: `billing_credits_per_sec`).
 *
 * SPEC §6 — NO hardcoded pricing constants:
 *   No "5 cr/s" or "3 cr/s" fallback. If DB is unavailable, use the last
 *   successfully-read value from this process. If no value has ever been read
 *   (cold start with DB unreachable), log an error and throw — billing must not
 *   silently use a wrong constant.
 *
 * SPEC §8 — Real-time sync:
 *   Billing rate is fetched live from the DB on EVERY call — NO cache TTL.
 *   Any admin change propagates instantly to all consumers.
 *
 * SPEC §9 — Safety:
 *   If DB fails mid-stream, fall back to the last-known DB rate so streaming
 *   is never interrupted by a transient DB blip. This is still DB-driven
 *   (the value originated from DB), not a hardcoded constant.
 *
 * IMPORTANT: The billing rate is ENTIRELY SEPARATE from DECART_API_COST_PER_SEC.
 *   - Billing rate  → admin-controlled, affects retail revenue calculation ONLY
 *   - API cost rate → DECART_API_COST_PER_SEC = 2.3 cr/s (fixed, analytics only)
 *   These two values MUST NEVER be mixed or aliased together.
 *
 * PER-LICENSE BILLING RATE (spec §1 — single source of truth):
 *   effective_rate = custom_billing_rate (if enabled) OR global_billing_rate
 *   getBillingRateForLicense(licenseKeyId) MUST be used in all billing paths.
 */

import { db, settingsTable, licenseKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const SETTING_KEY = "billing_credits_per_sec";

/**
 * Last successfully-read global billing rate from the DB.
 * Updated on every successful DB read. Used as fallback if DB is temporarily unreachable.
 * This is NOT a hardcoded constant — it is a DB-sourced value cached in memory.
 * Starts as null (unknown) until first successful DB read.
 */
let _lastKnownGlobalRate: number | null = null;

/**
 * Returns the active GLOBAL billing rate (credits/sec).
 * Fetched live from the DB on every call — NO cache TTL.
 *
 * Fallback hierarchy (spec §6/§9):
 *   1. Live value from DB  (preferred — always)
 *   2. Last-known DB value from this process (if DB temporarily unreachable)
 *   3. Throws — no hardcoded constant (spec §6)
 *
 * NOTE: For per-license effective rate, always use getBillingRateForLicense().
 * This global rate is only the fallback when no custom rate is set.
 */
export async function getBillingRate(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, SETTING_KEY));

    const parsed = row ? parseFloat(row.value) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0.1) {
      _lastKnownGlobalRate = parsed;
      return parsed;
    }

    // DB row exists but value is invalid — fall through to last-known
    logger.warn({ value: row?.value }, "[BillingRate] DB rate invalid, using last-known");
  } catch (err) {
    logger.warn({ err }, "[BillingRate] DB unreachable, using last-known rate");
  }

  // Spec §9: last-known DB rate (still DB-sourced, not a hardcoded constant)
  if (_lastKnownGlobalRate !== null) {
    return _lastKnownGlobalRate;
  }

  // Spec §6: DO NOT return a hardcoded pricing constant.
  // If we reach here, billing cannot safely continue — caller must handle.
  const msg = "[BillingRate] CRITICAL: No billing rate in DB and no last-known rate. " +
    "Set 'billing_credits_per_sec' in the settings table via the admin billing panel.";
  logger.error(msg);
  throw new Error("BILLING_RATE_UNAVAILABLE: No billing rate available from DB");
}

/**
 * Returns the EFFECTIVE billing rate for a specific license key.
 *
 * Spec §1 — Single source of truth:
 *   effective_rate =
 *     IF license.use_custom_billing_rate = true AND license.custom_billing_rate >= 0.1
 *       THEN custom_billing_rate   (never falls back to global during active session)
 *       ELSE global_billing_rate
 *
 * Spec §9 — Safety: if custom rate lookup fails, falls back to global rate.
 * This is the ONLY function that should be called in billing paths.
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

    if (row?.useCustomBillingRate && row.customBillingRate != null && row.customBillingRate >= 0.1) {
      return row.customBillingRate;
    }
  } catch (err) {
    logger.warn({ err, licenseKeyId }, "[BillingRate] custom rate lookup failed, falling back to global");
  }
  return getBillingRate();
}

/**
 * No-op kept for backward compatibility — caching is disabled per spec §8.
 * Billing rate changes propagate instantly via live DB reads.
 */
export function invalidateBillingRateCache(): void {
  // No-op: caching removed per spec §8 (real-time sync)
}
