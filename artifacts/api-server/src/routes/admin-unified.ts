/**
 * admin-unified.ts — Unified admin dashboard API endpoints.
 *
 * Provides consolidated data for the 8-tab admin dashboard:
 *   Tab 1: Overview
 *   Tab 2: Billing Engine
 *   Tab 3: Licence Keys
 *   Tab 4: Sessions Monitor
 *   Tab 5: Analytics
 *   Tab 6: System Security
 *   Tab 7: Integrity & Debug
 *   Tab 8: Settings
 *
 * Also provides:
 *   - Runtime Estimator (Feature A)
 *   - Wallet Health Predictor (Feature D)
 *   - Abuse Detection (Feature E)
 *   - Revenue Intelligence (Feature F)
 *   - Live Session Control (Feature C)
 */

import { Router } from "express";
import { db, sessionsTable, licenseKeysTable, settingsTable, decartApiKeysTable, billingRateAuditTable, financialTransactionsTable, invoicesTable, usersTable } from "@workspace/db";
import { eq, desc, sql, and, gte, lt, isNotNull, not } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { getBillingRate, getBillingRateForLicense } from "../lib/billing-rate-cache";
import { DECART_API_COST_PER_SEC, ORPHAN_GRACE_MS, computeNormalisedMetrics } from "../lib/billing-math";
import { logger } from "../lib/logger";

const router = Router();

// ── Tab 1: Overview ───────────────────────────────────────────────────────────
router.get("/overview", requireAdmin, async (_req, res) => {
  try {
    const [activeSessions] = await db.select({ count: sql<number>`COUNT(*)` })
      .from(sessionsTable).where(eq(sessionsTable.status, "active"));

    const [totalRevInvoice] = await db.select({ total: sql<string>`COALESCE(SUM(amount_usdt),0)` })
      .from(invoicesTable).where(sql`status='paid' AND type='payment'`);
    const [totalRevLicense] = await db.select({ total: sql<string>`COALESCE(SUM(revenue_usd),0)` })
      .from(financialTransactionsTable);
    const totalRevenue = parseFloat(totalRevInvoice?.total ?? "0") + parseFloat(totalRevLicense?.total ?? "0");

    const [totalWalletBurnRow] = await db.select({ total: sql<string>`COALESCE(SUM(used_seconds),0)` })
      .from(licenseKeysTable);
    const totalWalletBurnSec = parseFloat(totalWalletBurnRow?.total ?? "0");

    let billingRate = 2.3;
    try { billingRate = await getBillingRate(); } catch {}

    const { apiCostCredits, retailCredits, profitCredits } = computeNormalisedMetrics(totalWalletBurnSec, billingRate);
    const profit = profitCredits / 2; // convert credits to USD approx

    const [totalKeys] = await db.select({ count: sql<number>`COUNT(*)` }).from(licenseKeysTable);
    const [activeKeys] = await db.select({ count: sql<number>`COUNT(*)` })
      .from(licenseKeysTable).where(eq(licenseKeysTable.isActive, true));

    res.json({
      activeSessions: Number(activeSessions?.count ?? 0),
      totalRevenue,
      totalWalletBurnSeconds: totalWalletBurnSec,
      apiCostCredits,
      profit,
      systemHealth: { db: true, billingRate, billingRateOk: billingRate > 0 },
      totalKeys: Number(totalKeys?.count ?? 0),
      activeKeys: Number(activeKeys?.count ?? 0),
    });
  } catch (err) {
    logger.error({ err }, "[unified:overview]");
    res.status(500).json({ error: "Failed to load overview" });
  }
});

