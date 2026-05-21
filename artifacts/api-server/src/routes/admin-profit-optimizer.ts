/**
 * admin-profit-optimizer.ts — Profit Optimization Engine (POE) backend.
 *
 * SAFETY CONTRACT:
 *  - READ-ONLY against ALL existing tables.
 *  - Writes NOTHING — zero mutations to sessions, wallet, heartbeat, or billing.
 *  - Does NOT touch any existing admin routes.
 *  - All errors caught; 500 without affecting callers.
 *  - Advisory only by default — recommendations never auto-apply.
 *
 * Routes:
 *   GET  /admin/profit-optimizer/recommendations  — per-key advisory pacing data
 *   GET  /admin/profit-optimizer/simulate         — profit curve for a billing rate
 *   GET  /admin/profit-optimizer/summary          — system-wide POE summary card
 */

import { Router } from "express";
import { db, licenseKeysTable, sessionsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { getBillingRate, getBillingRateForLicense } from "../lib/billing-rate-cache";
import {
  calculateOptimalPacing,
  simulateProfitCurve,
  computeCurrentPacingFactor,
  DECART_API_COST_PER_SEC,
} from "../lib/billing-math";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /recommendations ──────────────────────────────────────────────────────
// Returns advisory pacing recommendations for every license key.
// Pure reads — no mutations.
router.get("/recommendations", requireAdmin, async (req, res) => {
  try {
    const globalRate     = await getBillingRate();
    const targetMargin   = parseFloat(String(req.query["targetMargin"] ?? "1.0"));
    const targetRatio    = Number.isFinite(targetMargin) && targetMargin > 0 ? targetMargin : 1.0;
    const limitRaw       = Math.min(parseInt(String(req.query["limit"] ?? "500"), 10), 1000);

    // Fetch license keys with session aggregates — existing tables only
    const rows = await db.execute(sql`
      SELECT
        lk.id,
        lk.key,
        lk.is_active,
        lk.minutes_allocated,
        lk.used_seconds,
        lk.custom_billing_rate,
        lk.use_custom_billing_rate,
        lk.created_by_sub_admin_id,
        u.sub_admin_billing_rate,
        COUNT(s.id) FILTER (WHERE s.status = 'active')          AS active_sessions,
        COUNT(s.id) FILTER (WHERE s.status IN ('stopped','expired')) AS completed_sessions,
        COALESCE(AVG(s.duration_seconds) FILTER (WHERE s.duration_seconds > 0), 0) AS avg_session_sec,
        COALESCE(SUM(s.duration_seconds), 0)                    AS total_used_sec
      FROM license_keys lk
      LEFT JOIN users u ON u.id = lk.created_by_sub_admin_id
      LEFT JOIN sessions s ON s.license_key_id = lk.id
      GROUP BY lk.id, u.sub_admin_billing_rate
      ORDER BY lk.last_used_at DESC NULLS LAST
      LIMIT ${limitRaw}
    `);

    const keys = await Promise.all(
      ((rows as any).rows as any[]).map(async (lk: any) => {
        // Resolve effective billing rate via existing 3-tier cache (reads only)
        let effectiveRate = globalRate;
        try {
          effectiveRate = await getBillingRateForLicense(Number(lk.id));
        } catch {
          effectiveRate = globalRate;
        }

        const avgSessionSec       = Number(lk.avg_session_sec ?? 0);
        const totalUsedSec        = Number(lk.total_used_sec ?? 0);
        const minutesAllocated    = Number(lk.minutes_allocated ?? 0);
        const usedSeconds         = Number(lk.used_seconds ?? 0);
        const subAdminRate        = lk.sub_admin_billing_rate != null ? Number(lk.sub_admin_billing_rate) : null;
        const isHighUsage         = Number(lk.active_sessions) > 0 || totalUsedSec > 3600;

        // Aggressive target for high-usage keys — spec: "high usage keys → aggressively reduce pacing_factor"
        const adjustedTarget = isHighUsage ? targetRatio * 0.85 : targetRatio;

        const poe = calculateOptimalPacing({
          billingRate:           effectiveRate,
          avgSessionDurationSec: avgSessionSec,
          licenseDurationMinutes: minutesAllocated,
          subAdminOverrideRate:  subAdminRate,
          targetMarginRatio:     adjustedTarget,
        });

        // Real Decart cost per minute at current pacing (advisory estimate)
        const currentPacing   = computeCurrentPacingFactor(effectiveRate);
        const realCostPerMin  = Math.round(currentPacing * DECART_API_COST_PER_SEC * 60 * 100) / 100;

        // Simulated profit if we switch to recommended pacing
        const simRevPerSec    = effectiveRate;                                   // cr/s revenue
        const simCostPerSec   = poe.recommendedPacingFactor * DECART_API_COST_PER_SEC; // cr/s cost at recommended
        const simProfitPerSec = Math.round((simRevPerSec - simCostPerSec) * 100) / 100;

        return {
          licenseKeyId:            Number(lk.id),
          licenseKey:              String(lk.key),
          isActive:                Boolean(lk.is_active),
          effectiveRate,
          subAdminOverrideRate:    subAdminRate,
          minutesAllocated,
          usedSeconds,
          totalUsedSec,
          avgSessionSec:           Math.round(avgSessionSec),
          activeSessions:          Number(lk.active_sessions ?? 0),
          completedSessions:       Number(lk.completed_sessions ?? 0),
          isHighUsage,
          // POE outputs
          currentPacingFactor:            poe.currentPacingFactor,
          recommendedPacingFactor:        poe.recommendedPacingFactor,
          expectedProfitMarginPct:        poe.expectedProfitMarginPct,
          expectedDecartSavingsPct:       poe.expectedDecartSavingsPct,
          riskScore:                      poe.riskScore,
          riskNote:                       poe.riskNote,
          recommendation:                 poe.recommendation,
          // Extra metrics
          realDecartCostPerMin:           realCostPerMin,
          projectedProfitPerSec:          simProfitPerSec,
        };
      })
    );

    res.json({
      keys,
      globalBillingRate:   globalRate,
      apiCostRate:         DECART_API_COST_PER_SEC,
      targetMarginRatio:   targetRatio,
      mode:                "advisory",
      computedAt:          new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[ProfitOptimizer] recommendations failed");
    res.status(500).json({ error: "Failed to compute pacing recommendations" });
  }
});

// ── GET /simulate ─────────────────────────────────────────────────────────────
// Returns a profit curve dataset for a given billing rate and wallet allocation.
// Safe — pure math, no DB reads beyond rate resolution.
router.get("/simulate", requireAdmin, async (req, res) => {
  try {
    const rateParam        = parseFloat(String(req.query["rate"] ?? "0"));
    const streamingSeconds = parseFloat(String(req.query["streamingSec"] ?? "3600"));

    const globalRate  = await getBillingRate();
    const billingRate = Number.isFinite(rateParam) && rateParam > 0 ? rateParam : globalRate;
    const sec         = Number.isFinite(streamingSeconds) && streamingSeconds > 0 ? streamingSeconds : 3600;

    const curve = simulateProfitCurve(billingRate, sec);

    res.json({
      billingRate,
      streamingSeconds: sec,
      curve,
      apiCostRate: DECART_API_COST_PER_SEC,
      computedAt:  new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[ProfitOptimizer] simulate failed");
    res.status(500).json({ error: "Failed to simulate profit curve" });
  }
});

// ── GET /summary ──────────────────────────────────────────────────────────────
// System-wide POE summary — aggregated advisory metrics across all keys.
router.get("/summary", requireAdmin, async (_req, res) => {
  try {
    const globalRate = await getBillingRate();

    const [totals] = await db.execute(sql`
      SELECT
        COUNT(DISTINCT lk.id)                                          AS total_keys,
        COUNT(DISTINCT lk.id) FILTER (WHERE lk.is_active = true)      AS active_keys,
        COALESCE(SUM(lk.used_seconds), 0)                              AS total_used_sec,
        COUNT(s.id) FILTER (WHERE s.status = 'active')                 AS live_sessions,
        COALESCE(AVG(s.duration_seconds) FILTER (WHERE s.duration_seconds > 0), 0) AS avg_session_sec
      FROM license_keys lk
      LEFT JOIN sessions s ON s.license_key_id = lk.id
    `) as any;

    const row             = (totals as any).rows?.[0] ?? {};
    const totalUsedSec    = Number(row.total_used_sec ?? 0);
    const avgSessionSec   = Number(row.avg_session_sec ?? 0);
    const currentPacing   = computeCurrentPacingFactor(globalRate);

    const systemPoe = calculateOptimalPacing({
      billingRate:           globalRate,
      avgSessionDurationSec: avgSessionSec,
      targetMarginRatio:     1.0,
    });

    // Estimated Decart savings if all keys adopted recommended pacing
    const currentCostAllKeys = Math.round(totalUsedSec * currentPacing   * DECART_API_COST_PER_SEC * 100) / 100;
    const optimalCostAllKeys = Math.round(totalUsedSec * systemPoe.recommendedPacingFactor * DECART_API_COST_PER_SEC * 100) / 100;
    const potentialSavings   = Math.round((currentCostAllKeys - optimalCostAllKeys) * 100) / 100;

    res.json({
      globalBillingRate:          globalRate,
      apiCostRate:                DECART_API_COST_PER_SEC,
      totalKeys:                  Number(row.total_keys ?? 0),
      activeKeys:                 Number(row.active_keys ?? 0),
      liveSessions:               Number(row.live_sessions ?? 0),
      totalUsedSec,
      avgSessionSec:              Math.round(avgSessionSec),
      systemPoe,
      currentDecartCostEstimate:  currentCostAllKeys,
      optimalDecartCostEstimate:  optimalCostAllKeys,
      potentialCreditSavings:     potentialSavings,
      mode:                       "advisory",
      computedAt:                 new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[ProfitOptimizer] summary failed");
    res.status(500).json({ error: "Failed to compute POE summary" });
  }
});

export default router;
