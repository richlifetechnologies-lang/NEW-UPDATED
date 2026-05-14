import { pgTable, text, integer, timestamp, pgEnum, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const invoiceStatusEnum = pgEnum("invoice_status", ["pending", "paid", "expired", "cancelled"]);
export const invoiceTypeEnum = pgEnum("invoice_type", ["payment", "credit"]);

export const invoicesTable = pgTable("invoices", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  minutes: integer("minutes").notNull(),
  amountUsd: numeric("amount_usd", { precision: 10, scale: 2 }),
  amountUsdt: numeric("amount_usdt", { precision: 10, scale: 2 }).notNull(),
  status: invoiceStatusEnum("status").notNull().default("pending"),
  type: invoiceTypeEnum("type").notNull().default("payment"),
  walletAddress: text("wallet_address").notNull(),
  walletNetwork: text("wallet_network"),
  txHash: text("tx_hash"),
  note: text("note"),
  creditedBy: integer("credited_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ createdAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
