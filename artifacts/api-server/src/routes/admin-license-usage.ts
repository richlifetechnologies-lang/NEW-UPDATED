/**
 * admin-license-usage.ts — Per-licence-key usage report with orphan-kill ICE surcharge detail
 *
 * SAFETY: Read-only. Never modifies any billing or session state.
 *
 * GET /api/admin/license-usage — returns all licence keys with:
 *   wallet balance, used/remaining seconds, session count, orphan-kill count,
 *   total ICE buffer seconds charged to the user, billing rate, and last session info.
 */

import { Router } from "express";
import { db, sessionsTable, licenseKeysTable, sessionBillingEventsTable, sessionAccountingLogTable } from "@workspace/db";
import { eq, desc, count, and, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import { DECART_REAL_API_COST_RATE, DECART_ICE_BUFFER_SEC } from "../lib/billing-math";
import { getBillingRateForLicense } from "../lib/billing-rate-cache";

const router = Router();

router.get("/", requireAdmin, async (req, res) => {
  try {
    const keys = await db.select().from(licenseKeysTable).orderBy(desc(licenseKeysTable.id));

    const results = await Promise.all(keys.map(async (key) => {
      let sessionCount = 0;
      let orphanKillCount = 0;
      let lastSession: any = null;
      let lastStopReason: string | null = null;
      let billingRate = 3;

      // Total session count for this key
      try {
        const [countRow] = await db
          .select({ count: count() })
          .from(sessionsTable)
          .where(eq(sessionsTable.licenseKeyId, key.id));
        sessionCount = Number(countRow?.count ?? 0);
      } catch { /* non-fatal */ }

      // Last session + billing rate
      try {
        const [last] = await db
          .select()
          .from(sessionsTable)
          .where(eq(sessionsTable.licenseKeyId, key.id))
          .orderBy(desc(sessionsTable.startedAt))
          .limit(1);
        lastSession = last ?? null;

        if (lastSession?.billingRateSnapshot) {
          billingRate = lastSession.billingRateSnapshot;
        } else {
          try { billingRate = await getBillingRateForLicense(key.id); } catch { /* use fallback */ }
        }
      } catch { /* non-fatal */ }

      // Orphan-kill count — join billing events through sessions so no large inArray is needed
      try {
        const [orphanRow] = await db
          .select({ count: count() })
          .from(sessionBillingEventsTable)
          .innerJoin(sessionsTable, eq(sessionsTable.id, sessionBillingEventsTable.sessionId))
          .where(and(
            eq(sessionsTable.licenseKeyId, key.id),
            sql`${sessionBillingEventsTable.eventType} IN ('orphan_kill', 'startup_orphan_kill')`
          ));
        orphanKillCount = Number(orphanRow?.count ?? 0);
      } catch { /* non-fatal — show 0 if table not yet populated */ }

      // Last stop reason from accounting log
      try {
        if (lastSession?.id) {
          const [log] = await db
            .select({ sessionCloseReason: sessionAccountingLogTable.sessionCloseReason })
            .from(sessionAccountingLogTable)
            .where(eq(sessionAccountingLogTable.sessionId, lastSession.id))
            .limit(1);
          lastStopReason = log?.sessionCloseReason ?? null;
        }
      } catch { /* non-fatal */ }

      const walletSec = (key.minutesAllocated ?? 0) * 60;
      const compressionFactor = billingRate / DECART_REAL_API_COST_RATE;
      const usedSeconds = key.usedSeconds ?? 0;
      const remainingSec = Math.max(0, walletSec - usedSeconds);
      const iceBufferRealSec = orphanKillCount * DECART_ICE_BUFFER_SEC;
      // Wallet seconds deducted specifically as ICE buffer surcharge
      const iceBufferWalletSec = Math.round(iceBufferRealSec * compressionFactor);

      return {
        id: key.id,
        key: key.key,
        isActive: key.isActive,
        minutesAllocated: key.minutesAllocated ?? 0,
        walletSec,
        usedSeconds,
        remainingSec,
        billingRate: Math.round(billingRate * 1000) / 1000,
        compressionFactor: Math.round(compressionFactor * 1000) / 1000,
        sessionCount,
        orphanKillCount,
        iceBufferRealSec,       // real seconds Decart burned (orphanKills × 45s)
        iceBufferWalletSec,     // compressed wallet seconds charged for ICE overage
        lastSessionId: lastSession?.id ?? null,
        lastSessionStatus: lastSession?.status ?? null,
        lastSessionStartedAt: lastSession?.startedAt ?? null,
        lastSessionStoppedAt: lastSession?.stoppedAt ?? null,
        lastStopReason,
        hasBeenUsed: sessionCount > 0,
        lastUsedAt: key.lastUsedAt ?? null,
      };
    }));

    res.json({ keys: results, iceBufferSec: DECART_ICE_BUFFER_SEC });
  } catch (err) {
    logger.error({ err }, "license-usage: failed");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