// ── Tab 4: Sessions Monitor ───────────────────────────────────────────────────
router.get("/sessions/live", requireAdmin, async (_req, res) => {
  try {
    const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS);
    const sessions = await db.select({
      id: sessionsTable.id,
      licenseKeyId: sessionsTable.licenseKeyId,
      status: sessionsTable.status,
      startedAt: sessionsTable.startedAt,
      stoppedAt: sessionsTable.stoppedAt,
      durationSeconds: sessionsTable.durationSeconds,
      style: sessionsTable.style,
      lastHeartbeatAt: sessionsTable.lastHeartbeatAt,
      billingStartedAt: sessionsTable.billingStartedAt,
      billingRateSnapshot: (sessionsTable as any).billingRateSnapshot,
      licenseKey: licenseKeysTable.key,
      minutesAllocated: licenseKeysTable.minutesAllocated,
      usedSeconds: licenseKeysTable.usedSeconds,
    })
    .from(sessionsTable)
    .leftJoin(licenseKeysTable, eq(sessionsTable.licenseKeyId, licenseKeysTable.id))
    .orderBy(desc(sessionsTable.startedAt))
    .limit(100);

    const now = Date.now();
    const mapped = sessions.map(s => {
      const lastBeat = s.lastHeartbeatAt ?? s.startedAt;
      const isOrphan = s.status === "active" && lastBeat < cutoff;
      const liveDurationSec = s.status === "active"
        ? Math.floor((now - new Date(s.billingStartedAt ?? s.startedAt).getTime()) / 1000)
        : (s.durationSeconds ?? 0);
      return {
        ...s,
        isOrphan,
        liveDurationSec,
        heartbeatAgeMs: now - new Date(lastBeat).getTime(),
      };
    });

    res.json({ sessions: mapped, count: mapped.length });
  } catch (err) {
    logger.error({ err }, "[unified:sessions:live]");
    res.status(500).json({ error: "Failed to load sessions" });
  }
});

router.post("/sessions/:id/stop", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id as string));
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    if (session.status !== "active") { res.status(409).json({ error: "Session not active" }); return; }

    await db.update(sessionsTable)
      .set({ status: "stopped", stoppedAt: new Date() })
      .where(eq(sessionsTable.id, id as string));

    logger.info({ sessionId: id, admin: true }, "[unified:sessions] admin_forced_stop");
    res.json({ success: true, sessionId: id });
  } catch (err) {
    logger.error({ err }, "[unified:sessions:stop]");
    res.status(500).json({ error: "Failed to stop session" });
  }
});

// ── Feature C: Live Session Control (extend/reduce runtime) ────────────────────
router.post("/sessions/:id/extend", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { minutesToAdd } = req.body as { minutesToAdd?: number };
    if (!minutesToAdd || minutesToAdd <= 0) {
      res.status(400).json({ error: "minutesToAdd must be positive" }); return;
    }
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id as string));
    if (!session?.licenseKeyId) { res.status(404).json({ error: "Session not found" }); return; }

    await db.update(licenseKeysTable)
      .set({ minutesAllocated: sql`minutes_allocated + ${minutesToAdd}` })
      .where(eq(licenseKeysTable.id, session.licenseKeyId));

    logger.info({ sessionId: id, minutesToAdd }, "[unified:sessions] runtime_extended");
    res.json({ success: true, minutesAdded: minutesToAdd });
  } catch (err) {
    res.status(500).json({ error: "Failed to extend session" });
  }
});

router.post("/sessions/:id/reduce", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { minutesToRemove } = req.body as { minutesToRemove?: number };
    if (!minutesToRemove || minutesToRemove <= 0) {
      res.status(400).json({ error: "minutesToRemove must be positive" }); return;
    }
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id as string));
    if (!session?.licenseKeyId) { res.status(404).json({ error: "Session not found" }); return; }

    await db.update(licenseKeysTable)
      .set({ minutesAllocated: sql`GREATEST(0, minutes_allocated - ${minutesToRemove})` })
      .where(eq(licenseKeysTable.id, session.licenseKeyId));

    logger.info({ sessionId: id, minutesToRemove }, "[unified:sessions] runtime_reduced");
    res.json({ success: true, minutesRemoved: minutesToRemove });
  } catch (err) {
    res.status(500).json({ error: "Failed to reduce session" });
  }
});

