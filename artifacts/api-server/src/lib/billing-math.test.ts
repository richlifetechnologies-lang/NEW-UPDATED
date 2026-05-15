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
  fmtMin,
  creditsToMinutes,
  minutesToCredits,
} from "./billing-math";

// ── Billing constant guards ───────────────────────────────────────────────
// If any of these fail, someone changed a constant that matches Decart's
// Lucy 2.1 contract — revert the change immediately.

describe("Billing constants (Decart Lucy 2.1 contract)", () => {
  it("charges exactly 2 credits per second", () => {
    expect(DECART_CREDITS_PER_SEC).toBe(2);
  });

  it("charges exactly 120 credits per minute (2 × 60)", () => {
    expect(DECART_CREDITS_PER_MIN).toBe(120);
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

// ── creditBasedIncrement ──────────────────────────────────────────────────

describe("creditBasedIncrement — tick-exact Decart billing", () => {
  it("converts 60 ticks (120 credits) to 60 seconds with 0 already billed", () => {
    const { incrementSec, totalDuration } = creditBasedIncrement(120, 0);
    expect(totalDuration).toBe(60);
    expect(incrementSec).toBe(60);
  });

  it("subtracts already-billed seconds from increment", () => {
    const { incrementSec, totalDuration } = creditBasedIncrement(120, 30);
    expect(totalDuration).toBe(60);
    expect(incrementSec).toBe(30);
  });

  it("rounds UP fractional credit seconds (ceiling)", () => {
    // 3 credits = 1.5 seconds → ceil = 2 seconds
    const { totalDuration } = creditBasedIncrement(3, 0);
    expect(totalDuration).toBe(2);
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

  it("handles 1-minute session: 42 ticks (84 credits)", () => {
    const { incrementSec, totalDuration } = creditBasedIncrement(84, 0);
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
  it("multiplies total seconds by 2 and subtracts baseline", () => {
    // 50s completed + 0s live, baseline 0 → 50×2 = 100 credits used
    expect(calculateCreditsUsedSinceTopup(50, 0, 0)).toBe(100);
  });

  it("includes live session seconds", () => {
    // 50s completed + 10s live = 60s × 2 = 120 credits
    expect(calculateCreditsUsedSinceTopup(50, 10, 0)).toBe(120);
  });

  it("subtracts baseline from total", () => {
    // 50s × 2 = 100, baseline 20 → 80 credits used since topup
    expect(calculateCreditsUsedSinceTopup(50, 0, 20)).toBe(80);
  });

  it("never returns negative credits used", () => {
    // Baseline larger than current usage (key just topped up)
    expect(calculateCreditsUsedSinceTopup(5, 0, 200)).toBe(0);
  });

  it("matches the real scenario: 3 sessions totaling 98s, baseline 0", () => {
    // d1f1ee66 (33s) + 157ca55b (46s) + 9b479787 (20s) = 99s wall-clock
    expect(calculateCreditsUsedSinceTopup(99, 0, 0)).toBe(198);
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

// ── End-to-end billing scenario ───────────────────────────────────────────

describe("End-to-end: 1-minute license key with two sessions", () => {
  it("session 1 (42s): creation reserves 1s, settle deducts 42s → 43s total", () => {
    const minutesAllocated = 1;
    // Step 1: session creation reserves MINIMUM_RESERVATION_SEC
    let usedSeconds = MINIMUM_RESERVATION_SEC; // 1

    // Step 2: settle session 1 (42 ticks = 84 credits)
    const billingStartMs = 0;
    const lastDebitMs    = 0; // same as billingStart (no heartbeats)
    const endAtMs        = 42_000;
    const { incrementSec, totalDuration } = creditBasedIncrement(84, 0);
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

    // Step 2: settle session 2 (16 ticks = 32 credits)
    const { incrementSec, totalDuration } = creditBasedIncrement(32, 0);
    const remaining = licenseRemainingSeconds(minutesAllocated, usedSeconds);
    const debited   = calculateDebit(incrementSec, remaining);
    usedSeconds += debited;

    expect(totalDuration).toBe(16);
    expect(debited).toBe(16);
    expect(usedSeconds).toBe(60);
    expect(licenseRemainingSeconds(minutesAllocated, usedSeconds)).toBe(0);
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
  it("1 minute = 120 credits", () => {
    expect(minutesToCredits(1)).toBe(120);
  });

  it("120 credits = 1 minute", () => {
    expect(creditsToMinutes(120)).toBe(1);
  });

  it("884 credits = 7.367 minutes (to 3 decimal places)", () => {
    expect(Math.round(creditsToMinutes(884) * 1000) / 1000).toBeCloseTo(7.367, 2);
  });
});
