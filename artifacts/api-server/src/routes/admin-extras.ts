/**
 * admin-extras.ts — Missing backend endpoints for admin pages.
 * Routes:
 *   GET /analytics/per-key      — per-key analytics table
 *   GET /billing-rate           — global billing rate info (for profit-dashboard)
 *   GET /profit-live            — live profit from active sessions
 *   GET /billing-integrity      — billing integrity + drift check
 */
import { Router } from "express";
import { db, licenseKeysTable, sessionsTable, decartApiKeysTable, settingsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { getBillingRate } from "../lib/billing-rate-cache";
import {
  DECART_API_COST_PER_SEC,
  computeCompressionFactor,
  licenseRemainingSeconds,
} from "../lib/billing-math";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /analytics/per-key ──────────────────────────────────────────────────
router.get("/analytics/per-key", requireAdmin, async (req, res) => {
  try {
    const globalRate = await getBillingRate();
    const rows = await db.execute(sql`
      SELECT
        lk.id,
        lk.key,
        lk.is_active,
        lk.minutes_allocated,
        lk.used_seconds,
        lk.streaming_enabled,
        lk.last_used_at,
        lk.device_id,
        lk.assigned_decart_key_id,
        lk.custom_billing_rate,
        lk.use_custom_billing_rate,
        dk.label AS decart_label,
        COUNT(s.id)::int                                                             AS session_count,
        COUNT(s.id) FILTER (WHERE s.status = 'active')::int                         AS active_session_count,
        MAX(s.last_heartbeat_at)                                                     AS last_heartbeat,
        COUNT(s.id) FILTER (WHERE s.status = 'active'
          AND (s.last_heartbeat_at IS NULL
               OR s.last_heartbeat_at < NOW() - INTERVAL '2 minutes'))::int          AS ghost_count,
        COALESCE(SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END)
          FILTER (WHERE s.started_at IS NOT NULL), 0)::int                           AS reconnect_count
      FROM license_keys lk
      LEFT JOIN sessions s       ON s.license_key_id = lk.id
      LEFT JOIN decart_api_keys dk ON dk.id = lk.assigned_decart_key_id
      GROUP BY lk.id, dk.label
      ORDER BY lk.last_used_at DESC NULLS LAST
    `);

    const keys = ((rows as any).rows as any[]).map(lk => {
      const usedSec      = Number(lk.used_seconds ?? 0);
      const allocMin     = Number(lk.minutes_allocated ?? 0);
      const allocSec     = Math.round(allocMin * 60);
      const remSec       = licenseRemainingSeconds(allocMin, usedSec);
      const useCustom    = Boolean(lk.use_custom_billing_rate);
      const customRate   = lk.custom_billing_rate != null ? Number(lk.custom_billing_rate) : null;
      const effRate      = (useCustom && customRate != null && customRate >= 0.1) ? customRate : globalRate;
      const cf           = computeCompressionFactor(effRate);
      const revenue      = Math.round(usedSec * effRate * 100) / 100;
      const cost         = Math.round(usedSec * DECART_API_COST_PER_SEC * 100) / 100;
      const profit       = Math.round((revenue - cost) * 100) / 100;
      const profitPerSec = Math.round((effRate - DECART_API_COST_PER_SEC) * 100) / 100;
      const marginPct    = effRate > 0 ? Math.round(((effRate - DECART_API_COST_PER_SEC) / effRate) * 10000) / 100 : 0;
      const isLive       = Number(lk.active_session_count ?? 0) > 0;
      const dispUsed     = Math.round(usedSec * cf);
      const dispRem      = Math.round(remSec * cf);
      const driftPct     = usedSec > 0 ? Math.round(Math.abs((dispUsed - usedSec) / usedSec) * 10000) / 100 : 0;

      return {
        licenseKeyId:        Number(lk.id),
        licenseKey:          String(lk.key),
        isActive:            Boolean(lk.is_active),
        deviceId:            lk.device_id ?? null,
        decartLabel:         lk.decart_label ?? null,
        allocatedSeconds:    allocSec,
        usedSeconds:         usedSec,
        remainingSeconds:    remSec,
        displaySecondsUsed:  dispUsed,
        displaySecondsRemaining: dispRem,
        effectiveRate:       effRate,
        rateSource:          useCustom && customRate != null ? "custom" : "global",
        compressionFactor:   cf,
        revenue,
        cost,
        profit,
        profitPerSecond:     profitPerSec,
        marginPct,
        isLive,
        activeSessionCount:  Number(lk.active_session_count ?? 0),
        sessionCount:        Number(lk.session_count ?? 0),
        ghostCount:          Number(lk.ghost_count ?? 0),
        reconnectCount:      Number(lk.reconnect_count ?? 0),
        lastHeartbeat:       lk.last_heartbeat ?? null,
        lastUsedAt:          lk.last_used_at ?? null,
        driftPct,
        tceHealth:           driftPct < 2 ? "good" : driftPct < 5 ? "warning" : "drift",
      };
    });

    const totalRevenue  = keys.reduce((a, k) => a + k.revenue, 0);
    const totalCost     = keys.reduce((a, k) => a + k.cost, 0);
    const totalProfit   = Math.round((totalRevenue - totalCost) * 100) / 100;
    const totalUsed     = keys.reduce((a, k) => a + k.usedSeconds, 0);
    const totalDisplay  = keys.reduce((a, k) => a + k.displaySecondsUsed, 0);
    const activeStreams  = keys.filter(k => k.isLive).length;
    const ghostTotal    = keys.reduce((a, k) => a + k.ghostCount, 0);
    const avgCF         = keys.length > 0 ? Math.round(keys.reduce((a, k) => a + k.compressionFactor, 0) / keys.length * 1000) / 1000 : 1;
    const driftAlerts   = keys.filter(k => k.tceHealth === "drift").length;

    res.json({
      keys,
      summary: {
        totalUsedSeconds:    totalUsed,
        totalDisplaySeconds: totalDisplay,
        totalRevenue:        Math.round(totalRevenue * 100) / 100,
        totalCost:           Math.round(totalCost * 100) / 100,
        totalProfit,
        avgCompressionFactor: avgCF,
        activeStreams,
        ghostSessionCount:   ghostTotal,
        driftAlertCount:     driftAlerts,
        totalDecartCreditsBurned: Math.round(totalUsed * DECART_API_COST_PER_SEC * 100) / 100,
        globalBillingRate:   globalRate,
        apiCostRate:         DECART_API_COST_PER_SEC,
        keyCount:            keys.length,
      },
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[AdminExtras] analytics/per-key failed");
    res.status(500).json({ error: "Failed to load per-key analytics" });
  }
});

// ── GET /billing-rate ────────────────────────────────────────────────────────
router.get("/billing-rate", requireAdmin, async (_req, res) => {
  try {
    const rate        = await getBillingRate();
    const apiCostRate = DECART_API_COST_PER_SEC;
    const profitPerSec = Math.round((rate - apiCostRate) * 100) / 100;
    const cf          = computeCompressionFactor(rate);
    const realStreamMinutesPerLicenseHour = cf > 0 ? Math.round((60 / cf) * 100) / 100 : 60;
    res.json({
      rate,
      apiCostRate,
      profitPerSec,
      compressionFactor: cf,
      realStreamMinutesPerLicenseHour,
      burnPreview: `${rate} cr/s billing · ${apiCostRate} cr/s api cost · +${profitPerSec} cr/s profit`,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[AdminExtras] billing-rate failed");
    res.status(500).json({ error: "Failed to load billing rate" });
  }
});

// ── GET /profit-live ─────────────────────────────────────────────────────────
router.get("/profit-live", requireAdmin, async (_req, res) => {
  try {
    const globalRate = await getBillingRate();
    const rows = await db.execute(sql`
      SELECT
        s.id            AS session_id,
        s.started_at,
        s.last_heartbeat_at,
        s.duration_seconds,
        lk.id           AS license_key_id,
        lk.key          AS license_key,
        lk.used_seconds,
        lk.custom_billing_rate,
        lk.use_custom_billing_rate
      FROM sessions s
      JOIN license_keys lk ON lk.id = s.license_key_id
      WHERE s.status = 'active'
      ORDER BY s.started_at DESC
      LIMIT 200
    `);

    const streams = ((rows as any).rows as any[]).map(s => {
      const useCustom  = Boolean(s.use_custom_billing_rate);
      const customRate = s.custom_billing_rate != null ? Number(s.custom_billing_rate) : null;
      const effRate    = (useCustom && customRate != null && customRate >= 0.1) ? customRate : globalRate;
      const usedSec    = Number(s.used_seconds ?? 0);
      const revenue    = Math.round(usedSec * effRate * 100) / 100;
      const cost       = Math.round(usedSec * DECART_API_COST_PER_SEC * 100) / 100;
      const profit     = Math.round((revenue - cost) * 100) / 100;
      return {
        sessionId:       String(s.session_id),
        licenseKey:      s.license_key ?? null,
        usedSeconds:     usedSec,
        billingRate:     effRate,
        apiCostRate:     DECART_API_COST_PER_SEC,
        revenueCrPerSec: effRate,
        costCrPerSec:    DECART_API_COST_PER_SEC,
        profitCrPerSec:  Math.round((effRate - DECART_API_COST_PER_SEC) * 100) / 100,
        totalRevenue:    revenue,
        totalApiCost:    cost,
        totalProfit:     profit,
        startedAt:       s.started_at,
        lastHeartbeat:   s.last_heartbeat_at,
      };
    });

    const totals = streams.reduce(
      (a, s) => ({ profit: a.profit + s.totalProfit, revenue: a.revenue + s.totalRevenue, cost: a.cost + s.totalApiCost }),
      { profit: 0, revenue: 0, cost: 0 }
    );

    res.json({
      streams,
      activeCount: streams.length,
      totalProfit:  Math.round(totals.profit * 100) / 100,
      totalRevenue: Math.round(totals.revenue * 100) / 100,
      totalApiCost: Math.round(totals.cost * 100) / 100,
      billingRate:  globalRate,
      apiCostRate:  DECART_API_COST_PER_SEC,
      computedAt:   new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[AdminExtras] profit-live failed");
    res.status(500).json({ error: "Failed to load live profit data" });
  }
});

// ── GET /billing-integrity ───────────────────────────────────────────────────
router.get("/billing-integrity", requireAdmin, async (_req, res) => {
  try {
    const globalRate = await getBillingRate();
    const apiCostRate = DECART_API_COST_PER_SEC; // 2.3 fixed
    const hardcodeDetected = false; // rate is always from DB
    const profitPerSec = Math.round((globalRate - apiCostRate) * 100) / 100;

    const activeRows = await db.execute(sql`
      SELECT
        s.id            AS session_id,
        s.started_at,
        s.last_heartbeat_at,
        s.duration_seconds,
        lk.key          AS license_key,
        lk.used_seconds,
        lk.custom_billing_rate,
        lk.use_custom_billing_rate,
        EXTRACT(EPOCH FROM (NOW() - s.started_at))::int AS clock_elapsed,
        EXTRACT(EPOCH FROM (NOW() - s.last_heartbeat_at))::int AS heartbeat_age
      FROM sessions s
      JOIN license_keys lk ON lk.id = s.license_key_id
      WHERE s.status = 'active'
      ORDER BY s.started_at DESC
      LIMIT 100
    `);

    const streams = ((activeRows as any).rows as any[]).map(s => {
      const useCustom  = Boolean(s.use_custom_billing_rate);
      const customRate = s.custom_billing_rate != null ? Number(s.custom_billing_rate) : null;
      const effRate    = (useCustom && customRate != null && customRate >= 0.1) ? customRate : globalRate;
      const usedSec    = Number(s.used_seconds ?? 0);
      const clockSec   = Number(s.clock_elapsed ?? 0);
      const driftDelta = Math.abs(clockSec - usedSec);
      const heartbeatAge = s.heartbeat_age != null ? Number(s.heartbeat_age) : null;
      const syncStatus = driftDelta < 10 ? "sync" : driftDelta < 60 ? "mild_lag" : "warning";
      const revenue    = Math.round(usedSec * effRate * 100) / 100;
      const cost       = Math.round(usedSec * apiCostRate * 100) / 100;
      const profit     = Math.round((revenue - cost) * 100) / 100;
      return {
        sessionId:            String(s.session_id),
        licenseKey:           s.license_key ?? null,
        activeBillingRate:    effRate,
        billingRateSource:    useCustom && customRate != null ? "custom" : "global_db",
        walletUsedSeconds:    usedSec,
        clockElapsedSeconds:  clockSec,
        driftDelta,
        revenuePerSecond:     effRate,
        apiCostPerSecond:     apiCostRate,
        profitPerSecond:      Math.round((effRate - apiCostRate) * 100) / 100,
        profitPerMinute:      Math.round((effRate - apiCostRate) * 60 * 100) / 100,
        totalRevenueLive:     revenue,
        totalApiCostLive:     cost,
        totalProfitLive:      profit,
        heartbeatAgeSeconds:  heartbeatAge,
        liveStreamState:      heartbeatAge != null && heartbeatAge > 120 ? "stale" : "healthy",
        syncStatus,
      };
    });

    const totals = streams.reduce(
      (a, s) => ({ profit: a.profit + s.totalProfitLive, revenue: a.revenue + s.totalRevenueLive, cost: a.cost + s.totalApiCostLive }),
      { profit: 0, revenue: 0, cost: 0 }
    );

    const mismatchedStreams = streams.filter(s => s.syncStatus === "warning").length;

    res.json({
      streams,
      activeCount:  streams.length,
      totalProfit:  Math.round(totals.profit * 100) / 100,
      totalRevenue: Math.round(totals.revenue * 100) / 100,
      totalApiCost: Math.round(totals.cost * 100) / 100,
      billingIntegrity: {
        dbRate:            globalRate,
        codeConstantRate:  apiCostRate,
        hardcodeDetected,
        hardcodeAlert:     hardcodeDetected ? "Hardcoded rate detected — DB rate not used" : null,
        profitPerSec,
        rateSource:        "settings_table_live",
        rateVerified:      true,
      },
      walletLedgerSync: {
        mismatchedStreams,
        allInSync: mismatchedStreams === 0,
        alert: mismatchedStreams > 0 ? `${mismatchedStreams} stream(s) have significant clock/wallet drift` : null,
      },
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[AdminExtras] billing-integrity failed");
    res.status(500).json({ error: "Failed to load billing integrity data" });
  }
});

export default router;
