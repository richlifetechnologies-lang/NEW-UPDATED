/**
 * billing-math.test.ts — Automated tests for all billing-critical logic.
 *
 * Run: pnpm test
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  BILLING COMPRESSION INVARIANT — DO NOT REVERT                  ║
 * ║                                                                  ║
 * ║  Decart Lucy 2.1 actual cost rate = 2.3 cr/s (NOT 5).           ║
 * ║  Platform owner confirmed this. DECART_CREDITS_PER_SEC = 2.3.   ║
 * ║                                                                  ║
 * ║  Billing rate controls wallet drain speed:                       ║
 * ║    compression_factor = billing_rate / 2.3                       ║
 * ║    wallet_deduction   = real_elapsed × compression_factor        ║
 * ║    At billing_rate = 3 → 60-min key expires in ~46 real min.    ║
 * ║                                                                  ║
 * ║  Any test failures here = billing regression. DO NOT merge.      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { describe, it, expect } from "vitest";
import {
  DECART_CREDITS_PER_SEC,
  DECART_CREDITS_PER_MIN,
  DECART_API_COST_PER_SEC,
  TCE_BASE_REFERENCE_RATE,
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
  computeCompressionFactor,
  computeDisplaySeconds,
  computeRealFromDisplay,
  fmtMin,
  creditsToMinutes,
  minutesToCredits,
} from "./billing-math";

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  BILLING COMPRESSION INVARIANT TESTS — SAFEGUARD (DO NOT DELETE)        ║
// ║                                                                          ║
// ║  These tests lock the core billing compression model in place.           ║
// ║  If ANY of these fail, someone changed a critical billing constant or    ║
// ║  formula. Revert the change immediately and re-confirm with the          ║
// ║  platform owner before touching billing code.                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe("BILLING COMPRESSION INVARIANT — core rate constants (safeguard)", () => {
  it("DECART_CREDITS_PER_SEC is 2.3 — Decart Lucy 2.1 real charge rate (NOT 5)", () => {
    // Platform owner confirmed: Decart charges 2.3 cr/s, not 5.
    // Changing this breaks all credit cost calculations across the platform.
    expect(DECART_CREDITS_PER_SEC).toBe(2.3);
  });

  it("DECART_CREDITS_PER_MIN is 138 (2.3 × 60)", () => {
    expect(DECART_CREDITS_PER_MIN).toBeCloseTo(138, 5);
    expect(DECART_CREDITS_PER_MIN).toBe(DECART_CREDITS_PER_SEC * 60);
  });

  it("DECART_API_COST_PER_SEC is 2.3 — same as DECART_CREDITS_PER_SEC", () => {
    expect(DECART_API_COST_PER_SEC).toBe(2.3);
    expect(DECART_API_COST_PER_SEC).toBe(DECART_CREDITS_PER_SEC);
  });

  it("TCE_BASE_REFERENCE_RATE equals DECART_API_COST_PER_SEC (2.3 breakeven)", () => {
    expect(TCE_BASE_REFERENCE_RATE).toBe(DECART_API_COST_PER_SEC);
    expect(TCE_BASE_REFERENCE_RATE).toBe(2.3);
  });
});

describe("BILLING COMPRESSION INVARIANT — compression factor formula (safeguard)", () => {
  it("compression factor at breakeven (2.3 cr/s) is exactly 1.000 — no drain speed change", () => {
    expect(computeCompressionFactor(2.3)).toBe(1.0);
  });

  it("compression factor at billing_rate=3 is ~1.304 — 60-min key burns in ~46 real min", () => {
    const factor = computeCompressionFactor(3);
    expect(factor).toBeCloseTo(1.304, 2);
  });

  it("compression factor at billing_rate=4 is ~1.739 — 60-min key burns in ~34 real min", () => {
    expect(computeCompressionFactor(4)).toBeCloseTo(1.739, 2);
  });

  it("compression factor at billing_rate=5 is ~2.174 — 60-min key burns in ~27 real min", () => {
    expect(computeCompressionFactor(5)).toBeCloseTo(2.174, 2);
  });

  it("factor <= 0 fallback is 1.0 (safe — no division by zero, no infinite drain)", () => {
    expect(computeCompressionFactor(0)).toBe(1.0);
    expect(computeCompressionFactor(-1)).toBe(1.0);
  });
});

describe("BILLING COMPRESSION INVARIANT — real stream duration per key (safeguard)", () => {
  it("billing_rate=3: 60-min allocated key expires in ~46 real streaming minutes", () => {
    // This is the CORE business invariant. A 60-min key at 3 cr/s should expire
    // at ~46 real minutes because the wallet drains 1.304× faster than real time.
    const allocatedSeconds  = 3600;
    const compressionFactor = computeCompressionFactor(3);  // 1.304
    const realStreamSeconds = allocatedSeconds / compressionFactor;
    const realMinutes       = realStreamSeconds / 60;
    expect(realMinutes).toBeGreaterThan(45);
    expect(realMinutes).toBeLessThan(48);
  });

  it("billing_rate=2.3: 60-min key = full 60 real minutes (no compression, breakeven)", () => {
    const factor      = computeCompressionFactor(2.3);  // 1.0
    const realSeconds = 3600 / factor;
    expect(Math.round(realSeconds)).toBe(3600);
  });

  it("higher billing rate = fewer real streaming seconds = less Decart cost", () => {
    const walletSecs  = 3600;
    const realAt_2_3  = walletSecs / computeCompressionFactor(2.3);
    const realAt_3    = walletSecs / computeCompressionFactor(3);
    const realAt_4    = walletSecs / computeCompressionFactor(4);
    expect(realAt_3).toBeLessThan(realAt_2_3);
    expect(realAt_4).toBeLessThan(realAt_3);
    const savedAt_3   = (realAt_2_3 - realAt_3) * 2.3;
    expect(savedAt_3).toBeGreaterThan(1800);
  });

  it("compression savings: 60-min key at billing_rate=3 saves ~23% Decart credits", () => {
    const walletSecs    = 3600;
    const factor        = computeCompressionFactor(3);
    const realStream    = walletSecs / factor;
    const actualCost    = realStream * 2.3;
    const breakevenCost = walletSecs * 2.3;
    const savingsPct    = ((breakevenCost - actualCost) / breakevenCost) * 100;
    expect(savingsPct).toBeGreaterThan(20);
    expect(savingsPct).toBeLessThan(30);
  });
});

describe("BILLING COMPRESSION INVARIANT — custom billing rate per key (safeguard)", () => {
  it("custom rate is applied via the same compression formula as global rate", () => {
    // Custom rate per key: getBillingRateForLicense() in billing-rate-cache.ts returns
    // the custom rate when useCustomBillingRate = true and customBillingRate >= 0.1.
    // The same compression formula applies regardless of rate source.
    const customRate     = 4.5;
    const factor         = computeCompressionFactor(customRate);
    expect(factor).toBeCloseTo(4.5 / 2.3, 2);
    // A 60-min key with custom rate 4.5 should run for ~30 real minutes
    const realMin = 60 / factor;
    expect(realMin).toBeGreaterThan(28);
    expect(realMin).toBeLessThan(35);
  });

  it("minutes allocated shows correctly for device dashboard regardless of compression", () => {
    // The device sees minutesAllocated (e.g. 60 min) — this never changes.
    // The compression only affects how fast the countdown burns.
    // displayTotalCapacitySecs = minutesAllocated × 60 (no TCE multiplication)
    const minutesAllocated = 60;
    const displayTotal     = minutesAllocated * 60;
    expect(displayTotal).toBe(3600);
    // Timer burns at compressionFactor speed: at rate=3, 3600 display-sec → 0 in 46 real min
    const factor           = computeCompressionFactor(3);
    const realDuration     = displayTotal / factor;
    expect(realDuration / 60).toBeCloseTo(46, 0);
  });
});

// ── Billing timing constants ──────────────────────────────────────────────────

describe("Billing timing constants", () => {
  it("reserves at least 1 second at session creation", () => {
    expect(MINIMUM_RESERVATION_SEC).toBeGreaterThanOrEqual(1);
  });

  it("heartbeat grace is at least 30s (>= 3 missed 10s heartbeats)", () => {
    expect(HEARTBEAT_GRACE_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("deduction freeze is strictly greater than heartbeat grace", () => {
    expect(DEDUCTION_FREEZE_MS).toBeGreaterThan(HEARTBEAT_GRACE_MS);
  });
});

// ── computeCompressionFactor ──────────────────────────────────────────────────

describe("computeCompressionFactor — billing rate to drain multiplier", () => {
  it("factor = billingRate / 2.3", () => {
    expect(computeCompressionFactor(4.6)).toBeCloseTo(2.0, 2);
    expect(computeCompressionFactor(1.15)).toBeCloseTo(0.5, 2);
  });

  it("rounds to 3 decimal places", () => {
    const factor = computeCompressionFactor(3);
    const decimals = factor.toString().split(".")[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(3);
  });
});

// ── computeDisplaySeconds / computeRealFromDisplay ────────────────────────────

describe("computeDisplaySeconds and computeRealFromDisplay", () => {
  it("at factor=1 (breakeven): display seconds = real seconds", () => {
    expect(computeDisplaySeconds(3600, 1.0)).toBe(3600);
  });

  it("factor>1: display seconds > real seconds (faster drain)", () => {
    const display = computeDisplaySeconds(2761, 1.304);
    expect(display).toBeGreaterThan(2761);
    expect(display).toBeCloseTo(3600, -1);
  });

  it("0 real seconds = 0 display seconds", () => {
    expect(computeDisplaySeconds(0, 1.304)).toBe(0);
  });

  it("computeRealFromDisplay is the inverse of computeDisplaySeconds", () => {
    const real    = 2761;
    const factor  = 1.304;
    const display = computeDisplaySeconds(real, factor);
    const back    = computeRealFromDisplay(display, factor);
    expect(back).toBeCloseTo(real, -1);
  });
});

// ── creditBasedIncrement ──────────────────────────────────────────────────────
// At 2.3 cr/s: 1 minute = 138 credits, 1 second = 2.3 credits

describe("creditBasedIncrement — tick-exact Decart billing at 2.3 cr/s", () => {
  it("138 credits (1 min at 2.3 cr/s) = 60 seconds with 0 already billed", () => {
    const { incrementSec, totalDuration } = creditBasedIncrement(138, 0);
    expect(totalDuration).toBe(60);
    expect(incrementSec).toBe(60);
  });

  it("138 credits, 30 already billed = 30 increment remaining", () => {
    const { incrementSec, totalDuration } = creditBasedIncrement(138, 30);
    expect(totalDuration).toBe(60);
    expect(incrementSec).toBe(30);
  });

  it("2.3 credits = exactly 1 second (minimum billing unit)", () => {
    const { totalDuration } = creditBasedIncrement(2.3, 0);
    expect(totalDuration).toBe(1);
  });

  it("never returns negative increment when already-billed > total", () => {
    const { incrementSec } = creditBasedIncrement(10, 100);
    expect(incrementSec).toBe(0);
  });

  it("0 credits = 0 seconds", () => {
    const { incrementSec, totalDuration } = creditBasedIncrement(0, 0);
    expect(totalDuration).toBe(0);
    expect(incrementSec).toBe(0);
  });

  it("42-second real session: 42 x 2.3 = 96.6 credits -> 42 seconds", () => {
    const credits42s = 42 * DECART_CREDITS_PER_SEC;  // 96.6
    const { incrementSec, totalDuration } = creditBasedIncrement(credits42s, 0);
    expect(totalDuration).toBe(42);
    expect(incrementSec).toBe(42);
  });
});

// ── wallClockIncrement ─────────────────────────────────────────────────────────

describe("wallClockIncrement — timestamp-based fallback billing", () => {
  it("floors to whole seconds", () => {
    const now = 1_000_000_000;
    const { incrementSec } = wallClockIncrement(now + 42_500, now, now);
    expect(incrementSec).toBe(42);
  });

  it("computes totalDuration from billing start, not last debit", () => {
    const start     = 1_000_000_000;
    const lastDebit = start + 10_000;
    const end       = start + 42_000;
    const { incrementSec, totalDuration } = wallClockIncrement(end, lastDebit, start);
    expect(totalDuration).toBe(42);
    expect(incrementSec).toBe(32);
  });

  it("never returns negative increment", () => {
    const now = 1_000_000_000;
    const { incrementSec } = wallClockIncrement(now, now + 5_000, now);
    expect(incrementSec).toBe(0);
  });
});

// ── applyMinimumDuration ──────────────────────────────────────────────────────

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

// ── calculateDebit ────────────────────────────────────────────────────────────

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

// ── licenseRemainingSeconds ───────────────────────────────────────────────────

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

// ── calculateCreditsUsedSinceTopup ────────────────────────────────────────────
// At 2.3 cr/s: 50 wall-clock seconds = 50 x 2.3 = 115 credits

describe("calculateCreditsUsedSinceTopup — Decart credit burn at 2.3 cr/s", () => {
  it("50 completed seconds x 2.3 cr/s = 115 credits used", () => {
    expect(calculateCreditsUsedSinceTopup(50, 0, 0)).toBeCloseTo(115, 4);
  });

  it("50 completed + 10 live seconds = 60 x 2.3 = 138 credits", () => {
    expect(calculateCreditsUsedSinceTopup(50, 10, 0)).toBeCloseTo(138, 4);
  });

  it("subtracts baseline from total credits used", () => {
    // 50 x 2.3 = 115, minus baseline 20 -> 95 credits used since topup
    expect(calculateCreditsUsedSinceTopup(50, 0, 20)).toBeCloseTo(95, 4);
  });

  it("never returns negative credits used", () => {
    expect(calculateCreditsUsedSinceTopup(5, 0, 200)).toBe(0);
  });

  it("99 wall-clock seconds = 99 x 2.3 = 227.7 credits", () => {
    expect(calculateCreditsUsedSinceTopup(99, 0, 0)).toBeCloseTo(227.7, 4);
  });
});

// ── calculateCreditsRemaining ─────────────────────────────────────────────────

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

// ── computeNormalisedMetrics ──────────────────────────────────────────────────
//
// COMPRESSION MODEL (safeguard — do not revert):
//   billableSeconds   = wallet.used_seconds (rate-compressed drain)
//   realStreamSeconds = billableSeconds x 2.3 / billingRate
//   apiCostCredits    = realStreamSeconds x 2.3 (Decart actual charge)
//   retailCredits     = billableSeconds x billingRate (revenue)
//   profit            = retailCredits - apiCostCredits
//
// Higher billing rate -> shorter real stream -> less Decart cost -> more profit.
// This is intentional and correct. Do not revert to old formula.

describe("computeNormalisedMetrics — compression-aware profit analytics (safeguard)", () => {
  it("0 wallet seconds -> all zeros (no fake losses)", () => {
    const r = computeNormalisedMetrics(0, 5);
    expect(r.apiCostCredits).toBe(0);
    expect(r.retailCredits).toBe(0);
    expect(r.profitCredits).toBe(0);
    expect(r.effectiveCreditsPerSec).toBe(0);
  });

  it("at billing_rate=5: 100 wallet-sec -> realStream=46s -> apiCost~=105.8 cr", () => {
    // realStreamSeconds = round(100 x 2.3/5) = round(46) = 46
    // apiCostCredits = round(46 x 2.3 x 100)/100 = 105.8
    const r = computeNormalisedMetrics(100, 5);
    expect(r.apiCostCredits).toBeCloseTo(105.8, 0);
    expect(r.retailCredits).toBeCloseTo(500, 0);
    expect(r.profitCredits).toBeGreaterThan(0);
  });

  it("BREAKEVEN at billing_rate=2.3: apiCost = retailCredits -> profit ~= 0", () => {
    const r = computeNormalisedMetrics(100, 2.3);
    // realStream = round(100 x 2.3/2.3) = 100
    // apiCost = 100 x 2.3 = 230 = retail
    expect(r.profitCredits).toBeCloseTo(0, 0);
  });

  it("higher billing rate = higher retail revenue per wallet-second", () => {
    const low  = computeNormalisedMetrics(100, 3);
    const high = computeNormalisedMetrics(100, 6);
    expect(high.retailCredits).toBeGreaterThan(low.retailCredits);
  });

  it("SAFEGUARD: higher billing rate = LOWER Decart API cost (shorter real stream = credits saved)", () => {
    // Core compression invariant: higher rate -> shorter actual stream -> less Decart cost.
    // This test verifies the system is saving credits correctly.
    const low  = computeNormalisedMetrics(100, 3);   // realStream ~77s -> apiCost ~177 cr
    const high = computeNormalisedMetrics(100, 6);   // realStream ~38s -> apiCost ~87 cr
    expect(high.apiCostCredits).toBeLessThan(low.apiCostCredits);
  });

  it("SAFEGUARD: below-breakeven rate causes LOSS (billing rate < 2.3 cr/s is unprofitable)", () => {
    const r = computeNormalisedMetrics(100, 2.0);
    // realStream = round(100 x 2.3/2.0) = 115s (longer stream, higher Decart cost)
    // apiCost = 115 x 2.3 = 264.5, retail = 100 x 2.0 = 200 -> profit = -64.5
    expect(r.profitCredits).toBeLessThan(0);
  });

  it("effectiveCreditsPerSec = retailCredits / billableSeconds", () => {
    const r = computeNormalisedMetrics(100, 5);
    expect(r.effectiveCreditsPerSec).toBeCloseTo(r.retailCredits / 100, 1);
  });

  it("billing rate change does not affect apiCost formula base rate (always 2.3 cr/s)", () => {
    // API cost is always realStreamSeconds x DECART_API_COST_PER_SEC (2.3).
    // The billing rate only affects HOW LONG the real stream is, not the per-second rate.
    const r = computeNormalisedMetrics(100, 5);
    // realStream = 46s, apiCost = 46 x 2.3 = 105.8
    // If base rate were 5 (old/wrong), apiCost would be 46 x 5 = 230 — this must not happen.
    expect(r.apiCostCredits).toBeLessThan(120);  // well below 230 old-model value
  });
});

// ── End-to-end billing scenario ───────────────────────────────────────────────

describe("End-to-end: 1-minute license key with two sessions (at 2.3 cr/s)", () => {
  it("session 1 (42 real-seconds): creation reserves 1s, settle deducts 42s -> 43s total", () => {
    const minutesAllocated = 1;
    let usedSeconds = MINIMUM_RESERVATION_SEC;  // 1

    // 42 real seconds x 2.3 cr/s = 96.6 credits from Decart
    const credits42s = 42 * DECART_CREDITS_PER_SEC;  // 96.6
    const { incrementSec, totalDuration } = creditBasedIncrement(credits42s, 0);
    const remaining = licenseRemainingSeconds(minutesAllocated, usedSeconds);
    const debited   = calculateDebit(incrementSec, remaining);
    usedSeconds    += debited;

    expect(totalDuration).toBe(42);
    expect(debited).toBe(42);
    expect(usedSeconds).toBe(43);
    expect(licenseRemainingSeconds(minutesAllocated, usedSeconds)).toBe(17);
  });

  it("session 2 (16 real-seconds): creation reserves 1s, settle deducts 16s -> 60s (exhausted)", () => {
    const minutesAllocated = 1;
    let usedSeconds = 43;

    usedSeconds += MINIMUM_RESERVATION_SEC;  // 44
    expect(licenseRemainingSeconds(minutesAllocated, usedSeconds)).toBe(16);

    // 16 real seconds x 2.3 cr/s = 36.8 credits from Decart
    const credits16s = 16 * DECART_CREDITS_PER_SEC;  // 36.8
    const { incrementSec, totalDuration } = creditBasedIncrement(credits16s, 0);
    const remaining = licenseRemainingSeconds(minutesAllocated, usedSeconds);
    const debited   = calculateDebit(incrementSec, remaining);
    usedSeconds    += debited;

    expect(totalDuration).toBe(16);
    expect(debited).toBe(16);
    expect(usedSeconds).toBe(60);
    expect(licenseRemainingSeconds(minutesAllocated, usedSeconds)).toBe(0);
  });
});

// ── End-to-end analytics: per-key profit with compression ─────────────────────

describe("End-to-end analytics: compression-aware profit per license key (safeguard)", () => {
  it("at billing_rate=3: 60-min key fully consumed -> profit is substantial", () => {
    const walletSeconds = 3600;
    const r = computeNormalisedMetrics(walletSeconds, 3);
    // realStream ~2760s, apiCost ~6348 cr, retail = 3600 x 3 = 10800 cr
    expect(r.apiCostCredits).toBeLessThan(7000);  // well below uncompressed 8280
    expect(r.retailCredits).toBeCloseTo(10800, 0);
    expect(r.profitCredits).toBeGreaterThan(3000);
  });

  it("billing rate change instantly reflects in profit (confirms no stale cache)", () => {
    const oldR = computeNormalisedMetrics(100, 3);
    const newR = computeNormalisedMetrics(100, 5);
    expect(newR.retailCredits).toBeGreaterThan(oldR.retailCredits);
    expect(newR.profitCredits).toBeGreaterThan(oldR.profitCredits);
    // Higher rate also means shorter real stream = lower Decart cost
    expect(newR.apiCostCredits).toBeLessThan(oldR.apiCostCredits);
  });

  it("3 reconnect sessions totaling 622 wallet-seconds at rate=5: profit is positive", () => {
    const totalWalletSeconds = 200 + 200 + 222;
    const r = computeNormalisedMetrics(totalWalletSeconds, 5);
    expect(r.profitCredits).toBeGreaterThan(0);
    expect(r.retailCredits).toBeCloseTo(3110, 0);
  });
});

// ── fmtMin display function ────────────────────────────────────────────────────

describe("fmtMin — duration display (floor-based math)", () => {
  it("0 minutes -> 0m", () => { expect(fmtMin(0)).toBe("0m"); });
  it("30 seconds (0.5 min) -> 30s", () => { expect(fmtMin(0.5)).toBe("30s"); });
  it("1 minute -> 1m", () => { expect(fmtMin(1)).toBe("1m"); });
  it("1.5 minutes -> 1m 30s (NOT rounded up to 2m)", () => { expect(fmtMin(1.5)).toBe("1m 30s"); });
  it("60 minutes -> 1h", () => { expect(fmtMin(60)).toBe("1h"); });
  it("90 minutes -> 1h 30m", () => { expect(fmtMin(90)).toBe("1h 30m"); });
  it("61.5 minutes -> 1h 1m 30s", () => { expect(fmtMin(61.5)).toBe("1h 1m 30s"); });
});

// ── Conversion helpers ─────────────────────────────────────────────────────────

describe("Credit/minute conversion helpers (at 2.3 cr/s = 138 cr/min)", () => {
  it("1 minute = 138 credits (2.3 x 60)", () => {
    expect(minutesToCredits(1)).toBeCloseTo(138, 4);
  });

  it("138 credits = 1 minute", () => {
    expect(creditsToMinutes(138)).toBeCloseTo(1, 4);
  });

  it("round-trip: minutesToCredits(creditsToMinutes(x)) approximates x", () => {
    expect(Math.round(minutesToCredits(creditsToMinutes(884)))).toBe(884);
  });
});
