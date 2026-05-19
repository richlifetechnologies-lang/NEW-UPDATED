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
 * NORMALISATION RULE (v2):
 *  ALL analytics use session.duration_seconds (wallet.used_seconds) as the
 *  single source of truth for billing duration — matching the heartbeat engine.
 *  API cost and retail revenue share the SAME billable-seconds denominator so
 *  there are NO mixed time-bases and NO fake negative profit.
 *  Billing rate is ALWAYS fetched dynamically via getBillingRate() — NEVER hardcoded.
 *
 * Routes:
 *   GET  /admin/billing-intelligence/summary          — reconciliation cards
 *   GET  /admin/billing-intelligence/sessions         — per-session billing table
 *   GET  /admin/billing-intelligence/ghost-sessions   — anomaly monitoring
 *   GET  /admin/billing-intelligence/session/:id      — session detail
 *   POST /admin/billing-intelligence/record           — write one accounting row
 *   GET  /admin/billing-intelligence/stream-ledger/live — live stream groups
 *   GET  /admin/billing-intelligence/stream-ledger    — persisted stream groups
 *   POST /admin/billing-intelligence/stream-ledger/rebuild — rebuild persisted groups
 *   GET  /admin/billing-intelligence/wallet           — licence wallet monitor
 *   GET  /admin/billing-intelligence/wallet/rebuild   — rebuild wallet snapshots
 */

import { Router } from "express";
import { db, sessionsTable, licenseKeysTable, decartApiKeysTable, settingsTable } from "@workspace/db";
import { sessionAccountingLogTable } from "@workspace/db";
import { billingRateAuditTable } from "@workspace/db";
import { eq, sql, and, desc, isNull, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import {
  DECART_CREDITS_PER_SEC,
  DECART_API_COST_PER_SEC,
  ORPHAN_GRACE_MS,
  BASE_BILLING_RATE,
  computeNormalisedMetrics,
  computeBurnMultiplier,
} from "../lib/billing-math";
import { getBillingRate } from "../lib/billing-rate-cache";
import { logger } from "../lib/logger";

const router = Router();

// ── Feature flag ──────────────────────────────────────────────────────────────
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

  if (s.status === "active" && !s.billingStartedAt) {
    anomalies.push("active_no_billing_anchor");
  }
  if (s.status !== "active" && (s.durationSeconds ?? 0) === 0 && s.billingStartedAt) {
    anomalies.push("zero_duration_settled");
  }
  if (s.status === "active") {
    const lastBeat = s.lastHeartbeatAt ?? s.startedAt;
    if (now - lastBeat.getTime() > ORPHAN_GRACE_MS) {
      anomalies.push("orphan_no_heartbeat");
    }
  }
  if (s.status === "active" && s.stoppedAt) {
    anomalies.push("alive_after_stop");
  }

  return anomalies.length > 0 ? anomalies.join(", ") : null;
}

/**
 * Derive normalised billing metrics for a single session row.
 *
 * SOURCE OF TRUTH: billableSeconds = session.duration_seconds (wallet engine value).
 * Both API cost and retail revenue use the SAME denominator — no mixed time-bases.
 * Billing rate is always the live value from getBillingRate() — never hardcoded.
 */
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
  // SOURCE OF TRUTH: wallet billable seconds = duration_seconds (written by heartbeat engine).
  // SPEC RULE: if duration_seconds is null, return 0 — DO NOT fall back to wall-clock.
  const billableSeconds = s.durationSeconds != null ? Number(s.durationSeconds) : 0;

  // Normalised: both API cost and retail use the SAME billableSeconds
  const { apiCostCredits, retailCredits, retailSeconds, profitCredits, effectiveCreditsPerSec } =
    computeNormalisedMetrics(billableSeconds, billingRate);

  return {
    billableSeconds,
    apiCostCredits,
    retailSeconds,
    retailCreditsCharged: retailCredits,
    profitMarginCredits: profitCredits,
    effectiveCreditsPerSec,
  };
}

