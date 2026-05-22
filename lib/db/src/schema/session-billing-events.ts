/**
 * session-billing-events.ts — Additive observability table for billing event tracing.
 *
 * SAFETY: New table only. Does NOT modify any existing table or billing logic.
 * Written to asynchronously (fire-and-forget) so it NEVER affects streaming latency.
 * Migration is idempotent — safe to run multiple times.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  jsonb,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const billingEventTypeEnum = pgEnum("billing_event_type", [
  "token_issued",
  "token_cache_hit",
  "token_cache_miss",
  "connect",
  "stream_start",
  "heartbeat_ok",
  "heartbeat_exhausted",
  // RC fixes — added for billing audit tracking
  "hard_kill",          // backend killed session at safety reserve threshold
  "settle",             // full lifecycle settlement record (debited, duration, rate)
  "startup_orphan_kill", // startup sweep killed a previously-orphaned session
  "disconnect",
  "stop",
  "orphan_kill",
  "freeze_kill",
  "ai_explanation_generated",
]);

export const sessionBillingEventsTable = pgTable(
  "session_billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: text("session_id").notNull(),
    decartSessionId: text("decart_session_id"),
    eventType: billingEventTypeEnum("event_type").notNull(),
    walletRemainingSeconds: integer("wallet_remaining_seconds"),
    tokenWindowSeconds: integer("token_window_seconds"),
    costSnapshot: real("cost_snapshot"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_sbe_session_id").on(t.sessionId),
    index("idx_sbe_decart_session_id").on(t.decartSessionId),
    index("idx_sbe_event_type").on(t.eventType),
  ]
);

export type SessionBillingEvent = typeof sessionBillingEventsTable.$inferSelect;
export type InsertSessionBillingEvent = typeof sessionBillingEventsTable.$inferInsert;
