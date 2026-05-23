/**
 * billing-ws.ts — Read-only WebSocket observability push for admin billing tabs.
 *
 * SAFETY CONTRACT:
 *  - Purely observational — sends analytics data to connected admin clients.
 *  - MUST NOT control billing logic, wallet deductions, heartbeat, or settlement.
 *  - MUST NOT trigger settlement calculations or modify any session/wallet state.
 *  - If WebSocket fails, streaming and billing continue completely unaffected.
 *  - Clients receive a "ping" event for keepalive; all other events are data pushes.
 *
 * Events emitted:
 *   billing_rate_changed   — admin changed the billing rate
 *   session_started        — a new session was created
 *   session_paused         — session heartbeat stopped (orphan candidate)
 *   session_reconnected    — session reconnected after gap
 *   session_settled        — session stopped/expired
 *   wallet_updated         — license wallet balance changed
 *   dashboard_refresh      — generic full-refresh trigger
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { logger } from "./logger";

export type BillingEventType =
  | "billing_rate_changed"
  | "session_started"
  | "session_paused"
  | "session_reconnected"
  | "session_settled"
  | "wallet_updated"
  | "dashboard_refresh";

export interface BillingEvent {
  type: BillingEventType;
  ts: string;
  payload?: Record<string, unknown>;
}

let wss: WebSocketServer | null = null;

const PING_INTERVAL_MS = 25_000;

/**
 * Attach a WebSocket server for billing observability to an existing HTTP server.
 * Call once from index.ts after app.listen().
 * Path: /api/admin/billing-intelligence/ws
 */
export function attachBillingWebSocket(httpServer: Server): void {
  if (wss) return; // already attached

  wss = new WebSocketServer({ server: httpServer, path: "/api/admin/billing-intelligence/ws" });

  wss.on("connection", (ws) => {
    logger.info("[BillingWS] admin client connected");

    // Send initial ping so client knows it's live
    safeSend(ws, { type: "dashboard_refresh", ts: new Date().toISOString() });

    ws.on("close", () => {
      logger.info("[BillingWS] admin client disconnected");
    });
    ws.on("error", (err) => {
      logger.warn({ err }, "[BillingWS] client error");
    });
  });

  wss.on("error", (err) => {
    logger.error({ err }, "[BillingWS] server error");
  });

  // Keepalive: send a protocol-level WebSocket ping frame so the connection
  // is not dropped by proxies or load-balancers. This generates no application
  // traffic and does not trigger any dashboard refresh logic on the client.
  setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.ping();
    });
  }, PING_INTERVAL_MS).unref?.();

  logger.info("[BillingWS] WebSocket observability server attached at /api/admin/billing-intelligence/ws");
}

function safeSend(ws: WebSocket, event: BillingEvent): void {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  } catch {
    // non-fatal — client may have disconnected
  }
}

/**
 * Broadcast a billing observability event to all connected admin clients.
 * Safe to call from any route handler. Never throws.
 */
export function broadcastEvent(event: BillingEvent): void {
  if (!wss) return;
  try {
    const payload = JSON.stringify(event);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch { /* client disconnected mid-send */ }
      }
    });
  } catch (err) {
    logger.warn({ err }, "[BillingWS] broadcastEvent error (non-fatal)");
  }
}

/** Convenience helpers for common event types */

export function emitBillingRateChanged(previousRate: number, newRate: number, changedByEmail?: string | null): void {
  broadcastEvent({
    type: "billing_rate_changed",
    ts: new Date().toISOString(),
    payload: { previousRate, newRate, changedByEmail: changedByEmail ?? null },
  });
}

export function emitSessionStarted(sessionId: string, licenseKeyId: number | null): void {
  broadcastEvent({
    type: "session_started",
    ts: new Date().toISOString(),
    payload: { sessionId, licenseKeyId },
  });
}

export function emitSessionSettled(sessionId: string, licenseKeyId: number | null, durationSeconds: number, reason: string): void {
  broadcastEvent({
    type: "session_settled",
    ts: new Date().toISOString(),
    payload: { sessionId, licenseKeyId, durationSeconds, reason },
  });
}

export function emitWalletUpdated(licenseKeyId: number, usedSeconds: number, remainingSeconds: number): void {
  broadcastEvent({
    type: "wallet_updated",
    ts: new Date().toISOString(),
    payload: { licenseKeyId, usedSeconds, remainingSeconds },
  });
}
