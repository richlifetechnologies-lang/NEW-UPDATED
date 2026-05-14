import { pgTable, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { licenseKeysTable } from "./license-keys";
import { decartApiKeysTable } from "./decart-keys";

export const sessionStatusEnum = pgEnum("session_status", ["active", "stopped", "expired"]);

export const sessionsTable = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  licenseKeyId: integer("license_key_id").references(() => licenseKeysTable.id),
  decartKeyId: integer("decart_key_id").references(() => decartApiKeysTable.id),
  status: sessionStatusEnum("status").notNull().default("active"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  stoppedAt: timestamp("stopped_at"),
  durationSeconds: integer("duration_seconds"),
  style: text("style"),
  packageLabel: text("package_label"),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  billingStartedAt: timestamp("billing_started_at"),
  lastDeductedAt: timestamp("last_deducted_at"),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ startedAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
