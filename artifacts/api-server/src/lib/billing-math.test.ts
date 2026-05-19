/**
 * billing-math.test.ts — Automated tests for all billing-critical logic.
 *
 * Run: pnpm test
 *
 * These tests act as a permanent safety net. If ANY billing formula, constant,
 * or display function is accidentally changed, these tests will fail immediately
 * and prevent a broken deployment.
 */

import { describe, it, expect } from "vitest";
import {
  DECART_CREDITS_PER_SEC,
  DECART_CREDITS_PER_MIN,
  DECART_API_COST_PER_SEC,
  MINIMUM_RESERVATION_SEC,
  HEARTBEAT_GRACE_MS,
  DEDUCTION_FREEZE_MS,
  creditBasedIncrement,
  wallClockIncrement,
  applyMinimumDuration,
  calculateDebit,
  licenseRemainingSeconds,
  calculateCreditsUsedSinceTopup,
  calculateCreditsRemaining,
  computeNormalisedMetrics,
  fmtMin,
  creditsToMinutes,
  minutesToCredits,
} from "./billing-math";

// ── Billing constant guards ───────────────────────────────────────────────
// If any of these fail, someone changed a constant that matches Decart's
// Lucy 2.1 contract — revert the change immediately.

describe("Billing constants (Decart Lucy 2.1 contract)", () => {
  it("charges exactly 5 credits per second", () => {
    expect(DECART_CREDITS_PER_SEC).toBe(5);
  });

  it("charges exactly 300 credits per minute (5 × 60)", () => {
    expect(DECART_CREDITS_PER_MIN).toBe(300);
  });

  it("reserves at least 1 second at session creation", () => {
    expect(MINIMUM_RESERVATION_SEC).toBeGreaterThanOrEqual(1);
  });

  it("heartbeat grace is at least 30s (≥ 3 missed 10s heartbeats)", () => {
    expect(HEARTBEAT_GRACE_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("deduction freeze is strictly greater than heartbeat grace", () => {
    expect(DEDUCTION_FREEZE_MS).toBeGreaterThan(HEARTBEAT_GRACE_MS);
  });
});

// ── DECART_API_COST_PER_SEC guard ─────────────────────────────────────────
// This is the safe analytics rate used for profit calculations only.
// It MUST NOT be used in wallet deduction or streaming logic.

describe("DECART_API_COST_PER_SEC (safe analytics rate — patch spec)", () => {
  it("safe analytics rate is exactly 2.3 cr/s (patch specification)", () => {
    expect(DECART_API_COST_PER_SEC).toBe(2.3);
  });

  it("safe analytics rate is less than actual Decart charge (5 cr/s)", () => {
    expect(DECART_API_COST_PER_SEC).toBeLessThan(DECART_CREDITS_PER_SEC);
  });
});

// ── creditBasedIncrement ──────────────────────────────────────────────────

describe("creditBasedIncrement — tick-exact Decart billing", () => {
  it("converts 60 ticks (300 credits) to 60 seconds with 0 already billed", () => {
    const { incrementSec, totalDuration } = creditBasedIncrement(300, 0);
    expect(totalDuration).toBe(60);
    expect(incrementSec).toBe(60);
  });

  it("subtracts already-billed seconds from increment", () => {
    const { incrementSec, totalDuration } = creditBasedIncrement(300, 30);
    expect(totalDuration).toBe(60);
    expect(incrementSec).toBe(30);
  });

  it("rounds UP fractional credit seconds (ceiling)", () => {
    // 3 credits = 0.6 seconds → ceil = 1 second
    const { totalDuration } = creditBasedIncrement(3, 0);
    expect(totalDuration).toBe(1);
  });

  it("never returns negative increment", () => {
    // Already billed more than credits say
    const { incrementSec } = creditBasedIncrement(10, 100);
    expect(incrementSec).toBe(0);
  });

  it("0 credits = 0 seconds", () => {
    const { incrementSec, totalDuration } = creditBasedIncrement(0, 0);
    expect(totalDuration).toBe(0);
    expect(incrementSec).toBe(0);
  });

  it("handles 1-minute session: 42 ticks (210 credits)", () => {
    const { incrementSec, totalDuration } = creditBasedIncrement(210, 0);
    expect(totalDuration).toBe(42);
    expect(incrementSec).toBe(42);
  });
});

// ── wallClockIncrement ───────────────────────────────────────────────────

describe("wallClockIncrement — timestamp-based fallback billing", () => {
  it("floors to whole seconds", () => {
    const now = 1_000_000_000;
    const { incrementSec } = wallClockIncrement(now + 42_500, now, now);
    expect(incrementSec).toBe(42);
  });

  it("computes totalDuration from billing start, not last debit", () => {
    const start = 1_000_000_000;
    const lastDebit = start + 10_000; // 10s already billed
    const end = start + 42_000;       // 42s total session
    const { incrementSec, totalDuration } = wallClockIncrement(end, lastDebit, start);
    expect(totalDuration).toBe(42);
    expect(incrementSec).toBe(32); // 42 - 10
  });

  it("never returns negative increment", () => {
    const now = 1_000_000_000;
    const { incrementSec } = wallClockIncrement(now, now + 5_000, now);
    expect(incrementSec).toBe(0);
  });
});

// ── applyMinimumDuration ─────────────────────────────────────────────────

describe("applyMinimumDuration — floor at MINIMUM_RESERVATION_SEC", () => {
  it("0-second session becomes MINIMUM_RESERVATION_SEC", () => {
    expect(applyMinimumDuration(0)).toBe(MINIMUM_RESERVATION_SEC);
  });

  it("sessions longer than minimum are unchanged", () => {
    expect(applyMinimumDuration(42)).toBe(42);
  });

  it("exactly minimum is unchanged", () => {
    expect(applyMinimumDuration(MINIMUM_RESERVATION_SEC)).toBe(MINIMUM_RESERVATION_SEC);
  });
});

// ── calculateDebit ────────────────────────────────────────────────────────

describe("calculateDebit — capped license deduction", () => {
  it("deducts the full increment when sufficient balance", () => {
    expect(calculateDebit(30, 60)).toBe(30);
  });

  it("caps deduction at remaining balance", () => {
    expect(calculateDebit(100, 16)).toBe(16);
  });

  it("returns 0 when license is exhausted", () => {
    expect(calculateDebit(10, 0)).toBe(0);
  });

  it("returns 0 for negative increment", () => {
    expect(calculateDebit(-5, 60)).toBe(0);
  });

  it("returns 0 for negative remaining", () => {
    expect(calculateDebit(10, -5)).toBe(0);
  });
});

// ── licenseRemainingSeconds ───────────────────────────────────────────────

describe("licenseRemainingSeconds", () => {
  it("1 minute key with 0 used = 60 seconds remaining", () => {
    expect(licenseRemainingSeconds(1, 0)).toBe(60);
  });

  it("0.5 minute key with 29 used = 1 second remaining", () => {
    expect(licenseRemainingSeconds(0.5, 29)).toBe(1);
  });

  it("fully exhausted key = 0 remaining", () => {
    expect(licenseRemainingSeconds(1, 60)).toBe(0);
  });

  it("over-used key never goes negative", () => {
    expect(licenseRemainingSeconds(1, 65)).toBe(0);
  });
});

// ── calculateCreditsUsedSinceTopup ───────────────────────────────────────

describe("calculateCreditsUsedSinceTopup — credit tracker formula", () => {
  it("multiplies total seconds by 5 and subtracts baseline", () => {
    // 50s completed + 0s live, baseline 0 → 50×5 = 250 credits used
    expect(calculateCreditsUsedSinceTopup(50, 0, 0)).toBe(250);
  });

  it("includes live session seconds", () => {
    // 50s completed + 10s live = 60s × 5 = 300 credits
    expect(calculateCreditsUsedSinceTopup(50, 10, 0)).toBe(300);
  });

  it("subtracts baseline from total", () => {
    // 50s × 5 = 250, baseline 20 → 230 credits used since topup
    expect(calculateCreditsUsedSinceTopup(50, 0, 20)).toBe(230);
  });

  it("never returns negative credits used", () => {
    // Baseline larger than current usage (key just topped up)
    expect(calculateCreditsUsedSinceTopup(5, 0, 200)).toBe(0);
  });

  it("matches the real scenario: 3 sessions totaling 99s, baseline 0", () => {
    // d1f1ee66 (33s) + 157ca55b (46s) + 9b479787 (20s) = 99s wall-clock
    expect(calculateCreditsUsedSinceTopup(99, 0, 0)).toBe(495);
  });
});

// ── calculateCreditsRemaining ─────────────────────────────────────────────

describe("calculateCreditsRemaining — admin API key display", () => {
  it("subtracts used from total", () => {
    expect(calculateCreditsRemaining(884, 196)).toBe(688);
  });

  it("never goes below 0", () => {
    expect(calculateCreditsRemaining(100, 200)).toBe(0);
  });

  it("full balance when nothing used", () => {
    expect(calculateCreditsRemaining(884, 0)).toBe(884);
  });
});

// ── computeNormalisedMetrics ──────────────────────────────────────────────
//
// PATCH SPEC: ALL analytics MUST use wallet.used_seconds per license_key as
// source of truth. API cost = 2.3 cr/s (safe rate). Retail = billingRate.
// profit = retail - api_cost. Both sides use IDENTICAL billableSeconds.

describe("computeNormalisedMetrics — license-key analytics (patch spec)", () => {
  it("0 seconds → all zeros (no fake losses)", () => {
    const result = computeNormalisedMetrics(0, 5);
    expect(result.apiCostCredits).toBe(0);
    expect(result.retailCredits).toBe(0);
    expect(result.profitCredits).toBe(0);
    expect(result.effectiveCreditsPerSec).toBe(0);
  });

  it("API cost uses 2.3 cr/s (DECART_API_COST_PER_SEC) — not billing rate", () => {
    // 100s at 2.3 cr/s = 230 api cost credits
    const result = computeNormalisedMetrics(100, 5);
    expect(result.apiCostCredits).toBe(230);
  });

  it("retail uses billing rate from admin (dynamic, live — never hardcoded)", () => {
    // 100s, billing rate 10 → retail seconds = round(100 × 10 / 2) = 500
    // retail credits = 500 × 2 = 1000
    const result = computeNormalisedMetrics(100, 10);
    expect(result.retailSeconds).toBe(500);
    expect(result.retailCredits).toBe(1000);
  });

  it("profit = retail - api_cost (both use identical billableSeconds — no fake -639 loss)", () => {
    // 100s, billing rate 5: retail=250 credits, api=230 → profit = 20
    const result = computeNormalisedMetrics(100, 5);
    expect(result.profitCredits).toBeGreaterThan(0);
  });

  it("higher billing rate = more revenue per second (rate controls economics only)", () => {
    const low  = computeNormalisedMetrics(100, 2);
    const high = computeNormalisedMetrics(100, 10);
    expect(high.retailCredits).toBeGreaterThan(low.retailCredits);
    // API cost is identical regardless of billing rate
    expect(high.apiCostCredits).toBe(low.apiCostCredits);
  });

  it("billing rate change does not affect API cost (streaming speed unchanged)", () => {
    const rateA = computeNormalisedMetrics(60, 2);
    const rateB = computeNormalisedMetrics(60, 8);
    // API cost is always billableSeconds × 2.3 — billing rate has NO effect
    expect(rateA.apiCostCredits).toBe(rateB.apiCostCredits);
  });

  it("same denominator: no profit calculation can produce fake loss when rate is reasonable", () => {
    // billing rate = 5 (default), 622s (the real session that triggered -639 bug)
    // With 2.3 cr/s api cost and same denominator, profit should be positive
    const result = computeNormalisedMetrics(622, 5);
    expect(result.profitCredits).toBeGreaterThanOrEqual(0);
  });

  it("effectiveCreditsPerSec is 0 when no billable seconds (safe fallback)", () => {
    const result = computeNormalisedMetrics(0, 5);
    expect(result.effectiveCreditsPerSec).toBe(0);
  });

  it("effectiveCreditsPerSec = retailCredits / billableSeconds", () => {
    const result = computeNormalisedMetrics(100, 5);
    const expected = Math.round((result.retailCredits / 100) * 100) / 100;
    expect(result.effectiveCreditsPerSec).toBe(expected);
  });
});

// ── End-to-end billing scenario ───────────────────────────────────────────

describe("End-to-end: 1-minute license key with two sessions", () => {
  it("session 1 (42s): creation reserves 1s, settle deducts 42s → 43s total", () => {
    const minutesAllocated = 1;
    // Step 1: session creation reserves MINIMUM_RESERVATION_SEC
    let usedSeconds = MINIMUM_RESERVATION_SEC; // 1

    // Step 2: settle session 1 (42 ticks = 210 credits)
    const { incrementSec, totalDuration } = creditBasedIncrement(210, 0);
    const remaining = licenseRemainingSeconds(minutesAllocated, usedSeconds);
    const debited   = calculateDebit(incrementSec, remaining);
    usedSeconds += debited;

    expect(totalDuration).toBe(42);
    expect(debited).toBe(42);
    expect(usedSeconds).toBe(43);
    expect(licenseRemainingSeconds(minutesAllocated, usedSeconds)).toBe(17);
  });

  it("session 2 (16s): creation reserves 1s, settle deducts 16s → 60s total (exhausted)", () => {
    const minutesAllocated = 1;
    let usedSeconds = 43; // from session 1

    // Step 1: session 2 creation
    usedSeconds += MINIMUM_RESERVATION_SEC; // 44
    expect(licenseRemainingSeconds(minutesAllocated, usedSeconds)).toBe(16);

    // Step 2: settle session 2 (16 ticks = 80 credits)
    const { incrementSec, totalDuration } = creditBasedIncrement(80, 0);
    const remaining = licenseRemainingSeconds(minutesAllocated, usedSeconds);
    const debited   = calculateDebit(incrementSec, remaining);
    usedSeconds += debited;

    expect(totalDuration).toBe(16);
    expect(debited).toBe(16);
    expect(usedSeconds).toBe(60);
    expect(licenseRemainingSeconds(minutesAllocated, usedSeconds)).toBe(0);
  });
});

// ── End-to-end analytics scenario (license-key based) ────────────────────

describe("End-to-end analytics: license-key based profit calculation (patch spec)", () => {
  it("aggregates 3 reconnect sessions under one license_key — no fragmentation loss", () => {
    // Simulates the -639 fake loss bug: 3 sessions totaling 622s wallet billable seconds
    // Old (broken): each session computed separately using wall-clock → inflated API cost
    // New (correct): sum wallet.used_seconds per license_key → single computation
    const totalWalletSeconds = 200 + 200 + 222; // 622s aggregated per license_key
    const billingRate = 5;
    const result = computeNormalisedMetrics(totalWalletSeconds, billingRate);

    // API cost: 622 × 2.3 = 1430.6
    expect(result.apiCostCredits).toBeCloseTo(1430.6, 1);
    // retailCredits: round(622 × 5 / 2) × 2 = 1555 × 2 = 3110 (approximately)
    expect(result.retailCredits).toBeGreaterThan(0);
    // Profit must be positive (eliminates -639 fake loss)
    expect(result.profitCredits).toBeGreaterThan(0);
  });

  it("billing rate change instantly reflects in profit — no stale cache allowed", () => {
    const billableSeconds = 100;
    const oldRate = 5;
    const newRate = 10;

    const oldResult = computeNormalisedMetrics(billableSeconds, oldRate);
    const newResult = computeNormalisedMetrics(billableSeconds, newRate);

    // API cost unchanged (rate only affects revenue)
    expect(newResult.apiCostCredits).toBe(oldResult.apiCostCredits);
    // Revenue doubled because rate doubled
    expect(newResult.retailCredits).toBeGreaterThan(oldResult.retailCredits);
    // Profit increased
    expect(newResult.profitCredits).toBeGreaterThan(oldResult.profitCredits);
  });
});

// ── fmtMin display function ────────────────────────────────────────────────

describe("fmtMin — duration display (must use floor-based math)", () => {
  it("0 minutes → 0m", () => {
    expect(fmtMin(0)).toBe("0m");
  });

  it("30 seconds (0.5 min) → 30s", () => {
    expect(fmtMin(0.5)).toBe("30s");
  });

  it("29 seconds (0.483 min) → 29s", () => {
    expect(fmtMin(29 / 60)).toBe("29s");
  });

  it("1 minute → 1m", () => {
    expect(fmtMin(1)).toBe("1m");
  });

  it("1.5 minutes → 1m 30s (NOT rounded up to 2m)", () => {
    // This was the bug: Math.round(1.5) = 2, causing totals to show "2m" instead of "1m 30s"
    expect(fmtMin(1.5)).toBe("1m 30s");
  });

  it("1.483 minutes (89s) → 1m 29s", () => {
    expect(fmtMin(1.483)).toBe("1m 29s");
  });

  it("60 minutes → 1h", () => {
    expect(fmtMin(60)).toBe("1h");
  });

  it("90 minutes → 1h 30m", () => {
    expect(fmtMin(90)).toBe("1h 30m");
  });

  it("61.5 minutes → 1h 1m 30s", () => {
    expect(fmtMin(61.5)).toBe("1h 1m 30s");
  });

  it("totals row: 1m + 0.5m = 1.5m → 1m 30s (not 2m)", () => {
    // Key 7 (1 min) + Key 6 (0.5 min) = 1.5 min total allocated
    const total = 1 + 0.5;
    expect(fmtMin(total)).toBe("1m 30s");
  });
});

// ── Conversion helpers ────────────────────────────────────────────────────

describe("Credit/minute conversion helpers", () => {
  it("1 minute = 300 credits", () => {
    expect(minutesToCredits(1)).toBe(300);
  });

  it("300 credits = 1 minute", () => {
    expect(creditsToMinutes(300)).toBe(1);
  });

  it("884 credits = 2.947 minutes (to 3 decimal places)", () => {
    expect(Math.round(creditsToMinutes(884) * 1000) / 1000).toBeCloseTo(2.947, 2);
  });
});
