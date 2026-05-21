/**
 * admin-control-center.ts — Control Center feature backend.
 *
 * SAFETY CONTRACT:
 *  - All new settings use namespaced keys (cc_*) — zero collision risk.
 *  - Additive only. Does NOT touch existing routes, wallet deduction,
 *    billing engine, sessions, or heartbeat.
 *  - Usage cap and wallet expiry are ADVISORY/DISPLAY — they do not block
 *    sessions server-side in this file. Enforcement can be layered on top
 *    of the cap check data returned here.
 *
 * Routes:
 *   GET  /admin/control-center/settings       — all CC feature toggles + values
 *   PUT  /admin/control-center/settings       — update any CC setting
 *   GET  /admin/control-center/session-log    — paginated session history + billing metrics
 *   GET  /admin/control-center/usage-caps     — per-key daily usage vs global cap
 *   GET  /admin/control-center/wallet-expiry  — per-key idle/expiry status
 */

import { Router } from "express";
import { db, licenseKeysTable, sessionsTable, settingsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { getBillingRate } from "../lib/billing-rate-cache";
import {
  DECART_API_COST_PER_SEC,
  licenseRemainingSeconds,
} from "../lib/billing-math";
import { logger } from "../lib/logger";

const router = Router();

// ── Setting keys (namespaced to avoid collision) ──────────────────────────────
const SK = {
  usageCapEnabled:     "cc_usage_cap_enabled",
  usageCapMinutes:     "cc_usage_cap_minutes_per_day",
  walletExpiryEnabled: "cc_wallet_expiry_enabled",
  walletExpiryDays:    "cc_wallet_expiry_days",
} as const;

interface CCSettings {
  usageCapEnabled:     boolean;
  usageCapMinutes:     number;
  walletExpiryEnabled: boolean;
  walletExpiryDays:    number;
}

async function getCCSettings(): Promise<CCSettings> {
  const rows = await db.execute(sql`
    SELECT key, value FROM settings WHERE key LIKE 'cc_%'
  `);
  const map: Record<string, string> = {};
  for (const r of (rows as any).rows as any[]) map[r.key] = r.value;
  return {
    usageCapEnabled:     map[SK.usageCapEnabled]     === "true",
    usageCapMinutes:     Number(map[SK.usageCapMinutes]    ?? "60"),
    walletExpiryEnabled: map[SK.walletExpiryEnabled]  === "true",
    walletExpiryDays:    Number(map[SK.walletExpiryDays]   ?? "30"),
  };
}

async function upsertSetting(key: string, value: string) {
  await db.execute(sql`
    INSERT INTO settings (key, value)
    VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);
}

// ── GET /settings ─────────────────────────────────────────────────────────────
router.get("/settings", requireAdmin, async (_req, res) => {
  try {
    const settings = await getCCSettings();
    res.json(settings);
  } catch (err) {
    logger.error({ err }, "[ControlCenter] settings get failed");
    res.status(500).json({ error: "Failed to load settings" });
  }
});

// ── PUT /settings ─────────────────────────────────────────────────────────────
router.put("/settings", requireAdmin, async (req, res) => {
  try {
    const body = req.body as Partial<CCSettings>;
    if (body.usageCapEnabled !== undefined) {
      await upsertSetting(SK.usageCapEnabled, String(Boolean(body.usageCapEnabled)));
    }
    if (body.usageCapMinutes !== undefined) {
      const v = Number(body.usageCapMinutes);
      if (!Number.isFinite(v) || v < 1) {
        res.status(400).json({ error: "usageCapMinutes must be >= 1" });
        return;
      }
      await upsertSetting(SK.usageCapMinutes, String(Math.round(v)));
    }
    if (body.walletExpiryEnabled !== undefined) {
      await upsertSetting(SK.walletExpiryEnabled, String(Boolean(body.walletExpiryEnabled)));
    }
    if (body.walletExpiryDays !== undefined) {
      const v = Number(body.walletExpiryDays);
      if (!Number.isFinite(v) || v < 1) {
        res.status(400).json({ error: "walletExpiryDays must be >= 1" });
        return;
      }
      await upsertSetting(SK.walletExpiryDays, String(Math.round(v)));
    }
    const updated = await getCCSettings();
    logger.info({ updated }, "[ControlCenter] settings updated");
    res.json({ ok: true, settings: updated });
  } catch (err) {
    logger.error({ err }, "[ControlCenter] settings update failed");
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// ── GET /session-log ──────────────────────────────────────────────────────────
router.get("/session-log", requireAdmin, async (req, res) => {
  try {
    const globalRate = await getBillingRate();
    const limit      = Math.min(parseInt(String(req.query.limit  ?? "100"), 10), 500);
    const offset     = parseInt(String(req.query.offset ?? "0"), 10);
    const keyFilter  = req.query.licenseKeyId ? parseInt(String(req.query.licenseKeyId), 10) : null;

    const whereClause = keyFilter != null
      ? sql`WHERE s.license_key_id = ${keyFilter}`
      : sql``;

    const rows = await db.execute(sql`
      SELECT
        s.id,
        s.status,
        s.started_at,
        s.stopped_at,
        s.duration_seconds,
        s.style,
        s.package_label,
        s.billing_started_at,
        s.last_heartbeat_at,
        lk.key        AS license_key,
        lk.id         AS license_key_id,
        lk.custom_billing_rate,
        lk.use_custom_billing_rate,
        dk.label      AS decart_key_label
      FROM sessions s
      LEFT JOIN license_keys lk ON lk.id = s.license_key_id
      LEFT JOIN decart_api_keys dk ON dk.id = s.decart_key_id
      ${whereClause}
      ORDER BY s.started_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countRow = await db.execute(
      keyFilter != null
        ? sql`SELECT COUNT(*)::int AS count FROM sessions WHERE license_key_id = ${keyFilter}`
        : sql`SELECT COUNT(*)::int AS count FROM sessions`
    );

    const sessions = ((rows as any).rows as any[]).map(s => {
      const useCustom  = Boolean(s.use_custom_billing_rate);
      const customRate = s.custom_billing_rate != null ? Number(s.custom_billing_rate) : null;
      const effRate    = useCustom && customRate != null && customRate >= 0.1 ? customRate : globalRate;
      const durSec     = Number(s.duration_seconds ?? 0);
      const realSec    = effRate > 0 ? Math.round(durSec * DECART_API_COST_PER_SEC / effRate) : durSec;
      const revenue    = Math.round(durSec * effRate * 100) / 100;
      const cost       = Math.round(realSec * DECART_API_COST_PER_SEC * 100) / 100;
      const profit     = Math.round((revenue - cost) * 100) / 100;
      const marginPct  = effRate > 0
        ? Math.round(((effRate - DECART_API_COST_PER_SEC) / DECART_API_COST_PER_SEC) * 10000) / 100 : 0;
      return {
        sessionId:       String(s.id),
        licenseKey:      s.license_key      ? String(s.license_key)      : null,
        licenseKeyId:    s.license_key_id   ? Number(s.license_key_id)   : null,
        decartKeyLabel:  s.decart_key_label ? String(s.decart_key_label) : null,
        status:          String(s.status),
        startedAt:       s.started_at       ? new Date(s.started_at).toISOString() : null,
        stoppedAt:       s.stopped_at       ? new Date(s.stopped_at).toISOString() : null,
        durationSeconds: durSec,
        realStreamSeconds: realSec,
        style:           s.style         ?? null,
        packageLabel:    s.package_label ?? null,
        billingRate:     effRate,
        revenue, cost, profit, marginPct,
      };
    });

    res.json({
      sessions,
      total:  Number((countRow as any).rows?.[0]?.count ?? sessions.length),
      offset, limit,
      globalBillingRate: globalRate,
    });
  } catch (err) {
    logger.error({ err }, "[ControlCenter] session-log failed");
    res.status(500).json({ error: "Failed to load session log" });
  }
});

