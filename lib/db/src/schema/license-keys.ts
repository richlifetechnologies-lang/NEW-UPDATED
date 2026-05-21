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
 *
 * Token window system (additive — nullable, backward compatible):
 *   token_window_minutes        — per-key override for Decart token duration
 *                                 NULL = use sub-admin default → global default
 *   is_new_key                  — true = subject to strict validation (all 3 fields required)
 *                                 false/null = legacy key (bypass validation, safe pass-through)
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
  assignedDecartKeyId: integer("assigned_decart_key_id"),
  createdBySubAdminId: integer("created_by_sub_admin_id"),
  minutesCredited:     boolean("minutes_credited").default(false).notNull(),

  // ── Per-license billing rate system (additive, nullable, backward compatible) ──
  customBillingRate:          real("custom_billing_rate"),
  useCustomBillingRate:       boolean("use_custom_billing_rate").default(false),
  billingRateLastUpdatedAt:   timestamp("billing_rate_last_updated_at"),

  // ── Token window system (additive, nullable, backward compatible) ──
  // Priority: licenceKey.tokenWindowMinutes > subAdmin.defaultTokenWindowMinutes > global default
  // NULL = inherit from sub-admin or global default
  tokenWindowMinutes:  real("token_window_minutes"),

  // isNewKey: true = newly generated key (strict 3-field validation applies)
  //           false/null = legacy key (bypass validation — safe pass-through)
  isNewKey:            boolean("is_new_key").default(false),
});
