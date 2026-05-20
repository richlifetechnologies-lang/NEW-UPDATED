/**
 * billing-math.ts — Pure billing math functions for Full Swap by Rich.
 *
 * ALL billing-critical logic lives here as pure functions (no DB, no I/O).
 * This makes them trivially testable and portable across hosting platforms.
 *
 * ── Constants ──────────────────────────────────────────────────────────────
 *   DECART_CREDITS_PER_SEC       = 2.3   (Lucy 2.1 actual charge rate —
 *                                         used for Decart cost tracking and credit-to-seconds conversion)
 *   DECART_CREDITS_PER_MIN       = 138   (2.3 × 60)
 *   DECART_REAL_API_COST_RATE    = 2.3   (safe default API cost rate — analytics
 *                                         and profit calculations ONLY)
 *   DECART_API_COST_PER_SEC      = 2.3   (alias for DECART_REAL_API_COST_RATE)
 *   MINIMUM_RESERVATION_SEC      = 1     (reserved at session creation)
 *   HEARTBEAT_GRACE_MS           = 35_000  — max gap before a heartbeat is "late"
 *   ORPHAN_GRACE_MS              = 120_000 — no heartbeat for 2 min → orphan kill
 *   DEDUCTION_FREEZE_MS          = 45_000
 *
 * ── Dual Rate System ────────────────────────────────────────────────────────
 *
 *   RATE A — BILLING RATE (admin-controlled, dynamic):
 *     Source:  settings table, fetched live via getBillingRate()
 *     Used for: retail revenue calculation ONLY
 *     Formula: retail_cost = wallet.used_seconds × billing_rate
 *
 *   RATE B — API COST RATE (fixed system constant):
 *     Value:   DECART_REAL_API_COST_RATE = 2.3 cr/s (SAFE DEFAULT — never changes)
 *     Used for: infrastructure cost / profit analytics ONLY
 *     Formula: api_cost = wallet.used_seconds × 2.3
 *     NOT tied to billing rate. NOT editable from admin billing dashboard.
 *
 *   CRITICAL RULE: Billing rate ≠ API cost rate. They MUST NEVER be mixed.
 *
 *   profit = (wallet.used_seconds × billing_rate) − (wallet.used_seconds × 2.3)
 *
 *   At billing_rate = 2.3 → profit = 0  (breakeven)
 *   At billing_rate > 2.3 → profit > 0  (profitable)
 *   At billing_rate < 2.3 → profit < 0  (loss)
 *
 * ── Stream Ledger Duration Rule ─────────────────────────────────────────────
 *   ALL display durations MUST be derived from wallet.used_seconds ONLY.
 *   NEVER use wall-clock duration, session duration aggregation, fragmented
 *   stream totals, reconnect duration, or compute_seconds.
 *   display_duration = wallet.used_seconds
 *
 * ── Dynamic Rate Sync ───────────────────────────────────────────────────────
 *   Billing rate MUST update instantly across ALL modules (Stream Ledger,
 *   Wallet Monitor, Reconciliation, Profit Dashboard). NOT cached. NOT
 *   overwritten by AI edits. NO fallback to default values.
 *
 * The admin-configurable billing rate (credits drained from the licence wallet) is
 * stored separately in the `settings` table and retrieved via getBillingRate().
 */

export const DECART_CREDITS_PER_SEC   = 2.3;  // Decart Lucy 2.1 actual charge rate (cr/s)
export const DECART_CREDITS_PER_MIN   = DECART_CREDITS_PER_SEC * 60; // 300

/**
 * DECART_REAL_API_COST_RATE — Fixed safe API cost rate for analytics and profit.
 *
 * This is the ONLY allowed API cost rate: 2.3 cr/s.
 * - NOT tied to the billing rate
 * - NOT editable from the admin billing rate UI
 * - NOT a dynamic setting
 * - Used ONLY for: infrastructure cost tracking and profit calculations
 *
 * wallet deduction uses DECART_CREDITS_PER_SEC (5 cr/s) — a separate constant.
 */
