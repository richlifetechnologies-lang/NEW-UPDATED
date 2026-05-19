/**
 * billing-math.ts — Pure billing math functions for Full Swap by Rich.
 *
 * ALL billing-critical logic lives here as pure functions (no DB, no I/O).
 * This makes them trivially testable and portable across hosting platforms.
 *
 * ── Constants ──────────────────────────────────────────────────────────────
 *   DECART_CREDITS_PER_SEC       = 5     (Lucy 2.1 charges 5 credits/second)
 *   DECART_CREDITS_PER_MIN       = 300   (5 × 60)
 *   DECART_API_COST_PER_SEC      = 5     (SAME as DECART_CREDITS_PER_SEC — Decart's
 *                                         actual charge is 5 cr/s, used for analytics)
 *   MINIMUM_RESERVATION_SEC      = 1     (reserved at session creation)
 *   HEARTBEAT_GRACE_MS           = 35_000  — max gap before a heartbeat is "late"
 *   ORPHAN_GRACE_MS              = 120_000 — no heartbeat for 2 min → orphan kill
 *   DEDUCTION_FREEZE_MS          = 45_000
 *
 * ── Billing math truth table ────────────────────────────────────────────────
 *   Decart charges:   5 cr/s (Lucy 2.1 — this is the actual API cost)
 *   Admin billing rate (r): stored in settings table, fetched via getBillingRate()
 *   Retail credits:   billableSeconds × r   (≈ what the user's wallet pays)
 *   API cost credits: billableSeconds × 5   (what we pay Decart)
 *   Profit:           billableSeconds × (r − 5)
 *
 *   At r = 5  → profit =  0  (breakeven)
 *   At r = 7  → profit = +2 cr/s per second (profitable)
 *   At r = 3  → profit = −2 cr/s per second (loss)
 *
 * DO NOT change DECART_CREDITS_PER_SEC without updating Decart's actual billing
 * contract. This value represents the FIXED Decart API cost (5 cr/s from Lucy 2.1).
 *
 * The admin-configurable billing rate (credits drained from the licence wallet) is
 * stored separately in the `settings` table and retrieved via getBillingRate().
 */

export const DECART_CREDITS_PER_SEC   = 5;
export const DECART_CREDITS_PER_MIN   = DECART_CREDITS_PER_SEC * 60; // 300
/**
 * Actual Decart API cost rate used for analytics and profit calculations.
 * This EQUALS DECART_CREDITS_PER_SEC (5 cr/s) because that IS the real Decart
 * charge per second. A previous patch incorrectly set this to 2.3 which caused
 * all profit/margin numbers to appear inflated. Fixed to reflect true values.
 */
export const DECART_API_COST_PER_SEC  = DECART_CREDITS_PER_SEC; // 5 cr/s
export const MINIMUM_RESERVATION_SEC  = 1;
export const HEARTBEAT_GRACE_MS       = 35_000;
export const ORPHAN_GRACE_MS          = 120_000; // 2 minutes — orphan kill threshold
export const SWEEP_INTERVAL_MS        = 10_000;
export const SINGLE_SESSION_GRACE_MS  = 5_000;
export const DEDUCTION_FREEZE_MS      = 45_000;

// ── Session settle math ────────────────────────────────────────────────────

/**
 * Derive billed seconds from Decart's exact generationTick count.
 * Each tick = 1 Decart-billed second = DECART_CREDITS_PER_SEC credits.
 *
 * @param creditsConsumed   Total credits from generationTick × 5
 * @param alreadyBilledSec  Seconds already charged before this settlement
 */
export function creditBasedIncrement(creditsConsumed: number, alreadyBilledSec: number): {
  incrementSec: number;
  totalDuration: number;
} {
  const totalDuration = Math.ceil(creditsConsumed / DECART_CREDITS_PER_SEC);
  const incrementSec  = Math.max(0, totalDuration - alreadyBilledSec);
  return { incrementSec, totalDuration };
}

/**
 * Derive billed seconds from wall-clock timestamps (fallback when ticks unavailable).
 *
 * @param endAtMs     Epoch ms when session ended
 * @param lastDebitMs Epoch ms of last deduction (billing anchor)
 * @param billingStartMs Epoch ms when billing began
 */
export function wallClockIncrement(endAtMs: number, lastDebitMs: number, billingStartMs: number): {
  incrementSec: number;
  totalDuration: number;
} {
  const incrementSec  = Math.max(0, Math.floor((endAtMs - lastDebitMs) / 1000));
  const totalDuration = Math.floor((endAtMs - billingStartMs) / 1000);
  return { incrementSec, totalDuration };
}

/**
 * Apply minimum reservation guarantee — every session bills at least
 * MINIMUM_RESERVATION_SEC so analytics never show 0-second sessions.
 */
export function applyMinimumDuration(duration: number): number {
  return Math.max(duration, MINIMUM_RESERVATION_SEC);
}

/**
 * Cap the deduction to the license's remaining balance.
 */
export function calculateDebit(incrementSec: number, remainingSec: number): number {
  return Math.min(Math.max(0, incrementSec), Math.max(0, remainingSec));
}

/**
 * Remaining seconds on a license key.
 */
export function licenseRemainingSeconds(minutesAllocated: number, usedSeconds: number): number {
  return Math.max(0, Math.round(minutesAllocated * 60) - usedSeconds);
}

