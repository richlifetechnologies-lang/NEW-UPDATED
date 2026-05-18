/**
 * billing-rate-cache.ts — Runtime-configurable credits-per-second billing rate.
 *
 * Reads the override from the `settings` table (key: `billing_credits_per_sec`).
 * Falls back to DECART_CREDITS_PER_SEC if no override is set or the DB is
 * unreachable.  Cached in memory for 60 seconds to avoid a DB round-trip on
 * every heartbeat.
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
 */

import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { DECART_CREDITS_PER_SEC } from "./billing-math";

const SETTING_KEY  = "billing_credits_per_sec";
const CACHE_TTL_MS = 60_000;

let cached: { rate: number; expiresAt: number } | null = null;

/**
 * Returns the active billing rate (credits/sec).
 * Reads from the DB at most once per minute.
 */
export async function getBillingRate(): Promise<number> {
  const now = Date.now();
  if (cached && now < cached.expiresAt) return cached.rate;

  try {
    const [row] = await db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, SETTING_KEY));

    const parsed = row ? parseInt(row.value, 10) : NaN;
    const rate   = Number.isFinite(parsed) && parsed >= 1 ? parsed : DECART_CREDITS_PER_SEC;
    cached = { rate, expiresAt: now + CACHE_TTL_MS };
    return rate;
  } catch {
    if (cached) return cached.rate;
    return DECART_CREDITS_PER_SEC;
  }
}

/**
 * Call after a successful PUT /admin/billing-rate so the next heartbeat
 * picks up the new value immediately without waiting for the cache to expire.
 */
export function invalidateBillingRateCache(): void {
  cached = null;
}
