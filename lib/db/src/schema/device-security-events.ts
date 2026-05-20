import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Device security event log.
 *
 * Captures every device validation attempt against a license key:
 *   "bound"   — first-time device binding on this key
 *   "blocked" — a different device attempted to use a locked key (SECURITY FLAG)
 *
 * This table is DISPLAY ONLY for admin decision-making.
 * It has NO effect on billing, wallet, TCE, or Decart cost.
 */
export const deviceSecurityEventsTable = pgTable("device_security_events", {
  id:                serial("id").primaryKey(),
  licenseKey:        text("license_key").notNull(),
  eventType:         text("event_type").notNull(),     // "bound" | "blocked"
  attemptedDeviceId: text("attempted_device_id").notNull(),
  boundDeviceId:     text("bound_device_id"),          // null when event_type = "bound"
  ipAddress:         text("ip_address"),
  userAgent:         text("user_agent"),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("dse_license_key_idx").on(t.licenseKey),
  index("dse_event_type_idx").on(t.eventType),
  index("dse_created_at_idx").on(t.createdAt),
]);

export type DeviceSecurityEvent = typeof deviceSecurityEventsTable.$inferSelect;
