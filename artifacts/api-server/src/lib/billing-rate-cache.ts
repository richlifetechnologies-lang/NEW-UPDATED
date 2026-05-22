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
 * SPEC §8 — Near-real-time sync:
 *   PATCH-04 adds a 5-second micro-cache (< one heartbeat interval = 10s) to
 *   reduce DB query pressure at high session concurrency without sacrificing
 *   meaningful real-time sync. Admin billing rate changes propagate within
 *   ≤15s (5s TTL + 10s heartbeat cycle). Call invalidateBillingRateCache()
 *   from admin billing-rate change routes to force immediate propagation.
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

import { db, settingsTable, licenseKeysTable, usersTable } from "@workspace/db";
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

// ── PATCH-04: 5-second micro-cache ─────────────────────────────────────────
// Reduces DB query load at high heartbeat concurrency (20 sessions × 10s = 2 queries/s
// for global rate alone before this patch). 5s TTL < one heartbeat interval (10s).
const RATE_CACHE_TTL_MS = 5_000;
let _globalRateCache: { rate: number; expiresAt: number } | null = null;
const _licenseRateCache = new Map<number, { rate: number; expiresAt: number }>();

/**
 * Returns the active GLOBAL billing rate (credits/sec).
 * Micro-cached for 5s to reduce DB pressure. Falls back to last-known value on DB error.
 *
 * Fallback hierarchy (spec §6/§9):
 *   1. Micro-cache (< 5s old)           (fastest path)
 *   2. Live value from DB               (preferred — authoritative)
 *   3. Last-known DB value from process (if DB temporarily unreachable)
 *   4. Throws — no hardcoded constant   (spec §6)
 *
 * NOTE: For per-license effective rate, always use getBillingRateForLicense().
 * This global rate is only the fallback when no custom rate is set.
 */
export async function getBillingRate(): Promise<number> {
  // ── PATCH-04: micro-cache check ──────────────────────────────────────────
  if (_globalRateCache && _globalRateCache.expiresAt > Date.now()) return _globalRateCache.rate;

  try {
    const [row] = await db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, SETTING_KEY));

    const parsed = row ? parseFloat(row.value) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0.1) {
      _lastKnownGlobalRate = parsed;
      _globalRateCache = { rate: parsed, expiresAt: Date.now() + RATE_CACHE_TTL_MS };
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
 * Core resolution logic for per-license billing rate (uncached).
 * Three-tier resolution (spec §1): license custom → sub-admin → global.
 * Extracted so the public function can wrap it with the PATCH-04 micro-cache.
 */
async function _getBillingRateForLicenseUncached(licenseKeyId: number): Promise<number> {
  try {
    // ── Tier 1: license custom rate ─────────────────────────────────────────
    const [row] = await db
      .select({
        customBillingRate:      licenseKeysTable.customBillingRate,
        useCustomBillingRate:   licenseKeysTable.useCustomBillingRate,
        createdBySubAdminId:    licenseKeysTable.createdBySubAdminId,
      })
      .from(licenseKeysTable)
      .where(eq(licenseKeysTable.id, licenseKeyId));

    if (row?.useCustomBillingRate && row.customBillingRate != null && row.customBillingRate >= 0.1) {
      // License has an explicit override — use it, no further lookup needed
      return row.customBillingRate;
    }

    // ── Tier 2: sub-admin billing rate override ──────────────────────────────
    const subAdminId = row?.createdBySubAdminId;
    if (subAdminId != null) {
      const [saRow] = await db
        .select({ subAdminBillingRate: usersTable.subAdminBillingRate })
        .from(usersTable)
        .where(eq(usersTable.id, subAdminId))
        .limit(1);
      const saRate = saRow?.subAdminBillingRate;
      if (saRate != null && Number.isFinite(Number(saRate)) && Number(saRate) >= 0.1) {
        logger.debug({ licenseKeyId, subAdminId, subAdminRate: saRate }, "[BillingRate] using sub-admin rate override");
        return Number(saRate);
      }
    }
  } catch (err) {
    logger.warn({ err, licenseKeyId }, "[BillingRate] rate lookup failed, falling back to global");
  }

  // ── Tier 3: global billing rate ─────────────────────────────────────────────
  return getBillingRate();
}

/**
 * Returns the EFFECTIVE billing rate for a specific license key.
 * Micro-cached for 5s (PATCH-04) to reduce heartbeat DB pressure.
 *
 * Three-tier resolution order (spec §1 — single source of truth):
 *   1. license.custom_billing_rate   — when use_custom_billing_rate = true (highest priority)
 *   2. sub-admin billing rate        — the rate assigned to the sub-admin who created this key
 *   3. global billing rate           — system default (lowest priority)
 *
 * Spec §9 — Safety: any tier lookup failure falls through to the next tier / global.
 * This is the ONLY function that should be called in billing paths.
 *
 * @param licenseKeyId  The integer PK of the license key (license_keys.id)
 * @returns Effective billing rate in cr/s
 */
export async function getBillingRateForLicense(licenseKeyId: number | null | undefined): Promise<number> {
  if (licenseKeyId == null) return getBillingRate();

  // ── PATCH-04: micro-cache check ──────────────────────────────────────────
  const cached = _licenseRateCache.get(licenseKeyId);
  if (cached && cached.expiresAt > Date.now()) return cached.rate;

  const rate = await _getBillingRateForLicenseUncached(licenseKeyId);
  _licenseRateCache.set(licenseKeyId, { rate, expiresAt: Date.now() + RATE_CACHE_TTL_MS });
  return rate;
}

/**
 * Invalidate the billing rate micro-cache.
 * Call from admin routes when the billing rate is changed so the new rate
 * propagates immediately rather than waiting for the 5s TTL to expire.
 *
 * @param licenseKeyId  If provided, invalidates only that license's cached rate.
 *                      If omitted, invalidates all cached rates (global + all licenses).
 */
export function invalidateBillingRateCache(licenseKeyId?: number): void {
  if (licenseKeyId != null) {
    _licenseRateCache.delete(licenseKeyId);
  } else {
    _licenseRateCache.clear();
    _globalRateCache = null;
  }
}
