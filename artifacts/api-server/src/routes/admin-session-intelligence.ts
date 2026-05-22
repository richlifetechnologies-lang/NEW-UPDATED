/**
 * admin-session-intelligence.ts — Session Intelligence API
 *
 * SAFETY: Read-only. Never modifies any billing, session, or wallet state.
 * Degrades gracefully — returns safe fallbacks on any DB error.
 * Never throws to the client.
 */

import { Router } from "express";
import { db, sessionBillingEventsTable, sessionsTable, licenseKeysTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import { broadcastEvent } from "../lib/billing-ws";
import OpenAI from "openai";

const router = Router();

// ── OpenAI client — lazy singleton so missing key never crashes startup ───────
let _openai: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env["OPENAI_API_KEY"],
      baseURL: process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] ?? undefined,
    });
  }
  return _openai;
}

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

// ── POST /api/admin/session-intelligence/ai-explain ──────────────────────────
// Billing Forensic Intelligence Engine — read-only, deterministic, production-safe.
// Safety: never modifies billing, wallet, session state, or calls Decart.
// All AI responses are logged for audit purposes.
router.post("/ai-explain", requireAdmin, async (req, res) => {
  const { sessionId, question } = (req.body as any) ?? {};

  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  // ── Gather context (all reads non-fatal) ─────────────────────────────────
  let sessionRow: any = null;
  let events: any[] = [];
  let walletInfo: any = null;

  try {
    const [s] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    sessionRow = s ?? null;
  } catch { /* non-fatal */ }

  try {
    const rows = await db
      .select()
      .from(sessionBillingEventsTable)
      .where(eq(sessionBillingEventsTable.sessionId, sessionId))
      .orderBy(desc(sessionBillingEventsTable.createdAt))
      .limit(200);
    events = rows.reverse();
  } catch { /* non-fatal */ }

  if (sessionRow?.licenseKeyId) {
    try {
      const [lic] = await db.select({
        minutesAllocated: licenseKeysTable.minutesAllocated,
        usedSeconds: licenseKeysTable.usedSeconds,
        key: licenseKeysTable.key,
      }).from(licenseKeysTable).where(eq(licenseKeysTable.id, sessionRow.licenseKeyId));
      walletInfo = lic ?? null;
    } catch { /* non-fatal */ }
  }

  // ── Derive termination reason from events + session row ──────────────────
  const eventTypes = new Set(events.map((e: any) => e.eventType as string));
  let inferredTermination = "unknown";
  if (eventTypes.has("orphan_kill"))        inferredTermination = "orphan_kill";
  else if (eventTypes.has("freeze_kill"))   inferredTermination = "freeze_kill";
  else if (eventTypes.has("heartbeat_exhausted")) inferredTermination = "wallet_exhausted";
  else if (eventTypes.has("stop"))          inferredTermination = "normal_stop";
  else if (sessionRow?.status === "stopped") inferredTermination = "normal_stop";

  // ── Build prompts ─────────────────────────────────────────────────────────
  const systemPrompt = `You are a billing forensic intelligence engine. Your job is to analyze realtime streaming session billing data and explain behavior clearly, accurately, and safely.

Rules:
- Read-only analysis ONLY — never suggest modifying billing data, wallet values, or session state.
- Be conservative: if data is missing, say so explicitly. Do NOT hallucinate charges.
- Explain why the session stopped (normal stop, wallet exhaustion, orphan kill, freeze kill).
- Detect anomalies: unexpected token reuse, orphan risk, delayed termination, billing gaps.
- Summarize billing flow step-by-step in human-readable form.
- Assign a risk score: LOW (normal behavior), MEDIUM (minor anomaly), HIGH (billing integrity risk).
- Provide actionable recommendations for admin review.
- Respond ONLY with the exact JSON schema — no markdown, no preamble, no extra text.`;

  const eventSummary = events.length === 0
    ? "No billing events recorded yet for this session."
    : events.map((e: any) => {
        const ts = e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt);
        const wallet = e.walletRemainingSeconds != null ? ` (wallet: ${e.walletRemainingSeconds}s remaining)` : "";
        const meta = e.metadata && Object.keys(e.metadata).length > 0
          ? ` [meta: ${JSON.stringify(e.metadata)}]` : "";
        return `[${ts}] ${e.eventType}${wallet}${meta}`;
      }).join("\n");

  const userPrompt = `Analyze this billing session:

SESSION METADATA:
- Session ID: ${sessionId}
- Status: ${sessionRow?.status ?? "unknown"}
- Started: ${sessionRow?.startedAt ?? "unknown"}
- Billing started: ${sessionRow?.billingStartedAt ?? "not recorded (first heartbeat may have anchored it)"}
- Last heartbeat: ${sessionRow?.lastHeartbeatAt ?? "none recorded"}
- Stopped at: ${sessionRow?.stoppedAt ?? "not yet stopped"}
- Duration billed: ${sessionRow?.durationSeconds ?? "unknown"}s
- Decart session ID: ${sessionRow?.decartSessionId ?? "not linked"}

WALLET:
- Allocated: ${walletInfo ? Math.round((walletInfo.minutesAllocated ?? 0) * 60) + "s" : "unknown"}
- Used: ${walletInfo?.usedSeconds ?? "unknown"}s
- Remaining: ${walletInfo ? Math.max(0, Math.round((walletInfo.minutesAllocated ?? 0) * 60) - (walletInfo.usedSeconds ?? 0)) + "s" : "unknown"}

INFERRED TERMINATION REASON: ${inferredTermination}

${question ? `ADMIN QUESTION: ${question}\n` : ""}
BILLING EVENT TIMELINE (chronological, ${events.length} events):
${eventSummary}

Respond ONLY with this JSON (no markdown, no extra text):
{
  "sessionId": "${sessionId}",
  "summary": "<plain English paragraph: what happened in this session from start to finish>",
  "billingFlow": ["<step 1>", "<step 2>", "<step 3>", "..."],
  "terminationReason": "${inferredTermination === "unknown" ? "normal_stop" : inferredTermination}",
  "anomalies": ["<anomaly description if any, empty array if none>"],
  "riskLevel": "LOW",
  "recommendations": ["<admin action recommendation if any, empty array if none>"]
}

For terminationReason use EXACTLY one of: "normal_stop", "wallet_exhausted", "orphan_kill", "freeze_kill"
For riskLevel use EXACTLY one of: "LOW", "MEDIUM", "HIGH"`;

  // ── Call OpenAI ───────────────────────────────────────────────────────────
  const safeErrorResponse = {
    sessionId,
    summary: "Unable to generate AI explanation at this time. Please verify that OPENAI_API_KEY is configured on the server.",
    billingFlow: ["AI explanation unavailable — check server configuration"],
    terminationReason: inferredTermination === "unknown" ? "normal_stop" : inferredTermination,
    anomalies: [] as string[],
    riskLevel: "LOW" as const,
    recommendations: ["Verify OPENAI_API_KEY environment variable is set on Railway deployment"],
  };

  try {
    const completion = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 1500,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
    });

    const raw = (completion.choices[0]?.message?.content ?? "").trim();

    // Strip markdown code fences if model wraps response despite instructions
    const jsonStr = raw.startsWith("```")
      ? raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()
      : raw;

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Raw text response — wrap it safely
      parsed = { ...safeErrorResponse, summary: raw || "AI returned unparseable response." };
    }

    // Enforce required fields so frontend never breaks
    const normalized = {
      sessionId:         parsed.sessionId         ?? sessionId,
      summary:           parsed.summary           ?? "No summary provided.",
      billingFlow:       Array.isArray(parsed.billingFlow) ? parsed.billingFlow : [],
      terminationReason: (["normal_stop","wallet_exhausted","orphan_kill","freeze_kill"] as const)
                           .includes(parsed.terminationReason)
                           ? parsed.terminationReason
                           : (inferredTermination === "unknown" ? "normal_stop" : inferredTermination),
      anomalies:         Array.isArray(parsed.anomalies) ? parsed.anomalies : [],
      riskLevel:         (["LOW","MEDIUM","HIGH"] as const).includes(parsed.riskLevel)
                           ? parsed.riskLevel
                           : "LOW",
      recommendations:   Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    };

    // ── Audit log: fire-and-forget ─────────────────────────────────────────
    try {
      const { logSessionBillingEvent } = await import("../lib/session-billing-logger.js");
      logSessionBillingEvent({
        sessionId,
        eventType: "ai_explanation_generated",
        metadata: {
          question: question ?? null,
          model: "gpt-4o-mini",
          riskLevel: normalized.riskLevel,
          terminationReason: normalized.terminationReason,
          anomalyCount: normalized.anomalies.length,
        },
      });
    } catch { /* non-fatal */ }

    logger.info({ sessionId, riskLevel: normalized.riskLevel, terminationReason: normalized.terminationReason },
      "[SessionAI] explanation generated");

    res.json(normalized);
  } catch (err: any) {
    logger.warn({ err, sessionId }, "[SessionAI] explain failed (non-fatal)");
    res.json(safeErrorResponse);
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
