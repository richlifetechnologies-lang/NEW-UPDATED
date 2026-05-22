/**
   * admin-billing-audit.ts — Session Billing Audit & Heartbeat Replay
   *
   * SAFETY: Read-only. Never modifies any billing, session, or wallet state.
   * Degrades gracefully on any DB error. Never throws to the client.
   *
   * GET /api/admin/billing-audit         ?sessionId=xxx  — full heartbeat replay
   * GET /api/admin/billing-audit/recent                  — list recent sessions
   */

  import { Router } from "express";
  import { db, sessionBillingEventsTable, sessionAccountingLogTable, sessionsTable, licenseKeysTable } from "@workspace/db";
  import { eq, desc, asc } from "drizzle-orm";
  import { requireAdmin } from "../lib/auth";
  import { logger } from "../lib/logger";
  import { DECART_REAL_API_COST_RATE } from "../lib/billing-math";

  const router = Router();

  // ── GET /api/admin/billing-audit/recent ─────────────────────────────────────
  router.get("/recent", requireAdmin, async (req, res) => {
    try {
      const sessions = await db
        .select({
          id: sessionsTable.id,
          status: sessionsTable.status,
          startedAt: sessionsTable.startedAt,
          stoppedAt: sessionsTable.stoppedAt,
          durationSeconds: sessionsTable.durationSeconds,
          billingRateSnapshot: sessionsTable.billingRateSnapshot,
          licenseKeyId: sessionsTable.licenseKeyId,
        })
        .from(sessionsTable)
        .orderBy(desc(sessionsTable.startedAt))
        .limit(30);
      res.json({ sessions });
    } catch (err) {
      logger.error({ err }, "billing-audit: failed to fetch recent sessions");
      res.json({ sessions: [] });
    }
  });

  // ── GET /api/admin/billing-audit ────────────────────────────────────────────
  router.get("/", requireAdmin, async (req, res) => {
    const sessionId = req.query["sessionId"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId query parameter is required" });
      return;
    }

    try {
      // 1. Session row
      let session: any = null;
      try {
        const [s] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
        session = s ?? null;
      } catch { /* non-fatal */ }

      // 2. License key
      let license: any = null;
      if (session?.licenseKeyId) {
        try {
          const [l] = await db.select().from(licenseKeysTable).where(eq(licenseKeysTable.id, session.licenseKeyId));
          license = l ?? null;
        } catch { /* non-fatal */ }
      }

      // 3. All billing events ordered oldest-first
      let events: any[] = [];
      try {
        events = await db
          .select()
          .from(sessionBillingEventsTable)
          .where(eq(sessionBillingEventsTable.sessionId, sessionId))
          .orderBy(asc(sessionBillingEventsTable.createdAt));
      } catch { /* non-fatal */ }

      // 4. Session accounting log (post-settlement data)
      let accountingLog: any = null;
      try {
        const [a] = await db
          .select()
          .from(sessionAccountingLogTable)
          .where(eq(sessionAccountingLogTable.sessionId, sessionId));
        accountingLog = a ?? null;
      } catch { /* non-fatal */ }

      // ── Billing math ────────────────────────────────────────────────────────
      const billingRate = session?.billingRateSnapshot ?? 3;
      const compressionFactor = billingRate / DECART_REAL_API_COST_RATE; // e.g. 3/2.3 ≈ 1.304
      const walletTotalSec = (license?.minutesAllocated ?? 0) * 60;
      const expectedRealStreamSec = compressionFactor > 0
        ? Math.round(walletTotalSec / compressionFactor)
        : walletTotalSec;

      // ── Heartbeat replay ────────────────────────────────────────────────────
      const heartbeatEvents = events.filter(
        e => e.eventType === "heartbeat_ok" || e.eventType === "heartbeat_exhausted"
      );
      let runningWalletSec = walletTotalSec;
      let prevTs: Date | null = null;
      const heartbeatReplay: any[] = [];

      for (const ev of heartbeatEvents) {
        const ts = new Date(ev.createdAt);
        const rawSecSinceLastBeat = prevTs
          ? Math.max(0, Math.floor((ts.getTime() - prevTs.getTime()) / 1000))
          : null;
        const compressedSec = rawSecSinceLastBeat !== null
          ? Math.round(rawSecSinceLastBeat * compressionFactor)
          : null;
        const walletBefore = runningWalletSec;
        if (compressedSec !== null) {
          runningWalletSec = Math.max(0, runningWalletSec - compressedSec);
        } else if (ev.walletRemainingSeconds != null) {
          runningWalletSec = ev.walletRemainingSeconds;
        }

        const drift = ev.walletRemainingSeconds != null
          ? Math.abs(runningWalletSec - ev.walletRemainingSeconds)
          : 0;

        heartbeatReplay.push({
          eventId: ev.id,
          eventType: ev.eventType,
          timestamp: ts.toISOString(),
          rawSecSinceLastBeat,
          compressionFactor: Math.round(compressionFactor * 1000) / 1000,
          compressedSecBilled: compressedSec,
          walletBefore,
          walletAfter: runningWalletSec,
          serverWalletRemaining: ev.walletRemainingSeconds ?? null,
          anomaly: (() => {
            if (compressedSec !== null && walletBefore <= 0) return "DEDUCTION_ON_EMPTY_WALLET";
            if (rawSecSinceLastBeat !== null && rawSecSinceLastBeat > 35) return "LATE_HEARTBEAT";
            if (drift > 5) return "WALLET_DRIFT";
            return null;
          })(),
        });
        prevTs = ts;
      }

      // ── Anomaly summary ─────────────────────────────────────────────────────
      const anomalies = heartbeatReplay.filter(h => h.anomaly !== null);
      const totalBilledSec = heartbeatReplay.reduce(
        (sum, h) => sum + (h.compressedSecBilled ?? 0), 0
      );
      const eventsAfterExhaustion = heartbeatReplay.filter((h, i) => {
        const prevEmpty = heartbeatReplay.slice(0, i).some(prev => prev.walletAfter <= 0);
        return prevEmpty && (h.compressedSecBilled ?? 0) > 0;
      });

      const actualStopTime = session?.stoppedAt ? new Date(session.stoppedAt) : null;
      const actualStartTime = session?.billingStartedAt
        ? new Date(session.billingStartedAt)
        : session?.startedAt ? new Date(session.startedAt) : null;
      const actualRealStreamSec = actualStartTime && actualStopTime
        ? Math.max(0, Math.floor((actualStopTime.getTime() - actualStartTime.getTime()) / 1000))
        : null;

      res.json({
        sessionId,
        session: session ? {
          id: session.id,
          status: session.status,
          startedAt: session.startedAt,
          billingStartedAt: session.billingStartedAt,
          lastDeductedAt: session.lastDeductedAt,
          stoppedAt: session.stoppedAt,
          durationSeconds: session.durationSeconds,
          billingRateSnapshot: session.billingRateSnapshot,
          licenseKeyId: session.licenseKeyId,
          decartSessionId: session.decartSessionId,
        } : null,
        license: license ? {
          key: license.key,
          minutesAllocated: license.minutesAllocated,
          usedSeconds: license.usedSeconds,
          walletTotalSec,
        } : null,
        billingMath: {
          billingRate,
          decartCostRate: DECART_REAL_API_COST_RATE,
          compressionFactor: Math.round(compressionFactor * 1000) / 1000,
          walletTotalSec,
          expectedRealStreamSec,
          expectedRealStreamMin: Math.round((expectedRealStreamSec / 60) * 10) / 10,
          actualRealStreamSec,
          formula: `${walletTotalSec}s ÷ (billingRate ${billingRate} ÷ Decart cost ${DECART_REAL_API_COST_RATE}) = ${walletTotalSec}s ÷ ${Math.round(compressionFactor * 1000) / 1000} = ${expectedRealStreamSec}s real stream time`,
        },
        events: events.map(e => ({
          id: e.id,
          eventType: e.eventType,
          timestamp: e.createdAt,
          walletRemainingSeconds: e.walletRemainingSeconds,
          metadata: e.metadata,
        })),
        heartbeatReplay,
        totals: {
          heartbeatCount: heartbeatEvents.length,
          totalBilledSec,
          anomalyCount: anomalies.length,
          anomalies,
          eventsAfterExhaustion,
          verdict: anomalies.length === 0 && eventsAfterExhaustion.length === 0
            ? "CLEAN" : "ANOMALIES_FOUND",
        },
        accountingLog: accountingLog ?? null,
      });
    } catch (err) {
      logger.error({ err }, "billing-audit: failed");
      res.status(500).json({ error: "Internal error during audit replay" });
    }
  });

  export default router;
  