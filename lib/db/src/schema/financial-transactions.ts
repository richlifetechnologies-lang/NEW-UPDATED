import {
  pgTable, serial, text, timestamp, boolean, varchar, integer, numeric, pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionTypeEnum = pgEnum("transaction_type", [
  "new_license",
  "renewal",
  "upgrade",
  "minutes_added",
]);

/**
 * Financial Analytics Ledger — immutable accounting records for all
 * license key transactions. Records persist even if the license key
 * is later deleted. This is the source of truth for revenue, profit,
 * and API cost tracking.
 *
 * IMPORTANT: licenseKey is stored as a plain varchar snapshot, NOT as
 * a foreign key. This ensures that deleting a license key from the
 * license_keys table does NOT cascade-delete or modify any financial
 * records here.
 */
export const financialTransactionsTable = pgTable("financial_transactions", {
  id:                    serial("id").primaryKey(),

  // Snapshot fields -- NOT foreign keys; deletions never affect financial data
  licenseKey:            varchar("license_key", { length: 64 }).notNull(),
  transactionType:       transactionTypeEnum("transaction_type").notNull().default("new_license"),

  // Package snapshot (captured at transaction time)
  pricingId:             integer("pricing_id"),
  packageLabel:          text("package_label").notNull(),
  minutesAllocated:      integer("minutes_allocated").notNull().default(0),
  durationDays:          integer("duration_days"),

  // Financial data
  revenueUsd:            numeric("revenue_usd", { precision: 10, scale: 2 }).notNull().default("0"),
  revenueGhs:            numeric("revenue_ghs", { precision: 10, scale: 2 }).notNull().default("0"),

  // Decart API cost: $0.02/sec = $1.20/min = $72/hr
  apiCostPerMinuteUsd:   numeric("api_cost_per_minute_usd", { precision: 10, scale: 4 }).notNull().default("1.20"),
  apiCostUsd:            numeric("api_cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
  profitUsd:             numeric("profit_usd", { precision: 10, scale: 4 }).notNull().default("0"),
  isLoss:                boolean("is_loss").notNull().default(false),

  // Exchange rate captured at transaction time
  exchangeRateGhsPerUsd: numeric("exchange_rate_ghs_per_usd", { precision: 10, scale: 4 }).default("1"),

  // Metadata
  notes:                 text("notes"),
  createdByAdminId:      integer("created_by_admin_id"),
  createdAt:             timestamp("created_at").notNull().defaultNow(),
});

export const insertFinancialTransactionSchema = createInsertSchema(financialTransactionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFinancialTransaction = z.infer<typeof insertFinancialTransactionSchema>;
export type FinancialTransaction = typeof financialTransactionsTable.$inferSelect;
