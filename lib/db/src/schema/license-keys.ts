import {
  pgTable, serial, text, timestamp, boolean, varchar, integer, real,
} from "drizzle-orm/pg-core";

/**
 * Desktop/web application license keys.
 * License key is the SOLE identity and access mechanism.
 *
 * Per-license billing rate columns (additive — nullable, backward compatible):
 *   custom_billing_rate         — admin-assigned custom credits/sec for this key
 *   use_custom_billing_rate     — when true, IGNORE global billing rate for this key
 *   billing_rate_last_updated_at — timestamp of last custom rate change
 */
export const licenseKeysTable = pgTable("license_keys", {
  id:                   serial("id").primaryKey(),
  key:                  varchar("key", { length: 64 }).notNull().unique(),
  deviceId:            varchar("device_id", { length: 128 }),
  isActive:            boolean("is_active").default(true).notNull(),
  activatedAt:         timestamp("activated_at"),
  expiresAt:           timestamp("expires_at"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  notes:                text("notes"),
  minutesAllocated:    real("minutes_allocated").notNull().default(0),
  usedSeconds:         integer("used_seconds").notNull().default(0),
  creditsAllocated:    integer("credits_allocated").notNull().default(0),
  creditsUsed:         integer("credits_used").notNull().default(0),
  streamingEnabled:    boolean("streaming_enabled").default(true).notNull(),
  lastUsedAt:          timestamp("last_used_at"),
  lastSessionAt:       timestamp("last_session_at"),
  // Fix #6/#9: auto-assigned API key
  assignedDecartKeyId: integer("assigned_decart_key_id"),
  createdBySubAdminId: integer("created_by_sub_admin_id"),
  minutesCredited:     boolean("minutes_credited").default(false).notNull(),

  // ── Per-license billing rate system (additive, nullable, backward compatible) ──
  // If use_custom_billing_rate = true, this key IGNORES the global billing rate
  // and uses custom_billing_rate ONLY. Falls back to global rate if null/disabled.
  customBillingRate:          real("custom_billing_rate"),             // nullable — admin-assigned cr/s
  useCustomBillingRate:       boolean("use_custom_billing_rate").default(false), // false = use global
  billingRateLastUpdatedAt:   timestamp("billing_rate_last_updated_at"), // nullable — last change time
});
