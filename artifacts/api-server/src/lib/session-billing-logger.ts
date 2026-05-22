/**
 * session-billing-logger.ts — Non-blocking fire-and-forget billing event logger.
 *
 * SAFETY CONTRACT:
 *   ✔ async fire-and-forget — NEVER awaited by callers
 *   ✔ NEVER throws — errors are silently swallowed
 *   ✔ NEVER blocks request pipeline
 *   ✔ NEVER affects streaming latency
 *   ✔ uses pooled DB access safely
 *   ✔ additive only — does NOT modify any existing billing table
 */

import { db, sessionBillingEventsTable } from "@workspace/db";
import { logger } from "./logger";

export type BillingEventType =
  | "token_issued"
  | "token_cache_hit"
  | "token_cache_miss"
  | "connect"
  | "stream_start"
  | "heartbeat_ok"
  | "heartbeat_exhausted"
  | "disconnect"
  | "stop"
  | "orphan_kill"
  | "freeze_kill"
  | "ai_explanation_generated";

export interface LogSessionBillingEventParams {
  sessionId: string;
  decartSessionId?: string | null;
  eventType: BillingEventType;
  walletRemainingSeconds?: number | null;
  tokenWindowSeconds?: number | null;
  costSnapshot?: number | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Log a session billing event asynchronously.
 *
 * Call this function without await — it is fire-and-forget.
 * It will NEVER throw, block, or affect the response pipeline.
 *
 * Example:
 *   logSessionBillingEvent({ sessionId, eventType: "heartbeat_ok", walletRemainingSeconds: 300 });
 *   // do NOT await
 */
export function logSessionBillingEvent(params: LogSessionBillingEventParams): void {
  setImmediate(() => {
    _doInsert(params).catch(() => {
      // Intentionally swallowed — observability must never crash billing
    });
  });
}

async function _doInsert(params: LogSessionBillingEventParams): Promise<void> {
  try {
    await db.insert(sessionBillingEventsTable).values({
      sessionId: params.sessionId,
      decartSessionId: params.decartSessionId ?? null,
      eventType: params.eventType,
      walletRemainingSeconds: params.walletRemainingSeconds ?? null,
      tokenWindowSeconds: params.tokenWindowSeconds ?? null,
      costSnapshot: params.costSnapshot ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    // Non-fatal — log at debug level only so noise is suppressed in prod
    logger.debug({ err, sessionId: params.sessionId, eventType: params.eventType }, "[BillingLogger] insert failed (non-fatal)");
  }
}
