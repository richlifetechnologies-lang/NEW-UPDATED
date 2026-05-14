import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";

export const deviceFingerprintsTable = pgTable("device_fingerprints", {
  id: serial("id").primaryKey(),
  fingerprintHash: text("fingerprint_hash").notNull().unique(),
  ipHash: text("ip_hash").notNull().default(""),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("device_fp_ip_hash_idx").on(t.ipHash),
]);

export type DeviceFingerprint = typeof deviceFingerprintsTable.$inferSelect;
