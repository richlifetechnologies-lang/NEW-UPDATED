/**
 * admin-billing-intelligence.ts — ADDITIVE billing observability overlay.
 *
 * SAFETY CONTRACT:
 *  - Read-only against all existing tables (sessions, license_keys, etc.)
 *  - Writes ONLY to session_accounting_log (new additive table)
 *  - Does NOT call settleSession, heartbeat, or any live billing code
 *  - Does NOT modify existing admin routes
 *  - All errors are caught and return 500 without affecting callers
 *  - Feature-flagged via BILLING_INTELLIGENCE_ENABLED env var (defaults ON)
 *
 * Routes:
 *   GET  /admin/billing-intelligence/summary          — reconciliation cards
 *   GET  /admin/billing-intelligence/sessions         — per-session billing table
 *   GET  /admin/billing-intelligence/ghost-sessions   — anomaly monitoring
 *   GET  /admin/billing-intelligence/session/:id      — session detail
 *   POST /admin/billing-intelligence/record           — write one accounting row
 */

import { Router } from "express";
import { db, sessionsTable, licenseKeysTable, decartApiKeysTable, settingsTable } from "@workspace/db";
import { sessionAccountingLogTable } from "@workspace/db";
import { eq, sql, and, desc, isNull, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { DECART_CREDITS_PER_SEC, ORPHAN_GRACE_MS } from "../lib/billing-math";
import { getBillingRate } from "../lib/billing-rate-cache";
import { logger } from "../lib/logger";

const router = Router();

// ── Feature flag ──────────────────────────────────────────────────────────────
// Set BILLING_INTELLIGENCE_ENABLED=false to disable all new endpoints.
// All existing billing continues to function regardless of this flag.
const ENABLED = process.env.BILLING_INTELLIGENCE_ENABLED !== "false";

function featureGate(_req: any, res: any, next: any) {
  if (!ENABLED) {
    res.status(503).json({ error: "Billing Intelligence is disabled on this instance." });
    return;
  }
  next();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Detect anomaly description for a session row. Returns null if clean. */
function detectAnomaly(s: {
  status: string;
  billingStartedAt: Date | null;
  startedAt: Date;
  stoppedAt: Date | null;
  lastHeartbeatAt: Date | null;
  durationSeconds: number | null;
}): string | null {
  const anomalies: string[] = [];
  const now = Date.now();

  // Ghost: active but billing never started
  if (s.status === "active" && !s.billingStartedAt) {
    anomalies.push("active_no_billing_anchor");
  }

  // Ghost: stopped but duration is zero
  if (s.status !== "active" && (s.durationSeconds ?? 0) === 0 && s.billingStartedAt) {
    anomalies.push("zero_duration_settled");
  }

  // Orphan: active but no heartbeat for > ORPHAN_GRACE_MS
  if (s.status === "active") {
    const lastBeat = s.lastHeartbeatAt ?? s.startedAt;
    if (now - lastBeat.getTime() > ORPHAN_GRACE_MS) {
      anomalies.push("orphan_no_heartbeat");
    }
  }

  // Alive after stop: stopped_at set but status still active (race condition)
  if (s.status === "active" && s.stoppedAt) {
    anomalies.push("alive_after_stop");
  }

  return anomalies.length > 0 ? anomalies.join(", ") : null;
}

/** Compute derived billing metrics for one session row. */
function deriveMetrics(
  s: {
    startedAt: Date;
    stoppedAt: Date | null;
    billingStartedAt: Date | null;
    durationSeconds: number | null;
    status: string;
  },
  billingRate: number
) {
  const endMs = s.stoppedAt?.getTime() ?? Date.now();
  const computeSeconds = Math.max(0, Math.floor((endMs - s.startedAt.getTime()) / 1000));

  const billingAnchor = s.billingStartedAt ?? s.startedAt;
  const billingSeconds = s.durationSeconds != null
    ? s.durationSeconds
    : Math.max(0, Math.floor((endMs - billingAnchor.getTime()) / 1000));

  const actualApiCredits = computeSeconds * DECART_CREDITS_PER_SEC;

  // Retail: licence seconds charged = billingSeconds × billingRate ÷ 2
  // (matches the formula in sessions.ts heartbeat and settleSession)
  const retailSeconds = Math.round(billingSeconds * billingRate / 2);
  // Express retail in credits equivalent (×2 restores the baseline unit)
  const retailCreditsCharged = retailSeconds * 2;
  const profitMarginCredits = retailCreditsCharged - actualApiCredits;
  const effectiveCreditsPerSec = computeSeconds > 0
    ? Math.round((retailCreditsCharged / computeSeconds) * 100) / 100
    : 0;

  return {
    computeSeconds,
    billingSeconds,
    actualApiCredits,
    retailSeconds,
    retailCreditsCharged,
    profitMarginCredits,
    effectiveCreditsPerSec,
  };
}

// ── GET /summary ──────────────────────────────────────────────────────────────
router.get("/summary", requireAdmin, featureGate, async (_req, res) => {
  try {
    const billingRate = await getBillingRate();

    // Active sessions
    const [activeRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(sessionsTable)
      .where(eq(sessionsTable.status, "active"));
    const activeSessions = Number(activeRow?.count ?? 0);

    // Orphan sessions (active but no heartbeat for ORPHAN_GRACE_MS)
    const orphanCutoff = new Date(Date.now() - ORPHAN_GRACE_MS);
    const [orphanRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.status, "active"),
          sql`COALESCE(${sessionsTable.lastHeartbeatAt}, ${sessionsTable.startedAt}) < ${orphanCutoff}`
        )
      );
    const orphanSessions = Number(orphanRow?.count ?? 0);

    // Duplicate active sessions (same license_key_id with >1 active row)
    const dupResult = await db
      .select({
        licenseKeyId: sessionsTable.licenseKeyId,
        cnt: sql<number>`COUNT(*) as cnt`,
      })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.status, "active"), isNotNull(sessionsTable.licenseKeyId)))
      .groupBy(sessionsTable.licenseKeyId)
      .having(sql`COUNT(*) > 1`);
    const duplicateSessions = dupResult.length;

    // Total sessions (completed)
    const completedSessions = await db
      .select({
        totalComputeSec: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(stopped_at, NOW()) - started_at))::INTEGER), 0)`,
        totalBillingSec: sql<number>`COALESCE(SUM(COALESCE(duration_seconds, 0)), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(sessionsTable)
      .where(sql`status IN ('stopped','expired')`);

    const totalComputeSec = Number(completedSessions[0]?.totalComputeSec ?? 0);
    const totalBillingSec = Number(completedSessions[0]?.totalBillingSec ?? 0);
    const totalSessions = Number(completedSessions[0]?.count ?? 0);

    const totalActualApiCredits = totalComputeSec * DECART_CREDITS_PER_SEC;
    const totalRetailSeconds = Math.round(totalBillingSec * billingRate / 2);
    const totalRetailCredits = totalRetailSeconds * 2;
    const totalProfitMargin = totalRetailCredits - totalActualApiCredits;
    const avgEffectiveCreditsPerSec = totalComputeSec > 0
      ? Math.round((totalRetailCredits / totalComputeSec) * 100) / 100
      : 0;

    // Ghost sessions: active but billing_started_at is null and started > 30s ago
    const [ghostRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.status, "active"),
          isNull(sessionsTable.billingStartedAt),
          sql`${sessionsTable.startedAt} < NOW() - INTERVAL '30 seconds'`
        )
      );
    const ghostSessions = Number(ghostRow?.count ?? 0);

    // Reconnect loops: license keys with >3 sessions in last 10 minutes
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const reconnectResult = await db
      .select({
        licenseKeyId: sessionsTable.licenseKeyId,
        cnt: sql<number>`COUNT(*) as cnt`,
      })
      .from(sessionsTable)
      .where(
        and(
          isNotNull(sessionsTable.licenseKeyId),
          sql`${sessionsTable.startedAt} >= ${tenMinAgo}`
        )
      )
      .groupBy(sessionsTable.licenseKeyId)
      .having(sql`COUNT(*) > 3`);
    const reconnectLoopAlerts = reconnectResult.length;

    res.json({
      billingRate,
      activeSessions,
      orphanSessions,
      duplicateSessions,
      ghostSessions,
      reconnectLoopAlerts,
      totals: {
        totalSessions,
        totalComputeSeconds: totalComputeSec,
        totalBillingSeconds: totalBillingSec,
        totalActualApiCredits,
        totalRetailCredits,
        totalRetailSeconds,
        totalProfitMarginCredits: totalProfitMargin,
        averageEffectiveCreditsPerSec: avgEffectiveCreditsPerSec,
      },
    });
  } catch (err) {
    logger.error({ err }, "[BillingIntelligence] summary failed");
    res.status(500).json({ error: "Failed to compute billing summary" });
  }
});

