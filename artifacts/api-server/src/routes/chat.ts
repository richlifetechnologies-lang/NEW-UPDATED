import { Router } from "express";
import { db, chatMessagesTable, usersTable } from "@workspace/db";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";

const router = Router();

router.post("/", requireAuth, async (req, res) => {
  const userId = (req as any).userId as number;
  const { message } = req.body;
  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Message is required" });
    return;
  }
  const [msg] = await db.insert(chatMessagesTable).values({
    userId,
    sender: "user",
    message: message.trim().slice(0, 2000),
    readByAdmin: 0,
    readByUser: 1,
  }).returning();
  res.status(201).json(msg);
});

router.get("/my", requireAuth, async (req, res) => {
  const userId = (req as any).userId as number;
  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.userId, userId))
    .orderBy(chatMessagesTable.createdAt);
  await db.update(chatMessagesTable)
    .set({ readByUser: 1 })
    .where(and(eq(chatMessagesTable.userId, userId), eq(chatMessagesTable.sender, "admin")));
  res.json(messages);
});

router.get("/unread-count", requireAuth, async (req, res) => {
  const userId = (req as any).userId as number;
  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(and(eq(chatMessagesTable.userId, userId), eq(chatMessagesTable.sender, "admin"), eq(chatMessagesTable.readByUser, 0)));
  res.json({ count: messages.length });
});

router.get("/admin/threads", requireAdmin, async (_req, res) => {
  // Step 1: find all distinct user IDs that have chat messages, ordered by
  // their most recent message so the thread list is sorted newest-first.
  const activeUserRows = await db
    .selectDistinct({ userId: chatMessagesTable.userId })
    .from(chatMessagesTable);

  const uniqueUserIds = activeUserRows.map(r => r.userId);
  if (uniqueUserIds.length === 0) { res.json([]); return; }

  // Step 2: batch-fetch all user records in a single query (eliminates N+1)
  const users = await db
    .select({ id: usersTable.id, email: usersTable.email, username: usersTable.username })
    .from(usersTable)
    .where(inArray(usersTable.id, uniqueUserIds));

  const userMap = new Map(users.map(u => [u.id, u]));

  // Step 3: fetch the latest message per user in one query using a lateral
  // subquery approach — get all messages ordered desc, then deduplicate in JS.
  // This is a single round-trip regardless of how many users there are.
  const allLastMessages = await db
    .select()
    .from(chatMessagesTable)
    .where(inArray(chatMessagesTable.userId, uniqueUserIds))
    .orderBy(desc(chatMessagesTable.createdAt));

  // Build a map of userId -> last message (first occurrence after desc sort)
  const lastMessageMap = new Map<number, typeof allLastMessages[0]>();
  for (const msg of allLastMessages) {
    if (!lastMessageMap.has(msg.userId)) lastMessageMap.set(msg.userId, msg);
  }

  // Step 4: fetch unread counts for all users in one query
  const unreadRows = await db
    .select({
      userId: chatMessagesTable.userId,
      unreadCount: sql<number>`cast(count(*) as int)`,
    })
    .from(chatMessagesTable)
    .where(
      and(
        inArray(chatMessagesTable.userId, uniqueUserIds),
        eq(chatMessagesTable.sender, "user"),
        eq(chatMessagesTable.readByAdmin, 0),
      ),
    )
    .groupBy(chatMessagesTable.userId);

  const unreadMap = new Map(unreadRows.map(r => [r.userId, r.unreadCount]));

  // Step 5: assemble threads, sorted by last message time (newest first)
  const threads = uniqueUserIds
    .map((userId) => {
      const user = userMap.get(userId);
      const lastMessage = lastMessageMap.get(userId) ?? null;
      return {
        userId,
        email: user?.email ?? "Unknown",
        username: user?.username ?? "Unknown",
        lastMessage,
        unreadCount: unreadMap.get(userId) ?? 0,
      };
    })
    .sort((a, b) => {
      const aTime = a.lastMessage?.createdAt?.getTime() ?? 0;
      const bTime = b.lastMessage?.createdAt?.getTime() ?? 0;
      return bTime - aTime;
    });

  res.json(threads);
});

router.get("/admin/thread/:userId", requireAdmin, async (req, res) => {
  const userId = parseInt(req.params["userId"] as string);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.userId, userId))
    .orderBy(chatMessagesTable.createdAt);
  await db.update(chatMessagesTable)
    .set({ readByAdmin: 1 })
    .where(and(eq(chatMessagesTable.userId, userId), eq(chatMessagesTable.sender, "user")));
  res.json(messages);
});

router.post("/admin/reply/:userId", requireAdmin, async (req, res) => {
  const userId = parseInt(req.params["userId"] as string);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
  const { message } = req.body;
  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Message is required" }); return;
  }
  const [msg] = await db.insert(chatMessagesTable).values({
    userId,
    sender: "admin",
    message: message.trim().slice(0, 2000),
    readByAdmin: 1,
    readByUser: 0,
  }).returning();
  res.status(201).json(msg);
});

export default router;
