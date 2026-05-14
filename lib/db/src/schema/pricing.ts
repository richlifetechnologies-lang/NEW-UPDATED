import { pgTable, serial, integer, numeric, text, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pricingTable = pgTable("pricing", {
  id: serial("id").primaryKey(),
  minutes: integer("minutes").notNull(),
  credits: integer("credits").notNull().default(0),
  priceUsd: numeric("price_usd", { precision: 10, scale: 2 }).notNull().default("0"),
  priceUsdt: numeric("price_usdt", { precision: 10, scale: 2 }).notNull(),
  priceGhs: numeric("price_ghs", { precision: 10, scale: 2 }).notNull().default("0"),
  label: text("label").notNull(),
  planType: text("plan_type").notNull().default("topup"),  // "topup" | "monthly"
  isActive: boolean("is_active").notNull().default(true),
  // Decart API cost per minute for this package ($0.02/sec = $1.20/min = $72/hr)
  // Used in financial analytics profit/loss calculations.
  apiCostPerMinuteUsd: numeric("api_cost_per_minute_usd", { precision: 10, scale: 4 }).notNull().default("1.20"),
});

export const insertPricingSchema = createInsertSchema(pricingTable).omit({ id: true });
export type InsertPricing = z.infer<typeof insertPricingSchema>;
export type Pricing = typeof pricingTable.$inferSelect;
