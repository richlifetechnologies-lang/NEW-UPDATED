import type { Response } from "express";
import { logger } from "./logger";

// ─── In-process client registry ───────────────────────────────────────────
//
// Tracks SSE Response objects connected to this replica. This approach works
// perfectly for single-replica deployments.
//
// NOTE: For multi-replica deployments that require cross-replica SSE fan-out,
// add a Redis pub/sub layer externally (e.g. using ioredis) and publish to a
// shared channel from emitToUser. The other scalability improvements in this
// module (timeouts, connection pooling, rate limiting, query optimisation)
// remain fully effective regardless of replica count.

const clients = new Map<number, Set<Response>>();

// ─── Public API ───────────────────────────────────────────────────────────

export function registerSSEClient(userId: number, res: Response): () => void {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId)!.add(res);

  logger.debug({ userId }, "SSE client registered");

  return () => {
    clients.get(userId)?.delete(res);
    if (clients.get(userId)?.size === 0) {
      clients.delete(userId);
    }
    logger.debug({ userId }, "SSE client unregistered");
  };
}

export function emitToUser(userId: number, event: string, data: unknown) {
  const userClients = clients.get(userId);
  if (!userClients || userClients.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const res of userClients) {
    try {
      res.write(payload);
    } catch {
      // Client disconnected — will be cleaned up on the close/error handler
    }
  }
}
