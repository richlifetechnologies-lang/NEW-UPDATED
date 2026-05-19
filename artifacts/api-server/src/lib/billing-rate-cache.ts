/**
 * billing-rate-cache.ts — Runtime-configurable credits-per-second billing rate.
 *
 * Reads the override from the `settings` table (key: `billing_credits_per_sec`).
 * Falls back to DECART_CREDITS_PER_SEC if no override is set or the DB is
 * unreachable.
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
import { DECART_CREDITS_PER_SEC } from "./billing-math";

const SETTING_KEY = "billing_credits_per_sec";

/**
 * Returns the active billing rate (credits/sec).
 * Fetched live from the DB on every call — NO cache.
 * This ensures billing rate changes reflect instantly across all dashboards.
 */
export async function getBillingRate(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, SETTING_KEY));

    const parsed = row ? parseInt(row.value, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : DECART_CREDITS_PER_SEC;
  } catch {
    return DECART_CREDITS_PER_SEC;
  }
}

/**
 * No-op kept for backward compatibility — caching is disabled per patch spec.
 * Billing rate changes must reflect instantly; no invalidation needed.
 */
export function invalidateBillingRateCache(): void {
  // No-op: caching removed per patch spec (dynamic billing rate sync)
}