// ── GET /usage-caps ───────────────────────────────────────────────────────────
router.get("/usage-caps", requireAdmin, async (_req, res) => {
  try {
    const [globalRate, settings] = await Promise.all([getBillingRate(), getCCSettings()]);
    const capSec = settings.usageCapMinutes * 60;

    const rows = await db.execute(sql`
      SELECT
        lk.id, lk.key, lk.is_active, lk.minutes_allocated, lk.used_seconds,
        lk.custom_billing_rate, lk.use_custom_billing_rate,
        COUNT(s.id) FILTER (WHERE s.status = 'active')              AS live_count,
        COALESCE(SUM(s.duration_seconds)
          FILTER (WHERE s.started_at >= CURRENT_DATE), 0)           AS today_seconds,
        COUNT(s.id) FILTER (WHERE s.started_at >= CURRENT_DATE)     AS today_sessions
      FROM license_keys lk
      LEFT JOIN sessions s ON s.license_key_id = lk.id
      GROUP BY lk.id
      ORDER BY today_seconds DESC
    `);

    const keys = ((rows as any).rows as any[]).map(lk => {
      const useCustom  = Boolean(lk.use_custom_billing_rate);
      const customRate = lk.custom_billing_rate != null ? Number(lk.custom_billing_rate) : null;
      const effRate    = useCustom && customRate != null && customRate >= 0.1 ? customRate : globalRate;
      const todaySec   = Number(lk.today_seconds ?? 0);
      const capReached = settings.usageCapEnabled && capSec > 0 && todaySec >= capSec;
      return {
        licenseKeyId:      Number(lk.id),
        licenseKey:        String(lk.key),
        isActive:          Boolean(lk.is_active),
        effectiveRate:     effRate,
        todaySeconds:      todaySec,
        todaySessions:     Number(lk.today_sessions ?? 0),
        capSeconds:        capSec,
        capMinutes:        settings.usageCapMinutes,
        capUsedPct:        capSec > 0 ? Math.min(100, Math.round(todaySec / capSec * 100)) : 0,
        capReached,
        isLive:            Number(lk.live_count ?? 0) > 0,
        allocatedSeconds:  Math.round(Number(lk.minutes_allocated ?? 0) * 60),
        usedSeconds:       Number(lk.used_seconds ?? 0),
      };
    });

    res.json({ keys, settings, globalBillingRate: globalRate, asOf: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "[ControlCenter] usage-caps failed");
    res.status(500).json({ error: "Failed to load usage cap data" });
  }
});

// ── GET /wallet-expiry ────────────────────────────────────────────────────────
router.get("/wallet-expiry", requireAdmin, async (_req, res) => {
  try {
    const [globalRate, settings] = await Promise.all([getBillingRate(), getCCSettings()]);
    const expiryMs = settings.walletExpiryDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const rows = await db.execute(sql`
      SELECT
        lk.id, lk.key, lk.is_active, lk.minutes_allocated, lk.used_seconds,
        lk.last_used_at, lk.created_at,
        lk.custom_billing_rate, lk.use_custom_billing_rate,
        COUNT(s.id) FILTER (WHERE s.status = 'active') AS live_count
      FROM license_keys lk
      LEFT JOIN sessions s ON s.license_key_id = lk.id
      GROUP BY lk.id
      ORDER BY lk.last_used_at ASC NULLS FIRST
    `);

    const keys = ((rows as any).rows as any[]).map(lk => {
      const useCustom  = Boolean(lk.use_custom_billing_rate);
      const customRate = lk.custom_billing_rate != null ? Number(lk.custom_billing_rate) : null;
      const effRate    = useCustom && customRate != null && customRate >= 0.1 ? customRate : globalRate;
      const remainSec  = licenseRemainingSeconds(Number(lk.minutes_allocated ?? 0), Number(lk.used_seconds ?? 0));
      const lastUsed   = lk.last_used_at ? new Date(lk.last_used_at) : (lk.created_at ? new Date(lk.created_at) : null);
      const anchorMs   = lastUsed ? lastUsed.getTime() : now;
      const idleMs     = now - anchorMs;
      const idleDays   = Math.round(idleMs / (24 * 60 * 60 * 1000) * 10) / 10;
      const isExpired  = settings.walletExpiryEnabled && idleMs >= expiryMs;
      const daysLeft   = settings.walletExpiryEnabled
        ? Math.max(0, Math.round((expiryMs - idleMs) / (24 * 60 * 60 * 1000) * 10) / 10)
        : null;
      return {
        licenseKeyId:     Number(lk.id),
        licenseKey:       String(lk.key),
        isActive:         Boolean(lk.is_active),
        effectiveRate:    effRate,
        allocatedSeconds: Math.round(Number(lk.minutes_allocated ?? 0) * 60),
        usedSeconds:      Number(lk.used_seconds ?? 0),
        remainingSeconds: remainSec,
        lastUsedAt:       lastUsed?.toISOString() ?? null,
        idleDays,
        isExpired,
        daysUntilExpiry:  daysLeft,
        isLive:           Number(lk.live_count ?? 0) > 0,
      };
    });

    res.json({ keys, settings, globalBillingRate: globalRate, asOf: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "[ControlCenter] wallet-expiry failed");
    res.status(500).json({ error: "Failed to load wallet expiry data" });
  }
});

export default router;