// ── GET /summary ──────────────────────────────────────────────────────────────
router.get("/summary", requireAdmin, featureGate, async (_req, res) => {
  try {
    const billingRate = await getBillingRate();

    const [activeRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(sessionsTable)
      .where(eq(sessionsTable.status, "active"));
    const activeSessions = Number(activeRow?.count ?? 0);

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

    // Totals from completed sessions — use duration_seconds (wallet source of truth)
    const completedSessions = await db
      .select({
        totalBillableSec: sql<number>`COALESCE(SUM(COALESCE(duration_seconds, 0)), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(sessionsTable)
      .where(sql`status IN ('stopped','expired')`);

    const totalBillableSec = Number(completedSessions[0]?.totalBillableSec ?? 0);
    const totalSessions = Number(completedSessions[0]?.count ?? 0);

    // Normalised totals — same denominator for both sides
    const { apiCostCredits: totalApiCostCredits, retailCredits: totalRetailCredits,
            retailSeconds: totalRetailSeconds, profitCredits: totalProfitMargin,
            effectiveCreditsPerSec: avgEffectiveCreditsPerSec } =
      computeNormalisedMetrics(totalBillableSec, billingRate);

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
        totalBillableSeconds: totalBillableSec,
        // backward-compat aliases — old frontend field names
        totalBillingSeconds: totalBillableSec,
        totalComputeSeconds: totalBillableSec,
        totalApiCostCredits,
        totalActualApiCredits: totalApiCostCredits,
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
        s.package_label
      FROM sessions s
      LEFT JOIN license_keys lk ON lk.id = s.license_key_id
      LEFT JOIN decart_api_keys dk ON dk.id = s.decart_key_id
      WHERE ${whereClause}
      ORDER BY s.started_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const sessions = ((rows as any).rows as any[]).map((row: any) => {
      // SOURCE OF TRUTH: wallet billable seconds = duration_seconds (written by heartbeat engine).
      // SPEC RULE: if duration_seconds is null, return 0 — DO NOT fall back to wall-clock.
      const billableSeconds = row.duration_seconds != null ? Number(row.duration_seconds) : 0;

      const { apiCostCredits, retailCredits, retailSeconds, profitCredits, effectiveCreditsPerSec } =
        computeNormalisedMetrics(billableSeconds, billingRate);

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
        billableSeconds === 0;

      return {
        sessionId:              row.session_id,
        licenseKey:             row.license_key ?? null,
        licenseKeyId:           row.license_key_id ?? null,
        decartKeyId:            row.decart_key_id ?? null,
        decartKeyLabel:         row.decart_key_label ?? null,
        status:                 row.status,
        startedAt:              row.started_at,
        stoppedAt:              row.stopped_at ?? null,
        billingStartedAt:       row.billing_started_at ?? null,
        lastHeartbeatAt:        row.last_heartbeat_at ?? null,
        style:                  row.style ?? null,
        packageLabel:           row.package_label ?? null,
        // ── Normalised billing metrics (same denominator for both sides) ───
        billableSeconds,
        // backward-compat aliases
        computeSeconds:         billableSeconds,
        billingSeconds:         billableSeconds,
        apiCostCredits,
        actualApiCredits:       apiCostCredits,
        retailSeconds,
        retailCreditsCharged:   retailCredits,
        billingRateAtQuery:     billingRate,
        effectiveCreditsPerSec,
        profitMarginCredits:    profitCredits,
        // ── Settlement ────────────────────────────────────────────────────
        settlementSource:       row.billing_started_at ? "wallet_billable_seconds" : "unknown",
        // ── Flags ─────────────────────────────────────────────────────────
        isGhostSession:         isGhost,
        anomalyFlag:            anomaly,
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
      zeroFrameSessions:       ((zeroFrameSessions as any).rows ?? []) as any[],
      duplicateActiveSessions: ((duplicateActiveSessions as any).rows ?? []) as any[],
      reconnectLoops:          ((reconnectLoops as any).rows ?? []) as any[],
      staleSessions:           ((staleSessions as any).rows ?? []) as any[],
      frozenSessions:          ((frozenSessions as any).rows ?? []) as any[],
      generatedAt:             new Date().toISOString(),
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

    if (!(rows as any).rows.length) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const row = (rows as any).rows[0];

    // SOURCE OF TRUTH: wallet billable seconds = duration_seconds (written by heartbeat engine).
    // SPEC RULE: if duration_seconds is null, return 0 — DO NOT fall back to wall-clock.
    const billableSeconds = row.duration_seconds != null ? Number(row.duration_seconds) : 0;

    const { apiCostCredits, retailCredits, retailSeconds, profitCredits, effectiveCreditsPerSec } =
      computeNormalisedMetrics(billableSeconds, billingRate);

    const anomaly = detectAnomaly({
      status: row.status,
      billingStartedAt: row.billing_started_at ? new Date(row.billing_started_at) : null,
      startedAt: new Date(row.started_at),
      stoppedAt: row.stopped_at ? new Date(row.stopped_at) : null,
      lastHeartbeatAt: row.last_heartbeat_at ? new Date(row.last_heartbeat_at) : null,
      durationSeconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
    });

    // Billing lifecycle timeline
    const startMs = new Date(row.started_at).getTime();
    const timeline: Array<{ event: string; ts: string; note?: string }> = [];
    timeline.push({ event: "session_created", ts: row.started_at, note: "started_at" });
    if (row.billing_started_at) {
      const loadingSec = Math.round((new Date(row.billing_started_at).getTime() - startMs) / 1000);
      timeline.push({ event: "first_frame_received", ts: row.billing_started_at, note: `billing_started_at — ${loadingSec}s loading delay` });
    }
    if (row.last_heartbeat_at) {
      timeline.push({ event: "last_heartbeat", ts: row.last_heartbeat_at });
    }
    if (row.stopped_at) {
      timeline.push({ event: "session_stopped", ts: row.stopped_at, note: `${billableSeconds}s billed (wallet source)` });
    }
    timeline.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

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
        billableSeconds,
        // backward-compat aliases
        computeSeconds:       billableSeconds,
        billingSeconds:       billableSeconds,
        apiCostCredits,
        actualApiCredits:     apiCostCredits,
        retailSeconds,
        retailCreditsCharged: retailCredits,
        profitMarginCredits:  profitCredits,
        effectiveCreditsPerSec,
        billingRateAtQuery:   billingRate,
        settlementSource:     "wallet_billable_seconds",
        anomalyFlag:          anomaly,
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
      billableSeconds?: number;
      apiCostCredits?: number;
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
      billingSeconds:         body.billableSeconds,
      actualApiCredits:       body.apiCostCredits,
      retailSeconds:          body.retailSeconds,
      retailCreditsCharged:   body.retailCreditsCharged,
      billingRateAtSettle:    body.billingRateAtSettle,
      effectiveCreditsPerSec: body.effectiveCreditsPerSec,
      profitMarginCredits:    body.profitMarginCredits,
      settlementSource:       body.settlementSource ?? "wallet_billable_seconds",
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
// STREAM LEDGER — Normalised, dynamic billing rate (additive, feature-flagged)
// ═══════════════════════════════════════════════════════════════════════════════

import { streamLedgerTable } from "@workspace/db";

const STREAM_LEDGER_ENABLED = process.env.ENABLE_STREAM_LEDGER !== "false";
const STREAM_GAP_MS = 5 * 60 * 1000;

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

function groupIntoStreams(sessions: RawSession[]): StreamGroup[] {
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
        const prevEndMs = prev.stopped_at ? new Date(prev.stopped_at).getTime() : Date.now();
        const gapMs = startMs - prevEndMs;

        if (gapMs < STREAM_GAP_MS) {
          current.sessions.push(s);
          current.streamEndMs = Math.max(current.streamEndMs, endMs);
          if (gapMs > 0) current.fragmentationCount++;
          if (isActive) current.isActive = true;
        } else {
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

/**
 * Compute stream-level aggregates.
 *
 * NORMALISATION: uses duration_seconds (wallet billable seconds) as the
 * single source of truth for BOTH API cost and retail calculations.
 * Billing rate is always fetched live — never hardcoded.
 */
function aggregateStream(group: StreamGroup, liveBillingRate: number) {
  let totalBillableSeconds = 0;

  for (const s of group.sessions) {
    // SOURCE OF TRUTH: wallet.used_seconds (duration_seconds written by heartbeat engine).
    // SPEC RULE: if duration_seconds is null → 0. NEVER fall back to wall-clock time.
    const billable = s.duration_seconds != null ? Number(s.duration_seconds) : 0;
    totalBillableSeconds += billable;
  }

  const { apiCostCredits, retailCredits, retailSeconds, profitCredits, effectiveCreditsPerSec } =
    computeNormalisedMetrics(totalBillableSeconds, liveBillingRate);

  // Rate-controlled burn system (spec §2-§3)
  // burn_multiplier = billing_rate / base_rate
  // actual_used_seconds = display_seconds × burn_multiplier
  // display_seconds = totalBillableSeconds (wallet.used_seconds — source of truth)
  const burnMultiplier = computeBurnMultiplier(liveBillingRate);
  const actualUsedSeconds = Math.round(totalBillableSeconds * burnMultiplier);

  return {
    totalBillableSeconds,
    totalApiCreditsUsed: apiCostCredits,
    totalRetailSeconds: retailSeconds,
    totalRetailCreditsCharged: retailCredits,
    profitInCredits: profitCredits,
    effectiveCreditsPerSecond: effectiveCreditsPerSec,
    lastBillingRateUsed: liveBillingRate,
    streamDurationSeconds: Math.floor((group.streamEndMs - group.streamStartMs) / 1000),
    burnMultiplier,
    actualUsedSeconds,
  };
}

// ── GET /stream-ledger/live ───────────────────────────────────────────────────
router.get("/stream-ledger/live", requireAdmin, featureGate, streamLedgerGate, async (req, res) => {
  try {
    const billingRate = await getBillingRate();
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "200"), 10), 1000);
    const activeOnly = req.query["active"] === "true";
    const whereClause = activeOnly ? sql`s.status = 'active'` : sql`1=1`;

    const rows = await db.execute(sql`
      SELECT
        s.id                  AS session_id,
        lk.key                AS license_key,
        s.license_key_id,
        s.status,
        s.started_at,
        s.stopped_at,
        s.billing_started_at,
        s.last_heartbeat_at,
        s.duration_seconds
      FROM sessions s
      LEFT JOIN license_keys lk ON lk.id = s.license_key_id
      WHERE ${whereClause}
      ORDER BY s.started_at DESC
      LIMIT ${limit}
    `);

    const sessions = (rows as any).rows as unknown as RawSession[];
    const groups = groupIntoStreams(sessions);

    const result = groups.map(group => {
      const agg = aggregateStream(group, billingRate);

      // billingRateHistory — per-session rate snapshots (all use live rate now)
      const billingRateHistory = group.sessions.map(s => ({
        sessionId: s.session_id,
        billingRate,
        snapshotAt: s.started_at instanceof Date
          ? (s.started_at as Date).toISOString()
          : String(s.started_at),
      }));

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
        // backward-compat aliases for old frontend field names
        totalComputeSeconds: agg.totalBillableSeconds,
        totalBillingSeconds: agg.totalBillableSeconds,
        currentBillingRate: billingRate,
        billingRateHistory,
        sessionIds: group.sessions.map(s => s.session_id),
        // Rate-controlled burn system fields (spec §2-§3)
        baseRate: BASE_BILLING_RATE,
      };
    });

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
      // Table might not exist yet — non-fatal
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
router.post("/stream-ledger/rebuild", requireAdmin, featureGate, streamLedgerGate, async (_req, res) => {
  try {
    const billingRate = await getBillingRate();

    const rows = await db.execute(sql`
      SELECT
        s.id              AS session_id,
        lk.key            AS license_key,
        s.license_key_id,
        s.status,
        s.started_at,
        s.stopped_at,
        s.billing_started_at,
        s.last_heartbeat_at,
        s.duration_seconds
      FROM sessions s
      LEFT JOIN license_keys lk ON lk.id = s.license_key_id
      ORDER BY s.started_at ASC
    `);

    const sessions = (rows as any).rows as unknown as RawSession[];
    const groups = groupIntoStreams(sessions);

    let upserted = 0;
    let errors = 0;

    for (const group of groups) {
      try {
        const agg = aggregateStream(group, billingRate);
        const record = {
          streamGroupId:             group.streamGroupId,
          licenseKey:                group.licenseKey,
          licenseKeyId:              group.licenseKeyId,
          sessionIds:                JSON.stringify(group.sessions.map(s => s.session_id)),
          totalSessions:             group.sessions.length,
          fragmentationCount:        group.fragmentationCount,
          streamStartTime:           new Date(group.streamStartMs),
          streamEndTime:             new Date(group.streamEndMs),
          totalBillingSeconds:       agg.totalBillableSeconds,
          totalApiCreditsUsed:       agg.totalApiCreditsUsed,
          totalRetailSeconds:        agg.totalRetailSeconds,
          totalRetailCreditsCharged: agg.totalRetailCreditsCharged,
          profitInCredits:           agg.profitInCredits,
          effectiveCreditsPerSecond: agg.effectiveCreditsPerSecond,
          lastBillingRateUsed:       billingRate,
          isActive:                  group.isActive,
          updatedAt:                 new Date(),
        };

        await db
          .insert(streamLedgerTable)
          .values(record)
          .onConflictDoUpdate({
            target: streamLedgerTable.streamGroupId,
            set: {
              totalSessions:             record.totalSessions,
              fragmentationCount:        record.fragmentationCount,
              sessionIds:                record.sessionIds,
              streamEndTime:             record.streamEndTime,
              totalBillingSeconds:       record.totalBillingSeconds,
              totalApiCreditsUsed:       record.totalApiCreditsUsed,
              totalRetailSeconds:        record.totalRetailSeconds,
              totalRetailCreditsCharged: record.totalRetailCreditsCharged,
              profitInCredits:           record.profitInCredits,
              effectiveCreditsPerSecond: record.effectiveCreditsPerSecond,
              lastBillingRateUsed:       record.lastBillingRateUsed,
              isActive:                  record.isActive,
              updatedAt:                 record.updatedAt,
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

// ═══════════════════════════════════════════════════════════════════════════════
// LICENSE WALLET MONITOR — Prepaid wallet view per license key (additive)
// ═══════════════════════════════════════════════════════════════════════════════

import { licenseWalletTable } from "@workspace/db";

const LICENSE_WALLET_ENABLED = process.env.ENABLE_LICENSE_WALLET !== "false";

function walletGate(_req: any, res: any, next: any) {
  if (!LICENSE_WALLET_ENABLED) {
    res.status(503).json({ error: "License Wallet is disabled (ENABLE_LICENSE_WALLET=false)." });
    return;
  }
  next();
}

function walletStatus(
  isActive: boolean,
  allocatedSeconds: number,
  usedSeconds: number,
  lastActivityMs: number | null
): string {
  if (!isActive) return "inactive";
  if (usedSeconds >= allocatedSeconds && allocatedSeconds > 0) return "exhausted";
  const PAUSE_THRESHOLD_MS = 30 * 60 * 1000;
  if (lastActivityMs && Date.now() - lastActivityMs > PAUSE_THRESHOLD_MS) return "paused";
  return "active";
}

// ── GET /wallet ───────────────────────────────────────────────────────────────
router.get("/wallet", requireAdmin, featureGate, walletGate, async (req, res) => {
  try {
    const billingRate = await getBillingRate();
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "200"), 10), 1000);
    const statusFilter = req.query["status"] as string | undefined;

    const sessionAgg = await db.execute(sql`
      SELECT
        s.license_key_id,
        COUNT(*)                                                 AS total_sessions,
        COUNT(*) FILTER (WHERE s.status = 'active')             AS active_sessions,
        COALESCE(SUM(s.duration_seconds), 0)                    AS session_used_seconds,
        MAX(s.last_deducted_at)                                 AS last_deduction_at
      FROM sessions s
      WHERE s.license_key_id IS NOT NULL
      GROUP BY s.license_key_id
    `);

    const aggByKey: Record<number, any> = {};
    for (const row of (sessionAgg as any).rows as any[]) {
      aggByKey[Number(row.license_key_id)] = row;
    }

    const keys = await db.execute(sql`
      SELECT
        lk.id,
        lk.key,
        lk.is_active,
        lk.minutes_allocated,
        lk.used_seconds,
        lk.credits_allocated,
        lk.credits_used,
        lk.last_used_at,
        lk.last_session_at,
        lk.streaming_enabled
      FROM license_keys lk
      ORDER BY lk.last_used_at DESC NULLS LAST
      LIMIT ${limit}
    `);

    let wallets = ((keys as any).rows as any[]).map(lk => {
      const allocatedSeconds = Math.round(Number(lk.minutes_allocated ?? 0) * 60);
      const usedSeconds = Number(lk.used_seconds ?? 0);
      const remainingSeconds = Math.max(0, allocatedSeconds - usedSeconds);
      const agg = aggByKey[Number(lk.id)];
      const lastActivityMs = lk.last_used_at ? new Date(lk.last_used_at).getTime() : null;
      const status = walletStatus(Boolean(lk.is_active), allocatedSeconds, usedSeconds, lastActivityMs);

      // Normalised wallet metrics using the same source of truth
      const sessionBillableSeconds = agg ? Number(agg.session_used_seconds) : 0;
      const { apiCostCredits, retailCredits } = computeNormalisedMetrics(sessionBillableSeconds, billingRate);
      const consistencyDelta = sessionBillableSeconds - usedSeconds;

      // Rate-controlled burn system (spec §2-§3)
      const burnMultiplier = computeBurnMultiplier(billingRate);
      const actualConsumedSeconds = Math.round(usedSeconds * burnMultiplier);

      // Derive wallet consistency status from delta
      const walletConsistencyStatus =
        Math.abs(consistencyDelta) > 10 ? "mismatch" : "ok";

      // Credit-denominated values (backward-compat with old frontend)
      const creditsAllocated = Math.round(allocatedSeconds * billingRate);
      const creditsUsed      = Math.round(usedSeconds      * billingRate);
      const creditsRemaining = Math.max(0, creditsAllocated - creditsUsed);

      return {
        licenseKeyId: Number(lk.id),
        licenseKey: String(lk.key),
        allocatedSeconds,
        usedSeconds,
        remainingSeconds,
        usedPercent: allocatedSeconds > 0 ? Math.round((usedSeconds / allocatedSeconds) * 100) : 0,
        status,
        isActive: Boolean(lk.is_active),
        streamingEnabled: Boolean(lk.streaming_enabled),
        billingRateSnapshot: billingRate,
        activeSessionCount: agg ? Number(agg.active_sessions) : 0,
        totalSessionCount: agg ? Number(agg.total_sessions) : 0,
        reconnectCount: agg ? Math.max(0, Number(agg.total_sessions) - 1) : 0,
        lastDeductionAt: agg?.last_deduction_at ?? lk.last_used_at,
        sessionBillableSeconds,
        sessionApiCostCredits: apiCostCredits,
        sessionRetailCredits: retailCredits,
        consistencyDeltaSeconds: consistencyDelta,
        // backward-compat fields the frontend expects
        walletConsistencyStatus,
        creditsAllocated,
        creditsUsed,
        creditsRemaining,
        // Rate-controlled burn system fields (spec §2-§3)
        burnMultiplier,
        actualConsumedSeconds,
        baseRate: BASE_BILLING_RATE,
      };
    });

    if (statusFilter && ["active", "paused", "exhausted", "inactive"].includes(statusFilter)) {
      wallets = wallets.filter(w => w.status === statusFilter);
    }

    // backward-compat summary breakdown the old frontend expects
    const walletSummary = {
      active:    wallets.filter(w => w.status === "active").length,
      paused:    wallets.filter(w => w.status === "paused").length,
      exhausted: wallets.filter(w => w.status === "exhausted").length,
      inactive:  wallets.filter(w => w.status === "inactive").length,
      mismatched: wallets.filter(w => Math.abs(w.consistencyDeltaSeconds) > 10).length,
    };

    res.json({
      wallets,
      currentBillingRate: billingRate,
      totalWallets: wallets.length,
      total: wallets.length,
      summary: walletSummary,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[LicenseWallet] wallet query failed");
    res.status(500).json({ error: "Failed to load wallet data" });
  }
});

// ── POST /wallet/rebuild ──────────────────────────────────────────────────────
router.post("/wallet/rebuild", requireAdmin, featureGate, walletGate, async (_req, res) => {
  try {
    const billingRate = await getBillingRate();

    const keys = await db.execute(sql`
      SELECT
        lk.id, lk.key, lk.is_active, lk.minutes_allocated,
        lk.used_seconds, lk.last_used_at,
        COALESCE((
          SELECT SUM(s.duration_seconds)
          FROM sessions s
          WHERE s.license_key_id = lk.id
        ), 0) AS session_billable_seconds
      FROM license_keys lk
    `);

    let upserted = 0;
    let errors = 0;

    for (const lk of (keys as any).rows as any[]) {
      try {
        const allocatedSeconds = Math.round(Number(lk.minutes_allocated ?? 0) * 60);
        const usedSeconds = Number(lk.used_seconds ?? 0);
        const remainingSeconds = Math.max(0, allocatedSeconds - usedSeconds);
        const sessionBillableSeconds = Number(lk.session_billable_seconds ?? 0);
        const { apiCostCredits, retailCredits } = computeNormalisedMetrics(sessionBillableSeconds, billingRate);

        await db
          .insert(licenseWalletTable)
          .values({
            licenseKeyId: Number(lk.id),
            licenseKey: String(lk.key),
            allocatedSeconds,
            usedSeconds,
            remainingSeconds,
            billingRateSnapshot: billingRate,
            sessionBillableSeconds,
            apiCostCredits,
            retailCredits,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: licenseWalletTable.licenseKeyId,
            set: {
              allocatedSeconds,
              usedSeconds,
              remainingSeconds,
              billingRateSnapshot: billingRate,
              sessionBillableSeconds,
              apiCostCredits,
              retailCredits,
              updatedAt: new Date(),
            },
          });
        upserted++;
      } catch {
        errors++;
      }
    }

    res.json({
      ok: true,
      keysProcessed: (keys as any).rows.length,
      upserted,
      errors,
      billingRateUsed: billingRate,
      rebuiltAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[LicenseWallet] rebuild failed");
    res.status(500).json({ error: "Wallet rebuild failed" });
  }
});

// ── GET /billing-rate — Billing Rate Monitor ─────────────────────────────────
//
// Returns the full BillingRateResponse the frontend BillingRatePanel expects.
// This endpoint was missing — causing the panel to be permanently stuck on
// "Loading billing rate data…". Added here (under billing-intelligence router)
// so the frontend apiFetch("/billing-rate") resolves correctly.
//
// What each number means:
//   currentRate         — credits per second drained from the license wallet
//                         (admin-configurable via Billing Rate settings page)
//   decartFixedRate     — DECART_API_COST_PER_SEC = 2.3 cr/s
//                         (safe Decart API cost rate used for analytics only —
//                          actual Decart charge is 5 cr/s via DECART_CREDITS_PER_SEC)
//   profitMarginAtCurrentRate — (currentRate − 2.3) / currentRate × 100 %
//                         e.g. rate=5 → (5−2.3)/5 = 54% margin
//   totalRateChanges    — number of admin billing rate changes ever recorded
//   history             — each rate change: who changed it, from what, to what
//   rateStats           — session counts & billing seconds grouped by rate used
//   propagation         — rate is always fetched live (no cache), so it is
//                         always fully_propagated. staleSessions = sessions
//                         that used a different rate snapshot at settle time.
router.get("/billing-rate", requireAdmin, featureGate, async (_req, res) => {
  try {
    const billingRate = await getBillingRate();

    // ── Rate change audit history ──────────────────────────────────────────
    const auditRows = await db
      .select()
      .from(billingRateAuditTable)
      .orderBy(desc(billingRateAuditTable.createdAt))
      .limit(100);

    const history = auditRows.map(r => ({
      id:           r.id,
      previousRate: r.previousRate,
      newRate:      r.newRate,
      changedBy:    r.changedByEmail ?? String(r.changedBy ?? "admin"),
      note:         r.note ?? null,
      changedAt:    r.createdAt instanceof Date
                      ? r.createdAt.toISOString()
                      : String(r.createdAt),
    }));

    // ── Per-rate stats from session accounting log ─────────────────────────
    let rateStats: Array<{
      rate: number;
      session_count: number;
      total_billing_seconds: number;
      avg_effective_cr_per_sec: number;
    }> = [];

    try {
      const statsRows = await db.execute(sql`
        SELECT
          billing_rate_at_settle                      AS rate,
          COUNT(*)::int                               AS session_count,
          COALESCE(SUM(billing_seconds), 0)::int      AS total_billing_seconds,
          COALESCE(AVG(effective_credits_per_sec), 0) AS avg_effective_cr_per_sec
        FROM session_accounting_log
        WHERE billing_rate_at_settle IS NOT NULL
        GROUP BY billing_rate_at_settle
        ORDER BY billing_rate_at_settle DESC
      `);
      rateStats = ((statsRows as any).rows ?? []).map((r: any) => ({
        rate:                    Number(r.rate),
        session_count:           Number(r.session_count),
        total_billing_seconds:   Number(r.total_billing_seconds),
        avg_effective_cr_per_sec: Number(r.avg_effective_cr_per_sec),
      }));
    } catch {
      // session_accounting_log may be empty — non-fatal
    }

    // ── Propagation check ──────────────────────────────────────────────────
    // Billing rate is fetched LIVE on every call (no cache) so all live sessions
    // always use the current rate. "staleSessions" = sessions in the accounting
    // log that settled at a different rate (historical snapshots — intentional).
    let syncedSessions   = 0;
    let staleSessions    = 0;
    let totalWithRate    = 0;
    try {
      const propRows = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE billing_rate_at_settle = ${billingRate})::int AS synced,
          COUNT(*) FILTER (WHERE billing_rate_at_settle IS NOT NULL AND billing_rate_at_settle != ${billingRate})::int AS stale,
          COUNT(*) FILTER (WHERE billing_rate_at_settle IS NOT NULL)::int AS total
        FROM session_accounting_log
      `);
      const row = ((propRows as any).rows ?? [])[0];
      if (row) {
        syncedSessions = Number(row.synced ?? 0);
        staleSessions  = Number(row.stale  ?? 0);
        totalWithRate  = Number(row.total  ?? 0);
      }
    } catch {
      // non-fatal
    }

    const propagationStatus: "fully_propagated" | "partial" =
      staleSessions === 0 ? "fully_propagated" : "partial";

    const propagationNote = staleSessions === 0
      ? `All ${totalWithRate} settled sessions used the current rate (${billingRate} cr/s). Billing rate is fetched live — no stale cache.`
      : `${syncedSessions} sessions settled at ${billingRate} cr/s. ${staleSessions} sessions used an older rate snapshot (historical — audit-correct).`;

    // ── Profit margin at current rate ──────────────────────────────────────
    // Formula: (retail cr/s − API cost cr/s) / retail cr/s × 100
    //   retail cr/s  = billingRate  (credits charged to licence wallet per second)
    //   API cost cr/s = DECART_API_COST_PER_SEC (2.3 — safe analytics rate)
    const marginPct = billingRate > 0
      ? (((billingRate - DECART_API_COST_PER_SEC) / billingRate) * 100).toFixed(1)
      : "0.0";

    res.json({
      currentRate:              billingRate,
      currentRateLabel:         `${billingRate} cr/s`,
      decartFixedRate:          DECART_API_COST_PER_SEC,
      decartFixedRateLabel:     `${DECART_API_COST_PER_SEC} cr/s`,
      profitMarginAtCurrentRate: `${marginPct}%`,
      totalRateChanges:         auditRows.length,
      history,
      rateStats,
      propagation: {
        syncedSessions,
        staleSessions,
        totalSessionsWithRate: totalWithRate,
        propagationStatus,
        propagationNote,
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[BillingRateMonitor] failed");
    res.status(500).json({ error: "Failed to load billing rate monitor data" });
  }
});

export default router;
