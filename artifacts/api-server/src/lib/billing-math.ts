/**
 * billing-math.ts — Pure billing math functions for Full Swap by Rich.
 *
 * ALL billing-critical logic lives here as pure functions (no DB, no I/O).
 * This makes them trivially testable and portable across hosting platforms.
 *
 * ── Constants ──────────────────────────────────────────────────────────────
 *   DECART_CREDITS_PER_SEC  = 5   (Lucy 2.1 charges 5 credits/second)
 *   DECART_CREDITS_PER_MIN  = 300 (5 × 60)
 *   MINIMUM_RESERVATION_SEC = 1   (reserved at session creation)
 *   HEARTBEAT_GRACE_MS      = 35_000  — max gap before a heartbeat is "late"
 *   ORPHAN_GRACE_MS         = 120_000 — no heartbeat for 2 min → orphan kill
 *   DEDUCTION_FREEZE_MS     = 45_000
 *
 * DO NOT change these values without updating Decart's actual billing contract.
 */

export const DECART_CREDITS_PER_SEC  = 5;
export const DECART_CREDITS_PER_MIN  = DECART_CREDITS_PER_SEC * 60; // 300
export const MINIMUM_RESERVATION_SEC = 1;
export const HEARTBEAT_GRACE_MS      = 35_000;
export const ORPHAN_GRACE_MS         = 120_000; // 2 minutes — orphan kill threshold
export const SWEEP_INTERVAL_MS       = 10_000;
export const SINGLE_SESSION_GRACE_MS = 5_000;
export const DEDUCTION_FREEZE_MS     = 45_000;

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