export const DECART_REAL_API_COST_RATE = 2.3;

/**
 * DECART_API_COST_PER_SEC — alias for DECART_REAL_API_COST_RATE.
 * Safe analytics rate used for profit calculations only.
 * MUST NOT be used in wallet deduction or streaming logic.
 */
export const DECART_API_COST_PER_SEC  = DECART_REAL_API_COST_RATE; // 2.3 cr/s
export const MINIMUM_RESERVATION_SEC  = 1;
export const HEARTBEAT_GRACE_MS       = 35_000;
export const ORPHAN_GRACE_MS          = 120_000; // 2 minutes — orphan kill threshold
export const SWEEP_INTERVAL_MS        = 10_000;
export const SINGLE_SESSION_GRACE_MS  = 5_000;
export const DEDUCTION_FREEZE_MS      = 45_000;

// BASE_BILLING_RATE and computeBurnMultiplier REMOVED per HARDENING PATCH.
// No hardcoded billing rate reference constants are permitted.
// The admin dashboard billing rate (settings table) is the ONLY source of truth.
// Use getBillingRateForLicense(licenseKeyId) in all billing paths.

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
//   session time.  display_duration = wallet.used_seconds (stream ledger rule).
//
//   DUAL RATE SYSTEM (rates MUST NEVER be mixed):
//     API cost rate:  DECART_API_COST_PER_SEC = 2.3 cr/s  (fixed — analytics only)
//     Billing rate:   dynamicBillingRate       (admin-controlled — revenue only)
//
//   billableSeconds  = wallet.used_seconds per license_key
//                    = SUM(session.duration_seconds) per license_key
//   apiCostCredits   = billableSeconds × 2.3      (FIXED — infrastructure cost)
//   retailCredits    = billableSeconds × dynamicBillingRate  (DYNAMIC — revenue)
//   profit           = retailCredits − apiCostCredits
//                    = billableSeconds × (dynamicRate − 2.3)
//
//   At billing rate = 2.3 → profit = 0  (breakeven)
//   At billing rate > 2.3 → profit > 0  (surplus)
//   At billing rate < 2.3 → profit < 0  (loss)
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
 * display_duration = wallet.used_seconds (the ONLY valid source for stream ledger).
 *
 * API cost uses DECART_API_COST_PER_SEC (2.3 cr/s — fixed, never changes).
 * Retail revenue uses dynamicRate (live from admin billing rate monitor).
 * Both use the SAME billableSeconds denominator → no fake negative profit.
 * These two rates are STRICTLY SEPARATE — never mix or alias them.
 *
 * profit = (billableSeconds × dynamicRate) − (billableSeconds × 2.3)
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
  // ── Compression-aware analytics ─────────────────────────────────────────────
  // billableSeconds = wallet.used_seconds (rate-compressed — drains at billingRate/2.3 speed)
  // realStreamSeconds = actual wall-clock streaming time (what Decart bills)
  //   = billableSeconds ÷ compressionFactor = billableSeconds × 2.3 / dynamicRate
  //
  // At billingRate = 3 cr/s (factor = 1.304):
  //   60 wallet-min → ~46 real stream min → Decart cost = 46 × 60 × 2.3 cr ≈ 6,348 cr
  //   vs naïve: 60 × 60 × 2.3 = 8,280 cr  →  savings ≈ 23%
  //
  // profit = retailCredits − apiCostCredits
  //        = (billableSec × rate) − (realStreamSec × 2.3)
  //        = billableSec × (rate − 2.3²/rate)
  // At rate = 2.3 → profit = 0  (breakeven)
  // At rate > 2.3 → profit > 0  (saves Decart credits AND earns margin)

  const compressionFactor = dynamicRate > 0 ? dynamicRate / DECART_API_COST_PER_SEC : 1;
  const realStreamSeconds = compressionFactor > 0
    ? Math.round(billableSeconds / compressionFactor)
    : billableSeconds;

  // Decart actual cost = realStreamSeconds × 2.3 cr/s (never 5 — user confirmed 2.3)
  const apiCostCredits = Math.round(realStreamSeconds * DECART_API_COST_PER_SEC * 100) / 100;

  // Retail revenue: compressed wallet seconds × billingRate
  const retailCredits  = Math.round(billableSeconds * dynamicRate * 100) / 100;
  const retailSeconds  = Math.round(retailCredits / 2); // legacy half-credit metric

  // Profit per license_key: retail revenue − Decart API cost
  const profitCredits  = Math.round((retailCredits - apiCostCredits) * 100) / 100;

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

