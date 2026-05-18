import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const billingRateAuditTable = pgTable("billing_rate_audit", {
  id: serial("id").primaryKey(),
  previousRate: integer("previous_rate").notNull(),
  newRate: integer("new_rate").notNull(),
  changedBy: integer("changed_by"),
  changedByEmail: text("changed_by_email"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type BillingRateAudit = typeof billingRateAuditTable.$inferSelect;
