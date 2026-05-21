import { pgTable, serial, text, integer, timestamp, pgEnum, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { decartApiKeysTable } from "./decart-keys";

export const membershipEnum = pgEnum("membership", ["active", "suspended", "free_trial"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  membership: membershipEnum("membership").notNull().default("free_trial"),
  freeSecondsRemaining: integer("free_seconds_remaining").notNull().default(0),
  totalMinutesPurchased: integer("total_minutes_purchased").notNull().default(0),
  totalSecondsUsed: integer("total_seconds_used").notNull().default(0),
  isAdmin: integer("is_admin").notNull().default(0),
  isSubAdmin: integer("is_sub_admin").notNull().default(0),
  subAdminMinutesBalance: integer("sub_admin_minutes_balance").notNull().default(0),
  createdBySubAdmin: integer("created_by_sub_admin").notNull().default(0),
  createdBySubAdminId: integer("created_by_sub_admin_id"),
  decartKeyId: integer("decart_key_id").references(() => decartApiKeysTable.id),
  avatarUrl: text("avatar_url"),
  emailVerified: boolean("email_verified").notNull().default(false),
  verificationPin: text("verification_pin"),
  verificationPinExpiresAt: timestamp("verification_pin_expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Sub-admin billing rate override
  subAdminBillingRate: real("sub_admin_billing_rate"),
  // Sub-admin default token window — applied to all keys created by this sub-admin
  // that do not have their own token_window_minutes set.
  // Priority: key.tokenWindowMinutes > subAdmin.defaultTokenWindowMinutes > global (settings table)
  defaultTokenWindowMinutes: real("default_token_window_minutes"),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