// ── Feature A: Runtime Estimator ──────────────────────────────────────────────
router.post("/runtime-estimator", requireAdmin, async (req, res) => {
  try {
    const { minutesPurchased, billingRate: inputRate } = req.body as {
      minutesPurchased?: number;
      billingRate?: number;
    };
    if (!minutesPurchased || minutesPurchased <= 0) {
      res.status(400).json({ error: "minutesPurchased must be positive" }); return;
    }

    let billingRate = inputRate ?? 0;
    if (!billingRate) {
      try { billingRate = await getBillingRate(); } catch { billingRate = 2.3; }
    }

    const apiCostRate = DECART_API_COST_PER_SEC;
    const totalWalletSeconds = minutesPurchased * 60;
    const compressionFactor = billingRate / apiCostRate;
    const realStreamSeconds = Math.round(totalWalletSeconds / compressionFactor);
    const realStreamMinutes = realStreamSeconds / 60;

    const apiCostCredits = realStreamSeconds * apiCostRate;
    const retailCredits  = totalWalletSeconds * billingRate;
    const profitCredits  = retailCredits - apiCostCredits;
    const profitUsd      = profitCredits / 2; // approx
    const margin         = billingRate > 0 ? ((billingRate - apiCostRate) / billingRate) * 100 : 0;
    const burnSpeedFactor = compressionFactor;

    res.json({
      minutesPurchased,
      billingRate,
      apiCostRate,
      realStreamMinutes: Math.round(realStreamMinutes * 10) / 10,
      compressionFactor: Math.round(compressionFactor * 1000) / 1000,
      apiCostCredits: Math.round(apiCostCredits * 100) / 100,
      retailCredits: Math.round(retailCredits * 100) / 100,
      profitCredits: Math.round(profitCredits * 100) / 100,
      profitUsd: Math.round(profitUsd * 100) / 100,
      marginPercent: Math.round(margin * 10) / 10,
      burnSpeedFactor: Math.round(burnSpeedFactor * 1000) / 1000,
      runtimeEfficiency: billingRate >= apiCostRate ? "profitable" : "loss",
    });
  } catch (err) {
    res.status(500).json({ error: "Estimation failed" });
  }
});

// ── Feature D: Wallet Health Predictor ────────────────────────────────────────
router.get("/wallet-health", requireAdmin, async (_req, res) => {
  try {
    let billingRate = 2.3;
    try { billingRate = await getBillingRate(); } catch {}

    const keys = await db.select({
      id: licenseKeysTable.id,
      key: licenseKeysTable.key,
      isActive: licenseKeysTable.isActive,
      minutesAllocated: licenseKeysTable.minutesAllocated,
      usedSeconds: licenseKeysTable.usedSeconds,
      lastUsedAt: licenseKeysTable.lastUsedAt,
      customBillingRate: licenseKeysTable.customBillingRate,
      useCustomBillingRate: licenseKeysTable.useCustomBillingRate,
    }).from(licenseKeysTable).where(eq(licenseKeysTable.isActive, true));

    const predictions = keys.map(k => {
      const effectiveRate = k.useCustomBillingRate && k.customBillingRate ? k.customBillingRate : billingRate;
      const totalSec = (k.minutesAllocated ?? 0) * 60;
      const remainingSec = Math.max(0, totalSec - (k.usedSeconds ?? 0));
      const compressionFactor = effectiveRate / DECART_API_COST_PER_SEC;
      const realStreamRemainingSec = Math.round(remainingSec / compressionFactor);
      const burnRatePerHour = (k.usedSeconds ?? 0) > 0 && k.lastUsedAt
        ? (k.usedSeconds ?? 0) / Math.max(1, (Date.now() - new Date(k.lastUsedAt).getTime()) / 3600000)
        : null;
      const hoursUntilExhausted = burnRatePerHour && burnRatePerHour > 0
        ? remainingSec / burnRatePerHour
        : null;
      const risk = remainingSec < 300 ? "critical" : remainingSec < 1800 ? "low" : "healthy";

      return {
        id: k.id,
        key: k.key,
        remainingSeconds: remainingSec,
        realStreamRemainingSeconds: realStreamRemainingSec,
        effectiveBillingRate: effectiveRate,
        burnRateSecPerHour: burnRatePerHour ? Math.round(burnRatePerHour) : null,
        hoursUntilExhausted: hoursUntilExhausted ? Math.round(hoursUntilExhausted * 10) / 10 : null,
        risk,
      };
    });

    res.json({ keys: predictions, globalBillingRate: billingRate });
  } catch (err) {
    logger.error({ err }, "[unified:wallet-health]");
    res.status(500).json({ error: "Failed to compute wallet health" });
  }
});