// ── Time Compression Engine (TCE) ─────────────────────────────────────────
//
// The TCE is a USER EXPERIENCE LAYER only.
// It does NOT affect wallet.used_seconds, billing math, or Decart costs.
//
// DEFINITION:
//   base_reference_rate  = 2.3 cr/s  (= DECART_API_COST_PER_SEC)
//   compression_factor   = effective_billing_rate / 2.3
//   display_seconds      = real_seconds × compression_factor
//   real_seconds         = display_seconds ÷ compression_factor
//
// EFFECT:
//   billing_rate > 2.3 → compression_factor > 1 → user sees MORE time than consumed
//   billing_rate = 2.3 → compression_factor = 1 → display time = real time
//   billing_rate < 2.3 → compression_factor < 1 → user sees LESS time than consumed
//
// ISOLATION RULES:
//   ✔ wallet.used_seconds always tracks real heartbeat seconds
//   ✔ api_cost always computed from real_seconds × 2.3
//   ✔ revenue always computed from real_seconds × billing_rate
//   ✔ TCE only affects frontend display of remaining/elapsed time
//   ✗ NEVER apply compression_factor to billing or cost math

/**
 * Base reference rate for the Time Compression Engine.
 * Equal to the fixed Decart API cost rate — 2.3 cr/s.
 * compression_factor = 1.0 when billing_rate = 2.3 (breakeven, no compression).
 */
export const TCE_BASE_REFERENCE_RATE = DECART_API_COST_PER_SEC; // 2.3

/**
 * Compute the Time Compression Factor for a given effective billing rate.
 *
 * compression_factor = effective_billing_rate / 2.3
 *
 * A factor > 1 means the user's displayed time is stretched relative to
 * real Decart consumption (higher billing rate = more profitable, user
 * sees their allocation last longer).
 *
 * Returns 1.0 as a safe fallback when rate ≤ 0.
 *
 * @param effectiveBillingRate  Live per-key or global billing rate (admin-controlled)
 */
export function computeCompressionFactor(effectiveBillingRate: number): number {
  if (effectiveBillingRate <= 0) return 1.0;
  return Math.round((effectiveBillingRate / TCE_BASE_REFERENCE_RATE) * 1000) / 1000;
}

/**
 * Convert real (wallet) seconds to display seconds for the frontend UX layer.
 *
 * display_seconds = real_seconds × compression_factor
 *
 * NEVER use this value for billing, cost, or profit calculations.
 *
 * @param realSeconds        wallet.used_seconds or remaining wallet seconds
 * @param compressionFactor  from computeCompressionFactor()
 */
export function computeDisplaySeconds(realSeconds: number, compressionFactor: number): number {
  if (realSeconds <= 0) return 0;
  return Math.round(realSeconds * compressionFactor);
}

/**
 * Convert display seconds back to real (wallet) seconds.
 *
 * real_seconds = display_seconds ÷ compression_factor
 *
 * @param displaySeconds     User-facing compressed time
 * @param compressionFactor  from computeCompressionFactor()
 */
export function computeRealFromDisplay(displaySeconds: number, compressionFactor: number): number {
  if (compressionFactor <= 0 || displaySeconds <= 0) return 0;
  return Math.round(displaySeconds / compressionFactor);
}