// ── GET /sessions ─────────────────────────────────────────────────────────────
router.get("/sessions", requireAdmin, featureGate, async (req, res) => {
  try {
    const billingRate = await getBillingRate();
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "100"), 10), 500);
    const offset = parseInt(String(req.query["offset"] ?? "0"), 10);
    const statusFilter = req.query["status"] as string | undefined;

    const whereClause = statusFilter && ["active", "stopped", "expired"].includes(statusFilter)
      ? sql`s.status = ${statusFilter}`
      : sql`1=1`;

    const rows = await db.execute(sql`
      SELECT
        s.id                                                                AS session_id,
        lk.key                                                              AS license_key,
        s.license_key_id,
        s.decart_key_id,
        dk.label                                                            AS decart_key_label,
        s.status,
        s.started_at,
        s.stopped_at,
        s.billing_started_at,
        s.last_heartbeat_at,
        s.duration_seconds,
        s.style,
        s.package_label,
        EXTRACT(EPOCH FROM (COALESCE(s.stopped_at, NOW()) - s.started_at))::INTEGER
                                                                            AS compute_seconds,
        COALESCE(s.duration_seconds, 0)                                     AS billing_seconds
      FROM sessions s
      LEFT JOIN license_keys lk ON lk.id = s.license_key_id
      LEFT JOIN decart_api_keys dk ON dk.id = s.decart_key_id
      WHERE ${whereClause}
      ORDER BY s.started_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const sessions = (rows as any[]).map((row: any) => {
      const computeSeconds  = Number(row.compute_seconds ?? 0);
      const billingSeconds  = Number(row.billing_seconds ?? 0);
      const actualApiCredits = computeSeconds * DECART_CREDITS_PER_SEC;
      const retailSeconds   = Math.round(billingSeconds * billingRate / 2);
      const retailCredits   = retailSeconds * 2;
      const profit          = retailCredits - actualApiCredits;
      const effCr           = computeSeconds > 0
        ? Math.round((retailCredits / computeSeconds) * 100) / 100
        : 0;

      const anomaly = detectAnomaly({
        status: row.status,
        billingStartedAt: row.billing_started_at ? new Date(row.billing_started_at) : null,
        startedAt: new Date(row.started_at),
        stoppedAt: row.stopped_at ? new Date(row.stopped_at) : null,
        lastHeartbeatAt: row.last_heartbeat_at ? new Date(row.last_heartbeat_at) : null,
        durationSeconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
      });

      const isGhost =
        row.billing_started_at == null &&
        row.status !== "active" &&
        billingSeconds === 0 &&
        computeSeconds > 5;

      return {
        sessionId:             row.session_id,
        licenseKey:            row.license_key ?? null,
        licenseKeyId:          row.license_key_id ?? null,
        decartKeyId:           row.decart_key_id ?? null,
        decartKeyLabel:        row.decart_key_label ?? null,
        status:                row.status,
        startedAt:             row.started_at,
        stoppedAt:             row.stopped_at ?? null,
        billingStartedAt:      row.billing_started_at ?? null,
        lastHeartbeatAt:       row.last_heartbeat_at ?? null,
        style:                 row.style ?? null,
        packageLabel:          row.package_label ?? null,
        // ── Compute ───────────────────────────────────────────────────────
        computeSeconds,
        billingSeconds,
        // ── Actual Decart cost ────────────────────────────────────────────
        actualApiCredits,
        // ── Retail (user-facing) ──────────────────────────────────────────
        retailSeconds,
        retailCreditsCharged:  retailCredits,
        billingRateAtQuery:    billingRate,
        effectiveCreditsPerSec: effCr,
        profitMarginCredits:   profit,
        // ── Settlement ───────────────────────────────────────────────────
        settlementSource:      row.billing_started_at ? "wall_clock" : "unknown",
        sessionCloseReason:    null, // populated by record endpoint
        // ── Flags ─────────────────────────────────────────────────────────
        isGhostSession:        isGhost,
        anomalyFlag:           anomaly,
      };
    });

    res.json({ sessions, billingRate, count: sessions.length, limit, offset });
  } catch (err) {
    logger.error({ err }, "[BillingIntelligence] sessions query failed");
    res.status(500).json({ error: "Failed to load billing sessions" });
  }
});

// ── GET /ghost-sessions ───────────────────────────────────────────────────────
router.get("/ghost-sessions", requireAdmin, featureGate, async (_req, res) => {
  try {
    // 1. Sessions with no billing anchor but non-zero duration
    const zeroFrameSessions = await db.execute(sql`
      SELECT s.id, lk.key AS license_key, s.status, s.started_at, s.stopped_at,
             s.billing_started_at, s.last_heartbeat_at, s.duration_seconds,
             'zero_frames_but_billed' AS anomaly_type
      FROM sessions s
      LEFT JOIN license_keys lk ON lk.id = s.license_key_id
      WHERE s.billing_started_at IS NULL
        AND COALESCE(s.duration_seconds, 0) > 0
      ORDER BY s.started_at DESC
      LIMIT 100
    `);

    // 2. Duplicate active sessions (same license key has >1 active session)
    const duplicateActiveSessions = await db.execute(sql`
      SELECT s.id, lk.key AS license_key, s.status, s.started_at, s.last_heartbeat_at,
             'duplicate_active' AS anomaly_type
      FROM sessions s
      LEFT JOIN license_keys lk ON lk.id = s.license_key_id
      WHERE s.status = 'active'
        AND s.license_key_id IN (
          SELECT license_key_id FROM sessions
          WHERE status = 'active' AND license_key_id IS NOT NULL
          GROUP BY license_key_id HAVING COUNT(*) > 1
        )
      ORDER BY s.started_at DESC
      LIMIT 100
    `);

    // 3. Reconnect loops (>3 sessions for same license key in last 10 min)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const reconnectLoops = await db.execute(sql`
      SELECT lk.key AS license_key, COUNT(*) AS session_count,
             MIN(s.started_at) AS first_session, MAX(s.started_at) AS last_session
      FROM sessions s
      LEFT JOIN license_keys lk ON lk.id = s.license_key_id
      WHERE s.started_at >= ${tenMinAgo}
        AND s.license_key_id IS NOT NULL
      GROUP BY s.license_key_id, lk.key
      HAVING COUNT(*) > 3
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `);

    // 4. Stale active sessions (active but no heartbeat for ORPHAN_GRACE_MS)
    const orphanCutoff = new Date(Date.now() - ORPHAN_GRACE_MS);
    const staleSessions = await db.execute(sql`
      SELECT s.id, lk.key AS license_key, s.status, s.started_at,
             s.last_heartbeat_at, s.billing_started_at,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(s.last_heartbeat_at, s.started_at)))::INTEGER
               AS secs_since_last_heartbeat,
             'stale_orphan' AS anomaly_type
      FROM sessions s
      LEFT JOIN license_keys lk ON lk.id = s.license_key_id
      WHERE s.status = 'active'
        AND COALESCE(s.last_heartbeat_at, s.started_at) < ${orphanCutoff}
      ORDER BY s.started_at DESC
      LIMIT 100
    `);

    // 5. Deduction-freeze anomalies (active, billing started, but no recent deduction)
    const freezeCutoff = new Date(Date.now() - 45_000);
    const frozenSessions = await db.execute(sql`
      SELECT s.id, lk.key AS license_key, s.status, s.started_at,
             s.billing_started_at, s.last_deducted_at,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(s.last_deducted_at, s.billing_started_at)))::INTEGER
               AS secs_since_last_deduction,
             'deduction_freeze' AS anomaly_type
      FROM sessions s
      LEFT JOIN license_keys lk ON lk.id = s.license_key_id
      WHERE s.status = 'active'
        AND s.billing_started_at IS NOT NULL
        AND COALESCE(s.last_deducted_at, s.billing_started_at) < ${freezeCutoff}
      ORDER BY s.started_at DESC
      LIMIT 100
    `);

    res.json({
      zeroFrameSessions:     zeroFrameSessions   as any[],
      duplicateActiveSessions: duplicateActiveSessions as any[],
      reconnectLoops:        reconnectLoops       as any[],
      staleSessions:         staleSessions        as any[],
      frozenSessions:        frozenSessions       as any[],
      generatedAt:           new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[BillingIntelligence] ghost-sessions query failed");
    res.status(500).json({ error: "Failed to load ghost session data" });
  }
});

// ── GET /session/:id ──────────────────────────────────────────────────────────
router.get("/session/:sessionId", requireAdmin, featureGate, async (req, res) => {
  try {
    const { sessionId } = req.params as { sessionId: string };
    const billingRate = await getBillingRate();

    const rows = await db.execute(sql`
      SELECT
        s.*,
        lk.key AS license_key,
        lk.minutes_allocated,
        lk.used_seconds,
        dk.label AS decart_key_label
      FROM sessions s
      LEFT JOIN license_keys lk ON lk.id = s.license_key_id
      LEFT JOIN decart_api_keys dk ON dk.id = s.decart_key_id
      WHERE s.id = ${sessionId}
      LIMIT 1
    `);

    if (!(rows as any[]).length) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const row = (rows as any[])[0];
    const endMs = row.stopped_at ? new Date(row.stopped_at).getTime() : Date.now();
    const startMs = new Date(row.started_at).getTime();
    const billingAnchorMs = row.billing_started_at
      ? new Date(row.billing_started_at).getTime()
      : startMs;

    const computeSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
    const billingSeconds = row.duration_seconds != null
      ? Number(row.duration_seconds)
      : Math.max(0, Math.floor((endMs - billingAnchorMs) / 1000));

    const actualApiCredits = computeSeconds * DECART_CREDITS_PER_SEC;
    const retailSeconds = Math.round(billingSeconds * billingRate / 2);
    const retailCredits = retailSeconds * 2;
    const profitMargin = retailCredits - actualApiCredits;
    const effCr = computeSeconds > 0
      ? Math.round((retailCredits / computeSeconds) * 100) / 100
      : 0;

    const anomaly = detectAnomaly({
      status: row.status,
      billingStartedAt: row.billing_started_at ? new Date(row.billing_started_at) : null,
      startedAt: new Date(row.started_at),
      stoppedAt: row.stopped_at ? new Date(row.stopped_at) : null,
      lastHeartbeatAt: row.last_heartbeat_at ? new Date(row.last_heartbeat_at) : null,
      durationSeconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
    });

    // Billing lifecycle timeline
    const timeline: Array<{ event: string; ts: string; note?: string }> = [];
    timeline.push({ event: "session_created", ts: row.started_at, note: "started_at — Decart billing clock starts" });
    if (row.billing_started_at) {
      const loadingSec = Math.round((new Date(row.billing_started_at).getTime() - startMs) / 1000);
      timeline.push({ event: "first_frame_received", ts: row.billing_started_at, note: `billing_started_at — ${loadingSec}s loading delay` });
    }
    if (row.last_heartbeat_at) {
      timeline.push({ event: "last_heartbeat", ts: row.last_heartbeat_at });
    }
    if (row.stopped_at) {
      timeline.push({ event: "session_stopped", ts: row.stopped_at, note: `total: ${computeSeconds}s wall-clock, ${billingSeconds}s billed` });
    }
    timeline.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    // Also pull any accounting log rows for this session
    let accountingLog: any[] = [];
    try {
      accountingLog = await db
        .select()
        .from(sessionAccountingLogTable)
        .where(eq(sessionAccountingLogTable.sessionId, sessionId))
        .orderBy(desc(sessionAccountingLogTable.createdAt))
        .limit(20);
    } catch {
      // table might not exist yet — non-fatal
    }

    res.json({
      session: {
        sessionId: row.id,
        licenseKey: row.license_key ?? null,
        licenseKeyId: row.license_key_id ?? null,
        decartKeyId: row.decart_key_id ?? null,
        decartKeyLabel: row.decart_key_label ?? null,
        status: row.status,
        style: row.style ?? null,
        packageLabel: row.package_label ?? null,
        minutesAllocated: row.minutes_allocated ?? null,
        startedAt: row.started_at,
        stoppedAt: row.stopped_at ?? null,
        billingStartedAt: row.billing_started_at ?? null,
        lastHeartbeatAt: row.last_heartbeat_at ?? null,
        lastDeductedAt: row.last_deducted_at ?? null,
      },
      metrics: {
        computeSeconds,
        billingSeconds,
        actualApiCredits,
        retailSeconds,
        retailCreditsCharged: retailCredits,
        profitMarginCredits: profitMargin,
        effectiveCreditsPerSec: effCr,
        billingRateAtQuery: billingRate,
        settlementSource: row.billing_started_at ? "wall_clock" : "unknown",
        anomalyFlag: anomaly,
      },
      timeline,
      accountingLog,
    });
  } catch (err) {
    logger.error({ err }, "[BillingIntelligence] session detail failed");
    res.status(500).json({ error: "Failed to load session detail" });
  }
});

// ── POST /record ──────────────────────────────────────────────────────────────
// Called after a session is settled to persist an accounting log row.
// This is OPTIONAL — the GET endpoints compute metrics dynamically.
// If this insert fails, existing billing is completely unaffected.
router.post("/record", requireAdmin, featureGate, async (req, res) => {
  try {
    const body = req.body as {
      sessionId: string;
      licenseKey?: string;
      licenseKeyId?: number;
      decartKeyId?: number;
      startedAt?: string;
      stoppedAt?: string;
      billingStartedAt?: string;
      computeSeconds?: number;
      billingSeconds?: number;
      actualApiCredits?: number;
      retailSeconds?: number;
      retailCreditsCharged?: number;
      billingRateAtSettle?: number;
      profitMarginCredits?: number;
      effectiveCreditsPerSec?: number;
      settlementSource?: string;
      sessionCloseReason?: string;
      heartbeatDeductionsTotal?: number;
      finalSettlementTotal?: number;
      isGhostSession?: boolean;
      anomalyFlag?: string;
    };

    if (!body.sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    await db.insert(sessionAccountingLogTable).values({
      sessionId:              body.sessionId,
      licenseKey:             body.licenseKey,
      licenseKeyId:           body.licenseKeyId,
      decartKeyId:            body.decartKeyId,
      startedAt:              body.startedAt     ? new Date(body.startedAt)     : undefined,
      stoppedAt:              body.stoppedAt     ? new Date(body.stoppedAt)     : undefined,
      billingStartedAt:       body.billingStartedAt ? new Date(body.billingStartedAt) : undefined,
      computeSeconds:         body.computeSeconds,
      billingSeconds:         body.billingSeconds,
      actualApiCredits:       body.actualApiCredits,
      retailSeconds:          body.retailSeconds,
      retailCreditsCharged:   body.retailCreditsCharged,
      billingRateAtSettle:    body.billingRateAtSettle,
      effectiveCreditsPerSec: body.effectiveCreditsPerSec,
      profitMarginCredits:    body.profitMarginCredits,
      settlementSource:       body.settlementSource,
      sessionCloseReason:     body.sessionCloseReason,
      heartbeatDeductionsTotal: body.heartbeatDeductionsTotal,
      finalSettlementTotal:   body.finalSettlementTotal,
      isGhostSession:         body.isGhostSession ?? false,
      anomalyFlag:            body.anomalyFlag,
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[BillingIntelligence] record insert failed");
    res.status(500).json({ error: "Failed to record accounting entry" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STREAM LEDGER — Dynamic Billing Rate Reconciliation (additive, feature-flagged)
// ═══════════════════════════════════════════════════════════════════════════════
//
// SAFETY: Reads only from existing `sessions` and `license_keys` tables.
//         Writes only to `stream_ledger` (new) and `session_accounting_log.stream_group_id` (new col).
//         Billing rate is ALWAYS fetched dynamically via getBillingRate() — never hardcoded.
//         Feature-flagged via ENABLE_STREAM_LEDGER=false to disable entirely.
//         Zero impact on heartbeat, settlement, Decart, or WebSocket flows.

import { streamLedgerTable } from "@workspace/db";

const STREAM_LEDGER_ENABLED = process.env.ENABLE_STREAM_LEDGER !== "false";
const STREAM_GAP_MS = 5 * 60 * 1000; // 5 min gap between sessions = new stream

function streamLedgerGate(_req: any, res: any, next: any) {
  if (!STREAM_LEDGER_ENABLED) {
    res.status(503).json({ error: "Stream Ledger is disabled (ENABLE_STREAM_LEDGER=false)." });
    return;
  }
  next();
}

interface RawSession {
  session_id: string;
  license_key: string | null;
  license_key_id: number | null;
  status: string;
  started_at: Date | string;
  stopped_at: Date | string | null;
  billing_started_at: Date | string | null;
  last_heartbeat_at: Date | string | null;
  duration_seconds: number | null;
  billing_rate_snapshot: number | null;
}

interface StreamGroup {
  streamGroupId: string;
  licenseKey: string | null;
  licenseKeyId: number | null;
  sessions: RawSession[];
  streamStartMs: number;
  streamEndMs: number;
  fragmentationCount: number;
  isActive: boolean;
}

/** Group raw sessions into stream-level buckets by license key and time proximity. */
function groupIntoStreams(sessions: RawSession[]): StreamGroup[] {
  // Index by license_key_id (use "anon" for null)
  const byKey: Record<string, RawSession[]> = {};
  for (const s of sessions) {
    const k = String(s.license_key_id ?? "anon");
    if (!byKey[k]) byKey[k] = [];
    byKey[k].push(s);
  }

  const groups: StreamGroup[] = [];

  for (const [, keySessions] of Object.entries(byKey)) {
    keySessions.sort((a, b) =>
      new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
    );

    let current: StreamGroup | null = null;

    for (const s of keySessions) {
      const startMs = new Date(s.started_at).getTime();
      const endMs = s.stopped_at ? new Date(s.stopped_at).getTime() : Date.now();
      const isActive = s.status === "active";

      if (!current) {
        current = {
          streamGroupId: `sg_${s.license_key_id ?? "anon"}_${startMs}`,
          licenseKey: s.license_key,
          licenseKeyId: s.license_key_id,
          sessions: [s],
          streamStartMs: startMs,
          streamEndMs: endMs,
          fragmentationCount: 0,
          isActive,
        };
      } else {
        const prev = current.sessions[current.sessions.length - 1];
        const prevEndMs = prev.stopped_at
          ? new Date(prev.stopped_at).getTime()
          : Date.now();
        const gapMs = startMs - prevEndMs;

        if (gapMs < STREAM_GAP_MS) {
          // Same stream — absorb this session
          current.sessions.push(s);
          current.streamEndMs = Math.max(current.streamEndMs, endMs);
          if (gapMs > 0) current.fragmentationCount++;
          if (isActive) current.isActive = true;
        } else {
          // New stream — save current and start fresh
          groups.push(current);
          current = {
            streamGroupId: `sg_${s.license_key_id ?? "anon"}_${startMs}`,
            licenseKey: s.license_key,
            licenseKeyId: s.license_key_id,
            sessions: [s],
            streamStartMs: startMs,
            streamEndMs: endMs,
            fragmentationCount: 0,
            isActive,
          };
        }
      }
    }
    if (current) groups.push(current);
  }

  return groups;
}

/** Compute stream-level aggregates from grouped sessions.
 *  Billing rate is fetched dynamically and NEVER hardcoded. */
function aggregateStream(group: StreamGroup, liveBillingRate: number) {
  let totalComputeSeconds = 0;
  let totalBillingSeconds = 0;
  const billingRateHistory: Array<{ sessionId: string; billingRate: number; snapshotAt: string }> = [];

  for (const s of group.sessions) {
    const endMs = s.stopped_at ? new Date(s.stopped_at).getTime() : Date.now();
    const startMs = new Date(s.started_at).getTime();
    totalComputeSeconds += Math.max(0, Math.floor((endMs - startMs) / 1000));
    totalBillingSeconds += s.duration_seconds != null ? Number(s.duration_seconds) : 0;

    // Use per-session snapshot if stored, else use live rate
    const rateSnap = s.billing_rate_snapshot ?? liveBillingRate;
    billingRateHistory.push({
      sessionId: s.session_id,
      billingRate: rateSnap,
      snapshotAt: new Date(s.started_at).toISOString(),
    });
  }

  const totalApiCreditsUsed = totalComputeSeconds * DECART_CREDITS_PER_SEC;

  // Retail: always uses live billing rate from admin dashboard — never hardcoded
  const totalRetailSeconds = Math.round(totalBillingSeconds * liveBillingRate / 2);
  const totalRetailCreditsCharged = totalRetailSeconds * 2;
  const profitInCredits = totalRetailCreditsCharged - totalApiCreditsUsed;
  const effectiveCreditsPerSecond = totalComputeSeconds > 0
    ? Math.round((totalRetailCreditsCharged / totalComputeSeconds) * 100) / 100
    : 0;

  return {
    totalComputeSeconds,
    totalBillingSeconds,
    totalApiCreditsUsed,
    totalRetailSeconds,
    totalRetailCreditsCharged,
    profitInCredits,
    effectiveCreditsPerSecond,
    billingRateHistory,
    lastBillingRateUsed: liveBillingRate,
    streamDurationSeconds: Math.floor((group.streamEndMs - group.streamStartMs) / 1000),
  };
}

// ── GET /stream-ledger/live ───────────────────────────────────────────────────
// Computes stream groupings live from the sessions table. No caching.
// Billing rate fetched dynamically — reflects admin dashboard changes instantly.
router.get("/stream-ledger/live", requireAdmin, featureGate, streamLedgerGate, async (req, res) => {
  try {
    // Always fetch billing rate dynamically
    const billingRate = await getBillingRate();

    const limit = Math.min(parseInt(String(req.query["limit"] ?? "200"), 10), 1000);
    const activeOnly = req.query["active"] === "true";

    const whereClause = activeOnly ? sql`s.status = 'active'` : sql`1=1`;

    const rows = await db.execute(sql`
      SELECT
        s.id                                              AS session_id,
        lk.key                                            AS license_key,
        s.license_key_id,
        s.status,
        s.started_at,
        s.stopped_at,
        s.billing_started_at,
        s.last_heartbeat_at,
        s.duration_seconds,
        NULL                                              AS billing_rate_snapshot
      FROM sessions s
      LEFT JOIN license_keys lk ON lk.id = s.license_key_id
      WHERE ${whereClause}
      ORDER BY s.started_at DESC
      LIMIT ${limit}
    `);

    const sessions = rows as unknown as RawSession[];
    const groups = groupIntoStreams(sessions);

    const result = groups.map(group => {
      const agg = aggregateStream(group, billingRate);
      return {
        streamGroupId: group.streamGroupId,
        licenseKey: group.licenseKey,
        licenseKeyId: group.licenseKeyId,
        totalSessions: group.sessions.length,
        fragmentationCount: group.fragmentationCount,
        isActive: group.isActive,
        streamStartTime: new Date(group.streamStartMs).toISOString(),
        streamEndTime: new Date(group.streamEndMs).toISOString(),
        ...agg,
        // Current billing rate from admin dashboard — live, not cached
        currentBillingRate: billingRate,
        sessionIds: group.sessions.map(s => s.session_id),
      };
    });

    // Sort: active first, then by streamStartTime desc
    result.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return new Date(b.streamStartTime).getTime() - new Date(a.streamStartTime).getTime();
    });

    res.json({
      streams: result,
      currentBillingRate: billingRate,
      totalStreams: result.length,
      activeStreams: result.filter(r => r.isActive).length,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[StreamLedger] live query failed");
    res.status(500).json({ error: "Failed to compute live stream ledger" });
  }
});

// ── GET /stream-ledger ────────────────────────────────────────────────────────
// Returns pre-computed stream ledger records from the stream_ledger table.
// Falls back to live computation if table is empty.
router.get("/stream-ledger", requireAdmin, featureGate, streamLedgerGate, async (req, res) => {
  try {
    const billingRate = await getBillingRate();
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "100"), 10), 500);

    let records: any[] = [];
    try {
      records = await db
        .select()
        .from(streamLedgerTable)
        .orderBy(desc(streamLedgerTable.computedAt))
        .limit(limit);
    } catch {
      // Table might not exist yet if migration hasn't run — non-fatal
    }

    res.json({
      streams: records,
      currentBillingRate: billingRate,
      totalStreams: records.length,
      source: "persisted",
      note: records.length === 0
        ? "No persisted records yet. Use POST /stream-ledger/rebuild to compute and persist."
        : undefined,
    });
  } catch (err) {
    logger.error({ err }, "[StreamLedger] list failed");
    res.status(500).json({ error: "Failed to load stream ledger" });
  }
});

// ── POST /stream-ledger/rebuild ───────────────────────────────────────────────
// Recomputes all stream groups from the sessions table and upserts into stream_ledger.
// Billing rate is fetched dynamically — never hardcoded.
// Safe to run at any time — does not touch sessions, heartbeats, or billing.
router.post("/stream-ledger/rebuild", requireAdmin, featureGate, streamLedgerGate, async (req, res) => {
  try {
    // Billing rate fetched live from admin dashboard — never hardcoded
    const billingRate = await getBillingRate();

    const rows = await db.execute(sql`
      SELECT
        s.id                AS session_id,
        lk.key              AS license_key,
        s.license_key_id,
        s.status,
        s.started_at,
        s.stopped_at,
        s.billing_started_at,
        s.last_heartbeat_at,
        s.duration_seconds,
        NULL                AS billing_rate_snapshot
      FROM sessions s
      LEFT JOIN license_keys lk ON lk.id = s.license_key_id
      ORDER BY s.started_at ASC
    `);

    const sessions = rows as unknown as RawSession[];
    const groups = groupIntoStreams(sessions);

    let upserted = 0;
    let errors = 0;

    for (const group of groups) {
      try {
        const agg = aggregateStream(group, billingRate);
        const record = {
          streamGroupId:            group.streamGroupId,
          licenseKey:               group.licenseKey,
          licenseKeyId:             group.licenseKeyId,
          sessionIds:               JSON.stringify(group.sessions.map(s => s.session_id)),
          totalSessions:            group.sessions.length,
          fragmentationCount:       group.fragmentationCount,
          streamStartTime:          new Date(group.streamStartMs),
          streamEndTime:            new Date(group.streamEndMs),
          totalComputeSeconds:      agg.totalComputeSeconds,
          totalBillingSeconds:      agg.totalBillingSeconds,
          totalApiCreditsUsed:      agg.totalApiCreditsUsed,
          totalRetailSeconds:       agg.totalRetailSeconds,
          totalRetailCreditsCharged: agg.totalRetailCreditsCharged,
          profitInCredits:          agg.profitInCredits,
          effectiveCreditsPerSecond: agg.effectiveCreditsPerSecond,
          billingRateHistory:       JSON.stringify(agg.billingRateHistory),
          lastBillingRateUsed:      billingRate,
          isActive:                 group.isActive,
          updatedAt:                new Date(),
        };

        await db
          .insert(streamLedgerTable)
          .values(record)
          .onConflictDoUpdate({
            target: streamLedgerTable.streamGroupId,
            set: {
              totalSessions:            record.totalSessions,
              fragmentationCount:       record.fragmentationCount,
              sessionIds:               record.sessionIds,
              streamEndTime:            record.streamEndTime,
              totalComputeSeconds:      record.totalComputeSeconds,
              totalBillingSeconds:      record.totalBillingSeconds,
              totalApiCreditsUsed:      record.totalApiCreditsUsed,
              totalRetailSeconds:       record.totalRetailSeconds,
              totalRetailCreditsCharged: record.totalRetailCreditsCharged,
              profitInCredits:          record.profitInCredits,
              effectiveCreditsPerSecond: record.effectiveCreditsPerSecond,
              billingRateHistory:       record.billingRateHistory,
              lastBillingRateUsed:      record.lastBillingRateUsed,
              isActive:                 record.isActive,
              updatedAt:                record.updatedAt,
            },
          });
        upserted++;
      } catch {
        errors++;
      }
    }

    res.json({
      ok: true,
      streamsProcessed: groups.length,
      upserted,
      errors,
      billingRateUsed: billingRate,
      rebuiltAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[StreamLedger] rebuild failed");
    res.status(500).json({ error: "Stream ledger rebuild failed" });
  }
});

export default router;