// ── Feature E: Abuse Detection ────────────────────────────────────────────────
router.get("/abuse-detection", requireAdmin, async (_req, res) => {
  try {
    const oneHourAgo = new Date(Date.now() - 3600_000);
    const oneDayAgo  = new Date(Date.now() - 86400_000);

    // Keys with abnormal session frequency (> 20 sessions in last hour)
    const highFrequency = await db.select({
      licenseKeyId: sessionsTable.licenseKeyId,
      sessionCount: sql<number>`COUNT(*)`,
      licenseKey: licenseKeysTable.key,
    })
    .from(sessionsTable)
    .leftJoin(licenseKeysTable, eq(sessionsTable.licenseKeyId, licenseKeysTable.id))
    .where(gte(sessionsTable.startedAt, oneHourAgo))
    .groupBy(sessionsTable.licenseKeyId, licenseKeysTable.key)
    .having(sql`COUNT(*) > 20`);

    // Sessions with sub-30s duration (potential heartbeat spam / reconnect loops)
    const shortSessions = await db.select({
      licenseKeyId: sessionsTable.licenseKeyId,
      shortCount: sql<number>`COUNT(*)`,
      licenseKey: licenseKeysTable.key,
    })
    .from(sessionsTable)
    .leftJoin(licenseKeysTable, eq(sessionsTable.licenseKeyId, licenseKeysTable.id))
    .where(and(
      gte(sessionsTable.startedAt, oneDayAgo),
      isNotNull(sessionsTable.durationSeconds),
      sql`duration_seconds < 30 AND status = 'stopped'`
    ))
    .groupBy(sessionsTable.licenseKeyId, licenseKeysTable.key)
    .having(sql`COUNT(*) > 5`);

    res.json({
      highFrequencyKeys: highFrequency,
      reconnectLoopKeys: shortSessions,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[unified:abuse]");
    res.status(500).json({ error: "Abuse detection failed" });
  }
});

// ── Feature F: Revenue Intelligence ──────────────────────────────────────────
router.get("/revenue-intelligence", requireAdmin, async (_req, res) => {
  try {
    let billingRate = 2.3;
    try { billingRate = await getBillingRate(); } catch {}

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);

    // Revenue per day (last 7 days)
    const dailyRevenue = await db.select({
      day: sql<string>`DATE(paid_at)`,
      total: sql<string>`COALESCE(SUM(amount_usdt), 0)`,
    })
    .from(invoicesTable)
    .where(sql`status='paid' AND type='payment' AND paid_at >= ${sevenDaysAgo}`)
    .groupBy(sql`DATE(paid_at)`)
    .orderBy(sql`DATE(paid_at)`);

    // Best performing keys (most wallet burn = most usage)
    const keyEfficiency = await db.select({
      id: licenseKeysTable.id,
      key: licenseKeysTable.key,
      usedSeconds: licenseKeysTable.usedSeconds,
      minutesAllocated: licenseKeysTable.minutesAllocated,
    })
    .from(licenseKeysTable)
    .where(sql`used_seconds > 0`)
    .orderBy(desc(licenseKeysTable.usedSeconds))
    .limit(10);

    const efficiency = keyEfficiency.map(k => {
      const totalSec = (k.minutesAllocated ?? 0) * 60;
      const usedSec = k.usedSeconds ?? 0;
      const efficiencyPercent = totalSec > 0 ? Math.round((usedSec / totalSec) * 100) : 0;
      const { profitCredits } = computeNormalisedMetrics(usedSec, billingRate);
      return { ...k, efficiencyPercent, profitCredits };
    });

    res.json({
      dailyRevenue,
      topKeysByUsage: efficiency,
      billingRate,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[unified:revenue-intelligence]");
    res.status(500).json({ error: "Revenue intelligence failed" });
  }
});

// ── Tab 7: Integrity & Debug ──────────────────────────────────────────────────
router.get("/integrity", requireAdmin, async (_req, res) => {
  try {
    // Orphan sessions (active but no heartbeat for ORPHAN_GRACE_MS)
    const orphanCutoff = new Date(Date.now() - ORPHAN_GRACE_MS);
    const orphans = await db.select({
      id: sessionsTable.id,
      licenseKeyId: sessionsTable.licenseKeyId,
      startedAt: sessionsTable.startedAt,
      lastHeartbeatAt: sessionsTable.lastHeartbeatAt,
    })
    .from(sessionsTable)
    .where(and(
      eq(sessionsTable.status, "active"),
      sql`COALESCE(last_heartbeat_at, started_at) < ${orphanCutoff}`
    ));

    // Zero-duration stopped sessions (billing anomaly)
    const zeroDuration = await db.select({ count: sql<number>`COUNT(*)` })
      .from(sessionsTable)
      .where(sql`status='stopped' AND (duration_seconds IS NULL OR duration_seconds = 0) AND billing_started_at IS NOT NULL`);

    // Keys with wallet mismatch (used_seconds > allocated*60)
    const overdrawn = await db.select({
      id: licenseKeysTable.id,
      key: licenseKeysTable.key,
      minutesAllocated: licenseKeysTable.minutesAllocated,
      usedSeconds: licenseKeysTable.usedSeconds,
    })
    .from(licenseKeysTable)
    .where(sql`used_seconds > (minutes_allocated * 60)`);

    // Expired keys still marked active
    const expiredActive = await db.select({ count: sql<number>`COUNT(*)` })
      .from(licenseKeysTable)
      .where(sql`is_active = true AND expires_at IS NOT NULL AND expires_at < NOW()`);

    res.json({
      orphanSessions: orphans,
      orphanCount: orphans.length,
      zeroDurationSessions: Number(zeroDuration[0]?.count ?? 0),
      overdrawnKeys: overdrawn,
      expiredActiveKeys: Number(expiredActive[0]?.count ?? 0),
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[unified:integrity]");
    res.status(500).json({ error: "Integrity check failed" });
  }
});

// ── Tab 8: Settings (allowlist-only) ─────────────────────────────────────────
const ALLOWED_SETTINGS_KEYS = [
  "billing_credits_per_sec",
  "cc_usage_cap_enabled",
  "cc_usage_cap_minutes_per_day",
  "cc_wallet_expiry_enabled",
  "cc_wallet_expiry_days",
  "telegram_bot_token",
  "telegram_chat_id",
] as const;

router.get("/settings", requireAdmin, async (_req, res) => {
  try {
    const rows = await db.select().from(settingsTable);
    const allowed = rows.filter(r => (ALLOWED_SETTINGS_KEYS as readonly string[]).includes(r.key));
    res.json({ settings: allowed });
  } catch (err) {
    res.status(500).json({ error: "Failed to load settings" });
  }
});

router.put("/settings", requireAdmin, async (req, res) => {
  try {
    const { key, value } = req.body as { key?: string; value?: string };
    if (!key || value === undefined) {
      res.status(400).json({ error: "key and value are required" }); return;
    }
    if (!(ALLOWED_SETTINGS_KEYS as readonly string[]).includes(key)) {
      res.status(403).json({ error: `Setting '${key}' is not in the allowlist` }); return;
    }
    await db.execute(sql`
      INSERT INTO settings (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `);
    logger.info({ key }, "[unified:settings] updated");
    res.json({ success: true, key, value });
  } catch (err) {
    res.status(500).json({ error: "Failed to update setting" });
  }
});

export default router;
