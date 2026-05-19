/**
 * session-accounting.ts — Additive observability schema for billing intelligence.
 *
 * This table is WRITE-ONLY by the new billing intelligence overlay.
 * It does NOT replace or modify any existing sessions/license/billing tables.
 * All existing billing flows remain unchanged.
 *
 * Populated by: POST /api/admin/billing-intelligence/record (called after settle)
 * Queried by:   GET  /api/admin/billing-intelligence/*
 *
 * Migration: additive ALTER TABLE only — safe to deploy with zero downtime.
 * If this table is missing, all existing functionality continues normally.
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

export const sessionAccountingLogTable = pgTable("session_accounting_log", {
  id: serial("id").primaryKey(),

  // ── Identity ────────────────────────────────────────────────────────────────
  sessionId: text("session_id").notNull(),
  licenseKey: text("license_key"),
  licenseKeyId: integer("license_key_id"),
  decartKeyId: integer("decart_key_id"),

  // ── Timestamps (mirrored from sessions row at settle time) ──────────────────
  startedAt: timestamp("started_at"),
  stoppedAt: timestamp("stopped_at"),
  billingStartedAt: timestamp("billing_started_at"),

  // ── Compute metrics ─────────────────────────────────────────────────────────
  /** Wall-clock seconds from started_at to stopped_at (full Decart connection time) */
  computeSeconds: integer("compute_seconds"),
  /** Billing-window seconds: billing_started_at → stopped_at (active stream time) */
  billingSeconds: integer("billing_seconds"),
  /** Decart's actual charge: computeSeconds × 5 credits/sec */
  actualApiCredits: integer("actual_api_credits"),

  // ── Retail metrics ──────────────────────────────────────────────────────────
  /** Licence seconds debited: billingSeconds × billingRate ÷ 2 */
  retailSeconds: integer("retail_seconds"),
  /** Credits equivalent of licence drain: retailSeconds × 2 (baseline) */
  retailCreditsCharged: integer("retail_credits_charged"),
  /** billingRate value active at settle time */
  billingRateAtSettle: real("billing_rate_at_settle"),
  /** Retail revenue per second at settle time */
  effectiveCreditsPerSec: real("effective_credits_per_sec"),

  // ── Profit ──────────────────────────────────────────────────────────────────
  /** retailCreditsCharged - actualApiCredits (positive = profitable) */
  profitMarginCredits: integer("profit_margin_credits"),

  // ── Settlement metadata ─────────────────────────────────────────────────────
  /** 'credit_based' | 'wall_clock' */
  settlementSource: text("settlement_source"),
  /**
   * 'client_stop' | 'orphan' | 'freeze' | 'out_of_time' |
   * 'admin_terminate' | 'heartbeat_exhausted' | 'unknown'
   */
  sessionCloseReason: text("session_close_reason"),
  /** Total seconds deducted from licence across all heartbeats */
  heartbeatDeductionsTotal: integer("heartbeat_deductions_total"),
  /** Final settlement deduction at session stop */
  finalSettlementTotal: integer("final_settlement_total"),

  // ── Anomaly flags ────────────────────────────────────────────────────────────
  /** True when billing_started_at is null but deductions occurred */
  isGhostSession: boolean("is_ghost_session").default(false),
  /** Free-text anomaly description, null when clean */
  anomalyFlag: text("anomaly_flag"),

  // ── Stream grouping (additive — not used by existing billing logic) ──────────
  /**
   * Derived stream group this session belongs to.
   * Format: sg_{licenseKeyId}_{firstSessionStartMs}
   * NEVER used by heartbeat, settlement, or Decart integration.
   * Populated only by the stream ledger rebuild endpoint.
   */
  streamGroupId: text("stream_group_id"),

  createdAt: timestamp("created_at").defaultNow(),
});

export type SessionAccountingLog = typeof sessionAccountingLogTable.$inferSelect;
export type InsertSessionAccountingLog = typeof sessionAccountingLogTable.$inferInsert;
