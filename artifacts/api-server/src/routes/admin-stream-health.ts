/**
 * admin-stream-health.ts — Real-time stream health monitor endpoint.
 *
 * GET /api/admin/stream-health
 * Returns every active stream with:
 *   - which Decart key it is on
 *   - live burn rate (2.3 cr/s fixed Decart cost)
 *   - estimated minutes remaining based on wallet balance
 *   - elapsed seconds since stream started
 */

import { Router } from "express";
import { db, sessionsTable, licenseKeysTable, decartApiKeysTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import { DECART_CREDITS_PER_SEC } from "../lib/billing-math";

const router = Router();

router.get("/stream-health", requireAdmin, async (_req, res) => {
  try {
    const now = new Date();

    const activeSessions = await db
      .select({
        sessionId:          sessionsTable.id,
        sessionKey:         sessionsTable.sessionId,
        style:              sessionsTable.style,
        startedAt:          sessionsTable.startedAt,
        billingStartedAt:   sessionsTable.billingStartedAt,
        lastHeartbeatAt:    sessionsTable.lastHeartbeatAt,
        licenseKeyId:       licenseKeysTable.id,
        licenseKey:         licenseKeysTable.key,
        minutesAllocated:   licenseKeysTable.minutesAllocated,
        usedSeconds:        licenseKeysTable.usedSeconds,
        decartKeyId:        decartApiKeysTable.id,
        decartKeyLabel:     decartApiKeysTable.label,
        decartKeyActive:    decartApiKeysTable.isActive,
      })
      .from(sessionsTable)
      .leftJoin(licenseKeysTable, eq(sessionsTable.licenseKeyId, licenseKeysTable.id))
      .leftJoin(decartApiKeysTable, eq(licenseKeysTable.assignedDecartKeyId, decartApiKeysTable.id))
      .where(eq(sessionsTable.status, "active"));

    const streams = activeSessions.map((s) => {
      const elapsedSec = Math.floor(
        (now.getTime() - new Date(s.startedAt).getTime()) / 1000
      );

      const totalAllocatedSec = Math.round((s.minutesAllocated ?? 0) * 60);
      const usedSec = (s.usedSeconds ?? 0) + elapsedSec;
      const remainingSec = Math.max(0, totalAllocatedSec - usedSec);
      const estimatedMinsLeft = Math.floor(remainingSec / 60);

      const lastHb = s.lastHeartbeatAt ? new Date(s.lastHeartbeatAt) : null;
      const msSinceHeartbeat = lastHb ? now.getTime() - lastHb.getTime() : null;
      const heartbeatStatus: "ok" | "late" | "missing" =
        msSinceHeartbeat === null ? "missing"
        : msSinceHeartbeat > 35_000 ? "late"
        : "ok";

      return {
        sessionId:          s.sessionKey ?? String(s.sessionId),
        style:              s.style ?? "unknown",
        startedAt:          s.startedAt,
        elapsedSec,
        licenseKeyId:       s.licenseKeyId,
        licenseKey:         s.licenseKey ?? "—",
        minutesAllocated:   s.minutesAllocated ?? 0,
        usedSeconds:        usedSec,
        remainingSec,
        estimatedMinsLeft,
        burnRateCrPerSec:   DECART_CREDITS_PER_SEC,
        decartKeyId:        s.decartKeyId ?? null,
        decartKeyLabel:     s.decartKeyLabel ?? "Unassigned",
        decartKeyActive:    s.decartKeyActive ?? false,
        lastHeartbeatAt:    s.lastHeartbeatAt,
        heartbeatStatus,
        healthStatus:
          remainingSec < 300   ? "critical"   // < 5 min
          : remainingSec < 900 ? "warning"    // < 15 min
          : "healthy",
      };
    });

    const totalBurnRate = Math.round(streams.length * DECART_CREDITS_PER_SEC * 100) / 100;
    const totalRemainingSec = streams.reduce((s, r) => s + r.remainingSec, 0);

    const byDecartKey: Record<string, { label: string; count: number; totalRemainingSec: number }> = {};
    for (const s of streams) {
      const k = String(s.decartKeyId ?? "unassigned");
      if (!byDecartKey[k]) byDecartKey[k] = { label: s.decartKeyLabel, count: 0, totalRemainingSec: 0 };
      byDecartKey[k].count++;
      byDecartKey[k].totalRemainingSec += s.remainingSec;
    }

    res.json({
      fetchedAt: now.toISOString(),
      summary: {
        activeStreams:       streams.length,
        totalBurnRateCrSec: totalBurnRate,
        totalRemainingSec,
        decartKeysInUse:    Object.keys(byDecartKey).length,
      },
      byDecartKey,
      streams: streams.sort((a, b) => a.remainingSec - b.remainingSec),
    });
  } catch (err) {
    logger.error({ err }, "[StreamHealth] failed to load stream health");
    res.status(500).json({ error: "Failed to load stream health data" });
  }
});

export default router;
