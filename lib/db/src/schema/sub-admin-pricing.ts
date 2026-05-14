import { pgTable, serial, integer, text, numeric, boolean } from "drizzle-orm/pg-core";

export const subAdminPricingTable = pgTable("sub_admin_pricing", {
  id: serial("id").primaryKey(),
  minutes: integer("minutes").notNull(),
  credits: integer("credits").notNull().default(0),
  priceUsd: numeric("price_usd", { precision: 10, scale: 2 }).notNull().default("0"),
  priceUsdt: numeric("price_usdt", { precision: 10, scale: 2 }).notNull(),
  priceGhs: numeric("price_ghs", { precision: 10, scale: 2 }).notNull().default("0"),
  label: text("label").notNull().default(""),
  planType: text("plan_type").notNull().default("topup"),  // "topup" | "monthly"
  isActive: boolean("is_active").notNull().default(true),
});

export type SubAdminPricing = typeof subAdminPricingTable.$inferSelect;
