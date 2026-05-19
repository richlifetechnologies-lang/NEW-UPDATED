/**
 * stream-ledger.ts — Additive stream-level reconciliation table.
 *
 * SAFETY: New table only. Never read by existing billing code.
 * Groups multiple sessions per license key into single "stream" records
 * for credit reconciliation and profit visibility.
 *
 * A "stream" = one continuous user session, potentially split into
 * multiple DB sessions by reconnects/orphan cleanup.
 *
 * stream_group_id is derived from license_key_id + first session timestamp.
 * It is NEVER used by heartbeat, settlement, or Decart integration code.
 *
 * Feature-flagged via ENABLE_STREAM_LEDGER env var (default: true).
 */

import {
  pgTable,
  serial,
  text,
  integer,
  real,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const streamLedgerTable = pgTable("stream_ledger", {
  id: serial("id").primaryKey(),

  // ── Identity ─────────────────────────────────────────────────────────────────
  /** Derived key: sg_{licenseKeyId}_{firstSession_startedAt_unixMs} */
  streamGroupId: text("stream_group_id").notNull().unique(),
  licenseKey: text("license_key"),
  licenseKeyId: integer("license_key_id"),

  // ── Session tracking ──────────────────────────────────────────────────────────
  /** JSON array of session IDs that belong to this stream */
  sessionIds: text("session_ids").notNull().default("[]"),
  totalSessions: integer("total_sessions").default(0),
  /** Number of reconnect gaps detected within the stream */
  fragmentationCount: integer("fragmentation_count").default(0),

  // ── Time aggregation: max(session.end) - min(session.start) ──────────────────
  streamStartTime: timestamp("stream_start_time"),
  streamEndTime: timestamp("stream_end_time"),
  /** Sum of (stoppedAt - startedAt) for all sessions in the group */
  totalComputeSeconds: integer("total_compute_seconds").default(0),
  /** Sum of duration_seconds for all sessions in the group */
  totalBillingSeconds: integer("total_billing_seconds").default(0),

  // ── Decart cost side ──────────────────────────────────────────────────────────
  /** totalComputeSeconds × DECART_CREDITS_PER_SEC (5) */
  totalApiCreditsUsed: integer("total_api_credits_used").default(0),

  // ── Retail side (dynamic billing rate — never hardcoded) ─────────────────────
  /** totalBillingSeconds × billingRate ÷ 2 (accumulated from per-session snapshots) */
  totalRetailSeconds: integer("total_retail_seconds").default(0),
  /** totalRetailSeconds × 2 (credits equivalent) */
  totalRetailCreditsCharged: integer("total_retail_credits_charged").default(0),

  // ── Profit ─────────────────────────────────────────────────────────────────────
  /** totalRetailCreditsCharged - totalApiCreditsUsed */
  profitInCredits: integer("profit_in_credits").default(0),
  effectiveCreditsPerSecond: real("effective_credits_per_second"),

  // ── Billing rate history ──────────────────────────────────────────────────────
  /**
   * JSON: Array<{ sessionId, billingRate, snapshotAt }>
   * One entry per session showing the billing rate active at that session's
   * settlement time. Never hardcoded — each entry is a live snapshot.
   */
  billingRateHistory: text("billing_rate_history").default("[]"),
  lastBillingRateUsed: real("last_billing_rate_used"),

  // ── Status ────────────────────────────────────────────────────────────────────
  /** True when at least one session in the group is currently active */
  isActive: boolean("is_active").default(false),

  computedAt: timestamp("computed_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type StreamLedger = typeof streamLedgerTable.$inferSelect;
export type InsertStreamLedger = typeof streamLedgerTable.$inferInsert;
