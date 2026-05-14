import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const chatSenderEnum = pgEnum("chat_sender", ["user", "admin"]);

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  sender: chatSenderEnum("sender").notNull(),
  message: text("message").notNull(),
  readByAdmin: integer("read_by_admin").notNull().default(0),
  readByUser: integer("read_by_user").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ChatMessage = typeof chatMessagesTable.$inferSelect;
