/**
   * admin-key-usage.ts — Per-licence-key billing summary
   *
   * SAFETY: Read-only. Never modifies any billing or session state.
   *
   * GET /api/admin/key-usage  — returns all licence keys with billing math:
   *   wallet seconds, billing rate, compression factor, expected real stream time,
   *   actual used seconds, session count, and how the last session stopped.
   */

  import { Router } from "express";
  import { db, sessionsTable, licenseKeysTable, sessionAccountingLogTable } from "@workspace/db";
  import { eq, desc, count } from "drizzle-orm";
  import { requireAdmin } from "../lib/auth";
  import { logger } from "../lib/logger";
  import { DECART_REAL_API_COST_RATE } from "../lib/billing-math";
  import { getBillingRateForLicense } from "../lib/billing-rate-cache";

  const router = Router();

  router.get("/", requireAdmin, async (req, res) => {
    try {
      // Fetch all licence keys
      const keys = await db.select().from(licenseKeysTable).orderBy(desc(licenseKeysTable.id));

      // For each key, get session count + last session + stop reason
      const results = await Promise.all(keys.map(async (key) => {
        let sessionCount = 0;
        let lastSession: any = null;
        let lastStopReason: string | null = null;
        let billingRate = 3; // fallback

        try {
          const [countRow] = await db
            .select({ count: count() })
            .from(sessionsTable)
            .where(eq(sessionsTable.licenseKeyId, key.id));
          sessionCount = Number(countRow?.count ?? 0);
        } catch { /* non-fatal */ }

        try {
          const [last] = await db
            .select()
            .from(sessionsTable)
            .where(eq(sessionsTable.licenseKeyId, key.id))
            .orderBy(desc(sessionsTable.startedAt))
            .limit(1);
          lastSession = last ?? null;

          // Billing rate: use snapshot from last session, else fetch live
          if (lastSession?.billingRateSnapshot) {
            billingRate = lastSession.billingRateSnapshot;
          } else {
            try { billingRate = await getBillingRateForLicense(key.id); } catch { /* use fallback */ }
          }
        } catch { /* non-fatal */ }

        try {
          if (lastSession?.id) {
            const [log] = await db
              .select({ sessionCloseReason: sessionAccountingLogTable.sessionCloseReason })
              .from(sessionAccountingLogTable)
              .where(eq(sessionAccountingLogTable.sessionId, lastSession.id));
            lastStopReason = log?.sessionCloseReason ?? null;
          }
        } catch { /* non-fatal */ }

        const walletSec = (key.minutesAllocated ?? 0) * 60;
        const compressionFactor = billingRate / DECART_REAL_API_COST_RATE;
        const expectedRealStreamSec = compressionFactor > 0
          ? Math.round(walletSec / compressionFactor)
          : walletSec;

        return {
          id: key.id,
          key: key.key,
          isActive: key.isActive,
          minutesAllocated: key.minutesAllocated ?? 0,
          walletSec,
          usedSeconds: key.usedSeconds ?? 0,
          remainingSec: Math.max(0, walletSec - (key.usedSeconds ?? 0)),
          billingRate: Math.round(billingRate * 1000) / 1000,
          compressionFactor: Math.round(compressionFactor * 1000) / 1000,
          expectedRealStreamSec,
          expectedRealStreamMin: Math.round((expectedRealStreamSec / 60) * 10) / 10,
          sessionCount,
          lastSessionId: lastSession?.id ?? null,
          lastSessionStatus: lastSession?.status ?? null,
          lastSessionStartedAt: lastSession?.startedAt ?? null,
          lastSessionStoppedAt: lastSession?.stoppedAt ?? null,
          lastStopReason,
          hasBeenUsed: sessionCount > 0,
        };
      }));

      res.json({ keys: results, decartCostRate: DECART_REAL_API_COST_RATE });
    } catch (err) {
      logger.error({ err }, "key-usage: failed");
      res.status(500).json({ error: "Internal error" });
    }
  });

  export default router;
  