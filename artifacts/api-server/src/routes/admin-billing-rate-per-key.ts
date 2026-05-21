/**
 * admin-billing-rate-per-key.ts — Per-license billing rate management.
 *
 * SAFETY CONTRACT:
 *  - Additive only: only writes to license_keys.custom_billing_rate,
 *    use_custom_billing_rate, billing_rate_last_updated_at columns (new columns).
 *  - Does NOT touch wallet balances, sessions, stream ledger, or heartbeat engine.
 *  - Does NOT modify existing admin routes.
 *  - All errors are caught and return 500 without affecting callers.
 *  - Backward compatible: keys without custom rate continue to use global rate.
 *
 * Routes:
 *   GET  /admin/billing-rate-per-key              — list all keys with effective rates
 *   GET  /admin/billing-rate-per-key/:keyId       — single key detail
 *   PUT  /admin/billing-rate-per-key/:keyId       — set/update custom rate for a key
 *   DELETE /admin/billing-rate-per-key/:keyId/custom — disable custom rate for a key
 *
 * RATE PRIORITY (spec §1):
 *   effective_rate = license.custom_billing_rate   (if use_custom_billing_rate = true)
 *                  OR global_billing_rate           (fallback when custom disabled/null)
 */

import { Router } from "express";
import { db, licenseKeysTable, sessionsTable, settingsTable } from "@workspace/db";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive the effective billing rate for a row — 3-tier resolution order:
 *   1. license.custom_billing_rate (if use_custom_billing_rate = true)
 *   2. sub-admin billing rate override (if set on the creating sub-admin)
 *   3. global billing rate (system default fallback)
 */
function effectiveRate(
  useCustom: boolean | null,
  customRate: number | null,
  subAdminRate: number | null,
  globalRate: number
): number {
  if (useCustom === true && customRate != null && customRate >= 0.1) return customRate;
  if (subAdminRate != null && subAdminRate >= 0.1) return subAdminRate;
  return globalRate;
}

/**
 * Identifies the source tier of the effective rate.
 */
function rateSourceLabel(useCustom: boolean | null, customRate: number | null, subAdminRate: number | null): string {
  if (useCustom === true && customRate != null && customRate >= 0.1) return 'custom';
  if (subAdminRate != null && subAdminRate >= 0.1) return 'sub_admin';
  return 'global';
}

/**
 * Estimate stream duration in minutes given remaining seconds and effective rate.
 * Duration is wallet-based; rate affects revenue, not physical duration.
 */
function estimatedStreamDurationMin(remainingSeconds: number, _effectiveRate: number): number {
  return Math.round((remainingSeconds / 60) * 10) / 10;
}

/**
 * Compute projected profit margin % at a given billing rate.
 * profit_pct = (rate - 2.3) / 2.3 * 100  (profit-on-cost ratio)
 */
function projectedProfitPct(rate: number): number {
  if (rate <= 0) return 0;
  return Math.round(((rate - DECART_API_COST_PER_SEC) / DECART_API_COST_PER_SEC) * 10000) / 100;
}

