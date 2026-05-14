import { pgTable, serial, text, integer, timestamp, boolean, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const decartApiKeysTable = pgTable("decart_api_keys", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  apiKey: text("api_key").notNull(),
  apiSecret: text("api_secret").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  maxUsers: integer("max_users"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
  assignedLicenseKey: varchar("assigned_license_key", { length: 64 }),
  assignmentStatus: text("assignment_status").default("available"),
  usageLoad: integer("usage_load").default(0),
  healthStatus: text("health_status").default("healthy"),
  totalCreditsLoaded: integer("total_credits_loaded").notNull().default(0),
  creditsBaseline: integer("credits_baseline").notNull().default(0),
  thresholdPct: integer("threshold_pct").notNull().default(15),
  lastTopupAt: timestamp("last_topup_at"),
});

export const insertDecartApiKeySchema = createInsertSchema(decartApiKeysTable).omit({ id: true, createdAt: true });
export type InsertDecartApiKey = z.infer<typeof insertDecartApiKeySchema>;
export type DecartApiKey = typeof decartApiKeysTable.$inferSelect;

export const decartCreditSettingsTable = pgTable("decart_credit_settings", {
  id: integer("id").primaryKey(),
  globalThresholdPct: integer("global_threshold_pct").notNull().default(15),
  useGlobalThreshold: boolean("use_global_threshold").notNull().default(false),
  updatedAt: timestamp("updated_at"),
});

export type DecartCreditSettings = typeof decartCreditSettingsTable.$inferSelect;
