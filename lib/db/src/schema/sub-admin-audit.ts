import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const subAdminAuditTable = pgTable("sub_admin_audit", {
  id: serial("id").primaryKey(),
  subAdminId: integer("sub_admin_id").notNull(),
  action: text("action").notNull(), // "login" | "credit_user" | "created" | "suspended" | "deleted" | "minutes_allocated"
  targetUserId: integer("target_user_id"),
  minutesAmount: integer("minutes_amount"),
  note: text("note"),
  performedBy: integer("performed_by"), // main admin ID for admin actions on sub admins
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SubAdminAudit = typeof subAdminAuditTable.$inferSelect;