// ── GET /admin/billing-rate-per-key ──────────────────────────────────────────
router.get("/", requireAdmin, async (req, res) => {
  try {
    const globalRate = await getBillingRate();
    const search = req.query["search"] as string | undefined;
    const limitRaw = Math.min(parseInt(String(req.query["limit"] ?? "500"), 10), 1000);
    const offsetRaw = parseInt(String(req.query["offset"] ?? "0"), 10);

    // Fetch all license keys with session aggregates
    const rows = await db.execute(sql`
      SELECT
        lk.id,
        lk.key,
        lk.is_active,
        lk.minutes_allocated,
        lk.used_seconds,
        lk.streaming_enabled,
        lk.last_used_at,
        lk.custom_billing_rate,
        lk.use_custom_billing_rate,
        lk.billing_rate_last_updated_at,
        lk.created_by_sub_admin_id,
        u.sub_admin_billing_rate,
        u.username AS sub_admin_username,
        COUNT(s.id) FILTER (WHERE s.status = 'active')  AS active_session_count,
        COALESCE(SUM(s.duration_seconds), 0)             AS session_used_seconds
      FROM license_keys lk
      LEFT JOIN users u ON u.id = lk.created_by_sub_admin_id
      LEFT JOIN sessions s ON s.license_key_id = lk.id
      ${search
        ? sql`WHERE lk.key ILIKE ${'%' + search + '%'}`
        : sql``}
      GROUP BY lk.id, u.sub_admin_billing_rate, u.username
      ORDER BY
        lk.use_custom_billing_rate DESC NULLS LAST,
        lk.last_used_at DESC NULLS LAST
      LIMIT ${limitRaw} OFFSET ${offsetRaw}
    `);

    const keys = ((rows as any).rows as any[]).map(lk => {
      const allocatedSec    = Math.round(Number(lk.minutes_allocated ?? 0) * 60);
      const usedSec         = Number(lk.used_seconds ?? 0);
      const remainingSec    = licenseRemainingSeconds(Number(lk.minutes_allocated ?? 0), usedSec);
      const customRate      = lk.custom_billing_rate != null ? Number(lk.custom_billing_rate) : null;
      const useCustom       = Boolean(lk.use_custom_billing_rate);
      const subAdminRate    = lk.sub_admin_billing_rate != null ? Number(lk.sub_admin_billing_rate) : null;
      const effRate         = effectiveRate(useCustom, customRate, subAdminRate, globalRate);
      const isLive          = Number(lk.active_session_count) > 0;

      const cf                 = computeCompressionFactor(effRate);
      const _allocDisplay      = Math.round(allocatedSec * cf);
      const _dispRem           = Math.round(remainingSec * cf);
      const _dispUsed          = _allocDisplay - _dispRem;
      return {
        licenseKeyId:              Number(lk.id),
        licenseKey:                String(lk.key),
        isActive:                  Boolean(lk.is_active),
        streamingEnabled:          Boolean(lk.streaming_enabled),
        // Rate columns
        globalBillingRate:         globalRate,
        customBillingRate:         customRate,
        useCustomBillingRate:      useCustom,
        billingRateLastUpdatedAt:  lk.billing_rate_last_updated_at ?? null,
        effectiveRate:             effRate,
        subAdminBillingRate:       subAdminRate,
        subAdminUsername:          lk.sub_admin_username ?? null,
        rateSource:                rateSourceLabel(useCustom, customRate, subAdminRate),
        // TCE — Time Compression Engine (display_used = alloc_display - display_remaining, NOT real_used × cf)
        compressionFactor:         cf,
        displaySecondsUsed:        _dispUsed,
        displaySecondsRemaining:   _dispRem,
        // Stream duration estimate (wallet-based; rate doesn't change duration, only revenue)
        remainingSeconds:          remainingSec,
        estimatedStreamDurationMin: estimatedStreamDurationMin(remainingSec, effRate),
        // Profit projection (spec §10)
        projectedProfitPct:        projectedProfitPct(effRate),
        profitPerSecond:           Math.round((effRate - DECART_API_COST_PER_SEC) * 100) / 100,
        // Live status
        isLive,
        activeSessionCount:        Number(lk.active_session_count ?? 0),
        // Wallet info
        minutesAllocated:          Math.round(allocatedSec / 60 * 100) / 100,
        allocatedSeconds:          allocatedSec,
        usedSeconds:               usedSec,
      };
    });

    const [totalRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(licenseKeysTable);

    res.json({
      keys,
      globalBillingRate:  globalRate,
      apiCostRate:        DECART_API_COST_PER_SEC,
      total:              Number(totalRow?.count ?? keys.length),
      returned:           keys.length,
      computedAt:         new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[BillingRatePerKey] list failed");
    res.status(500).json({ error: "Failed to load billing rate per key data" });
  }
});

// ── GET /admin/billing-rate-per-key/:keyId ───────────────────────────────────
router.get("/:keyId", requireAdmin, async (req, res) => {
  try {
    const keyId = parseInt(req.params.keyId, 10);
    if (!Number.isFinite(keyId)) {
      res.status(400).json({ error: "Invalid keyId" });
      return;
    }

    const globalRate = await getBillingRate();

    const [lk] = await db
      .select()
      .from(licenseKeysTable)
      .where(eq(licenseKeysTable.id, keyId));

    if (!lk) {
      res.status(404).json({ error: "License key not found" });
      return;
    }

    const customRate   = lk.customBillingRate != null ? Number(lk.customBillingRate) : null;
    const useCustom    = Boolean(lk.useCustomBillingRate);
    // Look up sub-admin billing rate for detail endpoint
    let subAdminRateDet: number | null = null;
    if (lk.createdBySubAdminId != null) {
      try {
        const saRes = await db.execute(`SELECT sub_admin_billing_rate FROM users WHERE id = ${lk.createdBySubAdminId} AND sub_admin_billing_rate IS NOT NULL LIMIT 1`);
        const saR = (saRes.rows as any[])[0]?.sub_admin_billing_rate;
        if (saR != null && Number.isFinite(Number(saR)) && Number(saR) >= 0.1) subAdminRateDet = Number(saR);
      } catch { /* non-fatal */ }
    }
    const effRate      = effectiveRate(useCustom, customRate, subAdminRateDet, globalRate);
    const remainSec  = licenseRemainingSeconds(Number(lk.minutesAllocated ?? 0), Number(lk.usedSeconds ?? 0));

    // Active session check
    const [activeRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(sessionsTable)
      .where(sql`${sessionsTable.licenseKeyId} = ${keyId} AND ${sessionsTable.status} = 'active'`);

    res.json({
      licenseKeyId:              keyId,
      licenseKey:                lk.key,
      isActive:                  lk.isActive,
      globalBillingRate:         globalRate,
      customBillingRate:         customRate,
      useCustomBillingRate:      useCustom,
      billingRateLastUpdatedAt:  lk.billingRateLastUpdatedAt ?? null,
      effectiveRate:             effRate,
      subAdminBillingRate:       subAdminRateDet,
      rateSource:                rateSourceLabel(useCustom, customRate, subAdminRateDet),
      compressionFactor:         computeCompressionFactor(effRate),
      remainingSeconds:          remainSec,
      displaySecondsRemaining:   Math.round(remainSec * computeCompressionFactor(effRate)),
      estimatedStreamDurationMin: estimatedStreamDurationMin(remainSec, effRate),
      projectedProfitPct:        projectedProfitPct(effRate),
      profitPerSecond:           Math.round((effRate - DECART_API_COST_PER_SEC) * 100) / 100,
      isLive:                    Number(activeRow?.count ?? 0) > 0,
      activeSessionCount:        Number(activeRow?.count ?? 0),
      apiCostRate:               DECART_API_COST_PER_SEC,
      checkedAt:                 new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[BillingRatePerKey] detail failed");
    res.status(500).json({ error: "Failed to load license key billing rate" });
  }
});

// ── PUT /admin/billing-rate-per-key/:keyId ───────────────────────────────────
// Body: { customBillingRate?: number, useCustomBillingRate?: boolean }
// Spec §6: changes MUST propagate instantly to wallet, burn engine, analytics.
// Since rates are fetched LIVE from DB on every call (no cache), any DB write
// instantly affects all downstream consumers on the next call.
router.put("/:keyId", requireAdmin, async (req, res) => {
  try {
    const keyId = parseInt(req.params.keyId, 10);
    if (!Number.isFinite(keyId)) {
      res.status(400).json({ error: "Invalid keyId" });
      return;
    }

    const body = req.body as {
      customBillingRate?: number;
      useCustomBillingRate?: boolean;
    };

    // Validate custom rate if provided
    if (body.customBillingRate !== undefined) {
      const rate = Number(body.customBillingRate);
      if (!Number.isFinite(rate) || rate < 0.1) {
        res.status(400).json({ error: "customBillingRate must be a positive number >= 0.1" });
        return;
      }
    }

    // Ensure key exists
    const [existing] = await db
      .select({ id: licenseKeysTable.id })
      .from(licenseKeysTable)
      .where(eq(licenseKeysTable.id, keyId));

    if (!existing) {
      res.status(404).json({ error: "License key not found" });
      return;
    }

    const updatePayload: Record<string, unknown> = {
      billingRateLastUpdatedAt: new Date(),
    };

    if (body.customBillingRate !== undefined) {
      updatePayload.customBillingRate = Number(body.customBillingRate);
    }
    if (body.useCustomBillingRate !== undefined) {
      updatePayload.useCustomBillingRate = Boolean(body.useCustomBillingRate);
    }

    await db
      .update(licenseKeysTable)
      .set(updatePayload as any)
      .where(eq(licenseKeysTable.id, keyId));

    // Return the updated effective rate immediately
    const globalRate = await getBillingRate();
    const [updated] = await db
      .select({
        customBillingRate:   licenseKeysTable.customBillingRate,
        useCustomBillingRate: licenseKeysTable.useCustomBillingRate,
        billingRateLastUpdatedAt: licenseKeysTable.billingRateLastUpdatedAt,
      })
      .from(licenseKeysTable)
      .where(eq(licenseKeysTable.id, keyId));

    // Re-fetch sub-admin rate for updated response
    let subAdminRatePut: number | null = null;
    try {
      const lkRow = await db.select({ createdBySubAdminId: licenseKeysTable.createdBySubAdminId }).from(licenseKeysTable).where(eq(licenseKeysTable.id, keyId));
      const saId = lkRow[0]?.createdBySubAdminId;
      if (saId != null) {
        const saRes = await db.execute(`SELECT sub_admin_billing_rate FROM users WHERE id = ${saId} AND sub_admin_billing_rate IS NOT NULL LIMIT 1`);
        const saR = (saRes.rows as any[])[0]?.sub_admin_billing_rate;
        if (saR != null && Number.isFinite(Number(saR)) && Number(saR) >= 0.1) subAdminRatePut = Number(saR);
      }
    } catch { /* non-fatal */ }
    const effRate = effectiveRate(
      Boolean(updated?.useCustomBillingRate),
      updated?.customBillingRate != null ? Number(updated.customBillingRate) : null,
      subAdminRatePut,
      globalRate
    );

    logger.info({ keyId, effRate, custom: updated?.customBillingRate, useCustom: updated?.useCustomBillingRate },
      "[BillingRatePerKey] rate updated");

    res.json({
      ok: true,
      licenseKeyId:         keyId,
      customBillingRate:    updated?.customBillingRate != null ? Number(updated.customBillingRate) : null,
      useCustomBillingRate: Boolean(updated?.useCustomBillingRate),
      effectiveRate:        effRate,
      rateSource:           rateSourceLabel(Boolean(updated?.useCustomBillingRate), updated?.customBillingRate != null ? Number(updated.customBillingRate) : null, subAdminRatePut),
      subAdminBillingRate:  subAdminRatePut,
      compressionFactor:    computeCompressionFactor(effRate),
      projectedProfitPct:   projectedProfitPct(effRate),
      updatedAt:            updated?.billingRateLastUpdatedAt ?? new Date(),
      propagatedAt:         new Date().toISOString(),
      note:                 "Rate is fetched live on every call — change instantly propagated to all systems",
    });
  } catch (err) {
    logger.error({ err }, "[BillingRatePerKey] update failed");
    res.status(500).json({ error: "Failed to update custom billing rate" });
  }
});

// ── DELETE /admin/billing-rate-per-key/:keyId/custom ─────────────────────────
// Disables custom rate for a key — it will revert to global rate.
router.delete("/:keyId/custom", requireAdmin, async (req, res) => {
  try {
    const keyId = parseInt(req.params.keyId, 10);
    if (!Number.isFinite(keyId)) {
      res.status(400).json({ error: "Invalid keyId" });
      return;
    }

    await db
      .update(licenseKeysTable)
      .set({
        useCustomBillingRate:     false,
        billingRateLastUpdatedAt: new Date(),
      } as any)
      .where(eq(licenseKeysTable.id, keyId));

    const globalRate = await getBillingRate();

    logger.info({ keyId }, "[BillingRatePerKey] custom rate disabled — reverted to global");

    res.json({
      ok: true,
      licenseKeyId: keyId,
      effectiveRate: globalRate,
      rateSource: "global",
      note: "Custom rate disabled. Key will now use global billing rate.",
    });
  } catch (err) {
    logger.error({ err }, "[BillingRatePerKey] disable failed");
    res.status(500).json({ error: "Failed to disable custom billing rate" });
  }
});

export default router;