// ── Normalised analytics billing math ─────────────────────────────────────
//
// DESIGN RULE (LICENSE-KEY BASED ARCHITECTURE):
//
//   ALL calculations MUST be grouped by license_key — NOT user_id, session_id,
//   or device_id. license_key is the ONLY billing identity.
//
//   SOURCE OF TRUTH: wallet.used_seconds (= session.duration_seconds aggregated
//   per license_key). NEVER use wall-clock time, compute_seconds, or fragmented
//   session time.
//
//   billableSeconds  = wallet.used_seconds per license_key
//                    = SUM(session.duration_seconds) per license_key
//   apiCostCredits   = billableSeconds × DECART_API_COST_PER_SEC  (5 cr/s — actual Decart charge)
//   retailCredits    = billableSeconds × dynamicBillingRate
//   profit           = retailCredits − apiCostCredits
//                    = billableSeconds × (dynamicRate − 5)
//
//   At billing rate = 5  → profit = 0  (breakeven — costs exactly what Decart charges)
//   At billing rate > 5  → profit > 0  (surplus)
//   At billing rate < 5  → profit < 0  (loss)
//
//   BILLING RATE MODEL:
//   - Higher rate = more revenue per second (economic value only)
//   - Lower rate  = less revenue per second
//   - Stream duration is NOT controlled by billing rate
//   - Streaming duration is controlled ONLY by wallet allocation
//
//   The dynamicBillingRate is ALWAYS fetched live from the DB via getBillingRate()
//   — NEVER hardcoded, NEVER cached stale. Any change MUST reflect instantly in:
//     Stream Ledger, Wallet Monitor, Reconciliation engine, Profit calculation.

/**
 * Convert wallet billable seconds to normalised analytics metrics.
 *
 * SOURCE OF TRUTH: billableSeconds = wallet.used_seconds per license_key.
 * NEVER pass wall-clock duration, compute_seconds, or fragmented session time.
 *
 * API cost uses DECART_API_COST_PER_SEC (2.3 cr/s safe rate) — NOT billing rate.
 * Retail revenue uses dynamicRate (live from admin billing rate monitor).
 * Both use the SAME billableSeconds denominator → no fake negative profit.
 *
 * @param billableSeconds  wallet.used_seconds — the license-key source of truth
 * @param dynamicRate      live billing rate from getBillingRate() — admin-controlled,
 *                         affects revenue ONLY, not streaming speed or wallet deduction
 */
export function computeNormalisedMetrics(billableSeconds: number, dynamicRate: number): {
  apiCostCredits: number;
  retailCredits: number;
  retailSeconds: number;
  profitCredits: number;
  effectiveCreditsPerSec: number;
} {
  // API cost: billableSeconds × 2.3 cr/s (safe Decart rate — analytics only)
  // NEVER use billing rate for API cost; NEVER use session duration or compute_seconds
  const apiCostCredits  = Math.round(billableSeconds * DECART_API_COST_PER_SEC * 100) / 100;

  // Retail revenue: billableSeconds × billingRate ÷ 2 (admin-controlled rate)
  // billing rate affects revenue ONLY — stream duration is controlled by wallet
  const retailSeconds   = Math.round(billableSeconds * dynamicRate / 2);
  const retailCredits   = retailSeconds * 2;

  // Profit per license_key: retail - api_cost (both use identical time source)
  const profitCredits   = Math.round((retailCredits - apiCostCredits) * 100) / 100;

  const effectiveCreditsPerSec = billableSeconds > 0
    ? Math.round((retailCredits / billableSeconds) * 100) / 100
    : 0;

  return { apiCostCredits, retailCredits, retailSeconds, profitCredits, effectiveCreditsPerSec };
}

// ── Credit tracker math ───────────────────────────────────────────────────

/**
 * Compute Decart credits consumed by a key since its last topup baseline.
 * Uses wall-clock time (started_at → stopped_at) to match Decart's actual billing,
 * which starts from connect() initiation, not from the first remote frame.
 *
 * @param wallClockSeconds  SUM of (stopped_at - started_at) for all completed sessions
 * @param liveSeconds       SUM of (NOW - started_at) for all active sessions
 * @param creditsBaseline   Credits baked in at topup time (already accounted for)
 */
export function calculateCreditsUsedSinceTopup(
  wallClockSeconds: number,
  liveSeconds: number,
  creditsBaseline: number
): number {
  const totalCredits = (wallClockSeconds + liveSeconds) * DECART_CREDITS_PER_SEC;
  return Math.max(0, totalCredits - creditsBaseline);
}

/**
 * Remaining Decart credits for a key.
 *
 * @param totalCreditsLoaded  Credits entered via topup (the balance at topup time)
 * @param creditsUsedSinceTopup  From calculateCreditsUsedSinceTopup()
 */
export function calculateCreditsRemaining(
  totalCreditsLoaded: number,
  creditsUsedSinceTopup: number
): number {
  return Math.max(0, totalCreditsLoaded - creditsUsedSinceTopup);
}

/**
 * Convert seconds to a human-readable duration string.
 * Uses floor-based math so 1.5 min displays as "1m 30s", not rounded "2m".
 */
export function fmtMin(m: number): string {
  if (m === 0) return "0m";
  const totalSec = Math.round(m * 60);
  if (totalSec < 60) return `${totalSec}s`;
  const h   = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (h > 0 && min === 0 && sec === 0) return `${h}h`;
  if (h > 0) return sec > 0 ? `${h}h ${min}m ${sec}s` : `${h}h ${min}m`;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

/**
 * Convert credits to minutes (display helper).
 */
export function creditsToMinutes(credits: number): number {
  return credits / DECART_CREDITS_PER_MIN;
}

/**
 * Convert minutes to Decart credits.
 */
export function minutesToCredits(minutes: number): number {
  return minutes * DECART_CREDITS_PER_MIN;
}
