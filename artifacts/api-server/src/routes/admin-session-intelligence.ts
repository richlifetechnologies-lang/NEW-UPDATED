/**
 * admin-session-intelligence.ts — Session Intelligence API
 *
 * SAFETY: Read-only. Never modifies any billing, session, or wallet state.
 * Degrades gracefully — returns safe fallbacks on any DB error.
 * Never throws to the client.
 */

import { Router } from "express";
import { db, sessionBillingEventsTable, sessionsTable, licenseKeysTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import { broadcastEvent } from "../lib/billing-ws";

const router = Router();

// ── GET /api/admin/session-intelligence ──────────────────────────────────────
router.get("/", requireAdmin, async (req, res) => {
  const sessionId = req.query["sessionId"] as string | undefined;

  if (!sessionId) {
    res.status(400).json({ error: "sessionId query parameter is required" });
    return;
  }

  try {
    // Fetch session row
    let sessionRow: any = null;
    try {
      const [s] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
      sessionRow = s ?? null;
    } catch { /* non-fatal */ }

    // Fetch wallet state
    let walletRemaining: number | null = null;
    if (sessionRow?.licenseKeyId) {
      try {
        const [lic] = await db.select({
          minutesAllocated: licenseKeysTable.minutesAllocated,
          usedSeconds: licenseKeysTable.usedSeconds,
        }).from(licenseKeysTable).where(eq(licenseKeysTable.id, sessionRow.licenseKeyId));
        if (lic) {
          const allocated = (lic.minutesAllocated ?? 0) * 60;
          walletRemaining = Math.max(0, allocated - (lic.usedSeconds ?? 0));
        }
      } catch { /* non-fatal */ }
    }

    // Fetch last 200 events for this session
    let events: any[] = [];
    try {
      events = await db
        .select()
        .from(sessionBillingEventsTable)
        .where(eq(sessionBillingEventsTable.sessionId, sessionId))
        .orderBy(desc(sessionBillingEventsTable.createdAt))
        .limit(200);
      events = events.reverse(); // chronological order
    } catch { /* non-fatal */ }

    // ── Risk flag computation ─────────────────────────────────────────────────
    const now = Date.now();
    const lastHeartbeat = sessionRow?.lastHeartbeatAt ? new Date(sessionRow.lastHeartbeatAt).getTime() : null;
    const lastDeducted = sessionRow?.lastDeductedAt ? new Date(sessionRow.lastDeductedAt).getTime() : null;

    const orphanRisk =
      sessionRow?.status === "active" &&
      lastHeartbeat != null &&
      now - lastHeartbeat > 90_000; // approaching 120s orphan threshold

    const billingFreezeRisk =
      sessionRow?.status === "active" &&
      lastDeducted != null &&
      now - lastDeducted > 30_000; // approaching 45s freeze threshold

    const tokenReuseCount = events.filter(e => e.eventType === "token_cache_hit").length;
    const tokenIssueCount = events.filter(e => e.eventType === "token_issued").length;
    const tokenReuseRisk = tokenReuseCount > 0 && tokenIssueCount === 0;

    const timeline = events.map(e => ({
      type: e.eventType,
      timestamp: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
      walletRemainingSeconds: e.walletRemainingSeconds ?? null,
      metadata: e.metadata ?? null,
    }));

    res.json({
      sessionId,
      decartSessionId: sessionRow?.decartSessionId ?? null,
      status: sessionRow?.status ?? "unknown",
      walletRemainingSeconds: walletRemaining,
      totalEvents: events.length,
      eventTimeline: timeline,
      riskFlags: {
        orphanRisk: !!orphanRisk,
        billingFreezeRisk: !!billingFreezeRisk,
        tokenReuseRisk: !!tokenReuseRisk,
      },
    });
  } catch (err) {
    logger.warn({ err, sessionId }, "[SessionIntelligence] query failed (non-fatal)");
    res.json({
      sessionId,
      decartSessionId: null,
      status: "unknown",
      walletRemainingSeconds: null,
      totalEvents: 0,
      eventTimeline: [],
      riskFlags: { orphanRisk: false, billingFreezeRisk: false, tokenReuseRisk: false },
    });
  }
});

// ── WebSocket helper: emit session_billing_event_created ─────────────────────
// Called from logSessionBillingEvent after successful insert.
// Backward compatible — new event type only, existing consumers unaffected.
export function emitSessionBillingEventCreated(
  sessionId: string,
  eventType: string,
  walletRemainingSeconds: number | null,
): void {
  try {
    broadcastEvent({
      type: "session_billing_event_created" as any,
      ts: new Date().toISOString(),
      payload: { sessionId, eventType, walletRemainingSeconds, timestamp: new Date().toISOString() },
    });
  } catch { /* non-fatal */ }
}

export default router;
