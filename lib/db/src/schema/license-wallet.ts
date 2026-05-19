/**
 * license-wallet.ts — Additive license-key-level wallet accounting view.
 *
 * SAFETY: New table only. Never read by existing billing, heartbeat, or session code.
 * Represents the prepaid wallet state per license key — aggregating across all
 * sessions that belong to that key.
 *
 * The live heartbeat deduction engine continues to write to license_keys.used_seconds
 * and sessions.duration_seconds as before. This table is a SNAPSHOT store for
 * admin observability, populated by the /wallet/refresh endpoint.
 *
 * Feature-flagged via ENABLE_LICENSE_WALLET env var (default: true).
 */

import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
} from "drizzle-orm/pg-core";

export const licenseWalletTable = pgTable("license_wallet", {
  id: serial("id").primaryKey(),

  // ── Identity ────────────────────────────────────────────────────────────────
  licenseKey: text("license_key").notNull(),
  licenseKeyId: integer("license_key_id").notNull().unique(),

  // ── Allocation (from license_keys.minutes_allocated × 60) ──────────────────
  allocatedSeconds: integer("allocated_seconds").default(0),

  // ── Usage (from license_keys.used_seconds — written by heartbeat engine) ────
  usedSeconds: integer("used_seconds").default(0),

  // ── Derived balance ──────────────────────────────────────────────────────────
  remainingSeconds: integer("remaining_seconds").default(0),

  // ── Status ───────────────────────────────────────────────────────────────────
  /**
   * 'active'    — key is active and has remaining balance
   * 'exhausted' — used_seconds >= allocated_seconds
   * 'inactive'  — key is disabled in license_keys.is_active
   * 'paused'    — key is active but no recent session activity
   */
  status: text("status").default("active"),

  // ── Billing rate snapshot (fetched live — never hardcoded) ───────────────────
  billingRateSnapshot: real("billing_rate_snapshot"),

  // ── Session metadata ─────────────────────────────────────────────────────────
  activeSessionCount: integer("active_session_count").default(0),
  totalSessionCount: integer("total_session_count").default(0),
  reconnectCount: integer("reconnect_count").default(0),
  lastDeductionAt: timestamp("last_deduction_at"),

  // ── Consistency check ────────────────────────────────────────────────────────
  /**
   * 'ok'       — used_seconds matches sum of session duration_seconds
   * 'mismatch' — discrepancy detected (ghost sessions, missed settlements)
   * 'unknown'  — no sessions found for this key
   */
  walletConsistencyStatus: text("wallet_consistency_status").default("unknown"),
  /** Difference between sum(session.duration_seconds) and license_keys.used_seconds */
  consistencyDeltaSeconds: integer("consistency_delta_seconds").default(0),

  snapshotAt: timestamp("snapshot_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type LicenseWallet = typeof licenseWalletTable.$inferSelect;
export type InsertLicenseWallet = typeof licenseWalletTable.$inferInsert;
