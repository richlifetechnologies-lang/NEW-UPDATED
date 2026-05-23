/**
 * admin-live-sessions.ts — Live session view with real streaming time remaining.
 *
 * GET /api/admin/live-sessions
 *   Returns every active session enriched with both wallet time AND real
 *   streaming time (adjusted for the admin billing-rate compression factor).
 *
 *   Wallet time   = what the license shows (drained at billingRate cr/s)
 *   Real stream time = actual Decart wall-clock time (wallet ÷ compressionFactor)
 *
 *   Example at billingRate = 3 cr/s (compressionFactor = 3 / 2.3 ≈ 1.304):
 *     60-min key → 46 min real stream total, 23 min real stream remaining when
 *     wallet is at 50%.
 *
 * SAFETY: Read-only. Never modifies billing, session, or wallet state.
 * Degrades gracefully — missing DB rows produce safe zero/null values.
 */

import { Router } from "express";
import { db, sessionsTable, licenseKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import { getBillingRateForLicense } from "../lib/billing-rate-cache";
import {
  computeCompressionFactor,
  ORPHAN_GRACE_MS,
  HARD_KILL_SAFETY_RESERVE_SEC,
} from "../lib/billing-math";

const router = Router();

// ── GET /api/admin/live-sessions ──────────────────────────────────────────────
router.get("/", requireAdmin, async (_req, res) => {
  try {
    const activeSessions = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.status, "active"));

    const now = Date.now();

    if (activeSessions.length === 0) {
      res.json({
        sessions: [],
        summary: {
          totalActive: 0,
          orphanCount: 0,
          criticalCount: 0,
          totalWalletRemainingSeconds: 0,
          totalRealStreamRemainingSeconds: 0,
        },
        queriedAt: new Date().toISOString(),
      });
      return;
    }

    const enriched = await Promise.all(
      activeSessions.map(async (session) => {
        // ── Wallet state from license_keys ───────────────────────────────────
        let minutesAllocated = 0;
        let walletAllocatedSeconds = 0;
        let walletUsedSeconds = 0;
        let licenseKeyMasked: string | null = null;

        if (session.licenseKeyId) {
          try {
            const [lic] = await db
              .select({
                minutesAllocated: licenseKeysTable.minutesAllocated,
                usedSeconds:      licenseKeysTable.usedSeconds,
                key:              licenseKeysTable.key,
              })
              .from(licenseKeysTable)
              .where(eq(licenseKeysTable.id, session.licenseKeyId));

            if (lic) {
              minutesAllocated      = lic.minutesAllocated ?? 0;
              walletAllocatedSeconds = minutesAllocated * 60;
              walletUsedSeconds      = lic.usedSeconds ?? 0;
              // Mask license key — show first 8 chars + "..."
              licenseKeyMasked = lic.key
                ? `${lic.key.slice(0, 8)}...`
                : null;
            }
          } catch { /* non-fatal — leave zeros */ }
        }

        const walletRemainingSeconds = Math.max(0, walletAllocatedSeconds - walletUsedSeconds);
        const walletUsedPct = walletAllocatedSeconds > 0
          ? Math.round((walletUsedSeconds / walletAllocatedSeconds) * 1000) / 10
          : 0;

        // ── Billing rate + compression factor for this license ────────────────
        let billingRate: number | null = null;
        let compressionFactor = 1.0;
        try {
          billingRate       = await getBillingRateForLicense(session.licenseKeyId ?? undefined);
          compressionFactor = computeCompressionFactor(billingRate);
        } catch { /* non-fatal — fall back to 1:1 */ }

        // ── Real streaming time (Decart wall-clock) ───────────────────────────
        // realStreamSeconds = walletSeconds / compressionFactor
        // At factor=1.304: 3600 wallet-s → 2760 real-s (46 min)
        const safeF = compressionFactor > 0 ? compressionFactor : 1;
        const realStreamAllocatedSeconds  = Math.round(walletAllocatedSeconds / safeF);
        const realStreamUsedSeconds       = Math.round(walletUsedSeconds / safeF);
        const realStreamRemainingSeconds  = Math.round(walletRemainingSeconds / safeF);

        // ── Session timing ────────────────────────────────────────────────────
        const startedAtMs    = session.startedAt  ? new Date(session.startedAt).getTime()  : now;
        const lastHbMs       = session.lastHeartbeatAt
          ? new Date(session.lastHeartbeatAt).getTime()
          : null;

        const wallClockElapsedSeconds  = Math.round((now - startedAtMs) / 1000);
        const secondsSinceHeartbeat    = lastHbMs != null
          ? Math.round((now - lastHbMs) / 1000)
          : null;
        const isOrphan = lastHbMs != null
          ? now - lastHbMs > ORPHAN_GRACE_MS
          : false;

        // Critical = wallet will expire within 2× the safety reserve
        const isCritical = walletRemainingSeconds <= HARD_KILL_SAFETY_RESERVE_SEC * 2;

        return {
          sessionId:       session.id,
          decartSessionId: session.decartSessionId ?? null,
          licenseKeyId:    session.licenseKeyId    ?? null,
          licenseKey:      licenseKeyMasked,
          decartKeyId:     session.decartKeyId     ?? null,
          status:          session.status,

          startedAt: session.startedAt instanceof Date
            ? session.startedAt.toISOString()
            : String(session.startedAt ?? ""),
          wallClockElapsedSeconds,
          secondsSinceHeartbeat,
          isOrphan,
          isCritical,

          // The admin-controlled billing compression applied to this session
          billingRate,
          compressionFactor,

          // Wallet (license-side) — what the admin allocated, drains at billingRate
          wallet: {
            minutesAllocated,
            allocatedSeconds:   walletAllocatedSeconds,
            usedSeconds:        walletUsedSeconds,
            remainingSeconds:   walletRemainingSeconds,
            remainingMinutes:   Math.round((walletRemainingSeconds  / 60) * 10) / 10,
            usedPercent:        walletUsedPct,
          },

          // Real stream (Decart-side) — actual wall-clock time
          // This is what Decart actually bills; lower than wallet due to compression
          realStream: {
            allocatedSeconds:  realStreamAllocatedSeconds,
            allocatedMinutes:  Math.round((realStreamAllocatedSeconds / 60) * 10) / 10,
            usedSeconds:       realStreamUsedSeconds,
            usedMinutes:       Math.round((realStreamUsedSeconds      / 60) * 10) / 10,
            remainingSeconds:  realStreamRemainingSeconds,
            remainingMinutes:  Math.round((realStreamRemainingSeconds / 60) * 10) / 10,
          },
        };
      })
    );

    // Sort: orphans first, then critical, then by wallet remaining (lowest = most urgent)
    enriched.sort((a, b) => {
      if (a.isOrphan   !== b.isOrphan)   return a.isOrphan   ? -1 : 1;
      if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
      return a.wallet.remainingSeconds - b.wallet.remainingSeconds;
    });

    const summary = {
      totalActive:                    enriched.length,
      orphanCount:                    enriched.filter(s => s.isOrphan).length,
      criticalCount:                  enriched.filter(s => s.isCritical).length,
      totalWalletRemainingSeconds:    enriched.reduce((n, s) => n + s.wallet.remainingSeconds,    0),
      totalRealStreamRemainingSeconds:enriched.reduce((n, s) => n + s.realStream.remainingSeconds, 0),
      totalWalletRemainingMinutes:    Math.round(
        (enriched.reduce((n, s) => n + s.wallet.remainingSeconds, 0) / 60) * 10) / 10,
      totalRealStreamRemainingMinutes: Math.round(
        (enriched.reduce((n, s) => n + s.realStream.remainingSeconds, 0) / 60) * 10) / 10,
    };

    res.json({ sessions: enriched, summary, queriedAt: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "[LiveSessions] query failed");
    res.status(500).json({ error: "Failed to load live session data" });
  }
});

export default router;
