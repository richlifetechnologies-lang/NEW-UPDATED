import { Router } from "express";
import { db, usersTable, sessionsTable, invoicesTable, pricingTable, settingsTable, chatMessagesTable, deviceFingerprintsTable, subAdminAuditTable, subAdminPricingTable, decartApiKeysTable, licenseKeysTable, financialTransactionsTable, decartCreditSettingsTable, billingRateAuditTable } from "@workspace/db";
import { eq, desc, sql, and, gte, isNotNull, lte } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { hashPassword, generateToken } from "../lib/auth";
import { AdminUpdateUserBody, AdminUpdateWalletBody } from "@workspace/api-zod";
import { createDecartClient } from "@decartai/sdk";

import { getAllRates } from "../lib/rates";
import { DECART_CREDITS_PER_SEC, BASE_BILLING_RATE } from "../lib/billing-math";
import { getBillingRate, invalidateBillingRateCache } from "../lib/billing-rate-cache";
import { getAllKeysCreditStatus, getKeyCreditStatus, recordTopup, recordTopupDelta, getKeyUsageHistory } from "../lib/credit-tracker";
import { emitBillingRateChanged } from "../lib/billing-ws";

function parseLoginBody(body: unknown): { email: string; password: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.email !== "string" || !b.email.includes("@")) return null;
  if (typeof b.password !== "string" || b.password.length < 1) return null;
  return { email: b.email, password: b.password };
}
function parseRegisterBody(body: unknown): { email: string; username: string; password: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.email !== "string" || !b.email.includes("@")) return null;
  if (typeof b.username !== "string" || b.username.length < 3 || b.username.length > 20) return null;
  if (typeof b.password !== "string" || b.password.length < 8) return null;
  return { email: b.email, username: b.username, password: b.password };
}
const LoginBody = { safeParse: (body: unknown) => { const data = parseLoginBody(body); return data ? { success: true as const, data } : { success: false as const }; } };
const RegisterBody = { safeParse: (body: unknown) => { const data = parseRegisterBody(body); return data ? { success: true as const, data } : { success: false as const }; } };

const router = Router();

router.post("/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { email, password } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  const isMainAdmin = user?.isAdmin === 1;
  const isSubAdmin  = user?.isSubAdmin === 1; // isSubAdmin is in usersTable schema — no cast needed
  if (!user || (!isMainAdmin && !isSubAdmin) || user.passwordHash !== hashPassword(password) || user.membership === "suspended") {
    res.status(401).json({ error: "Invalid admin credentials" });
    return;
  }
  // Log sub admin login for audit trail
  if (isSubAdmin) {
    await db.insert(subAdminAuditTable).values({
      subAdminId: user.id,
      action: "login",
      note: `Login at ${new Date().toISOString()}`,
    }).catch(() => { /* non-fatal */ });
  }
  const token = generateToken(user.id, isMainAdmin, isSubAdmin);
  res.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      membership: user.membership,
      freeSecondsRemaining: user.freeSecondsRemaining,
      totalMinutesPurchased: user.totalMinutesPurchased,
      totalMinutesUsed: Math.round(user.totalSecondsUsed / 60 * 100) / 100,
      createdAt: user.createdAt,
      avatarUrl: user.avatarUrl ?? null,
      isSubAdmin: isSubAdmin ? 1 : 0,
    },
    token,
  });
});

router.get("/dashboard", requireAdmin, async (req, res) => {
  const totalUsers = await db.select({ count: sql<number>`COUNT(*)` }).from(licenseKeysTable);
  const activeUsers = await db.select({ count: sql<number>`COUNT(*)` })
    .from(usersTable).where(eq(usersTable.membership, "active"));
  const activeSessions = await db.select({ count: sql<number>`COUNT(*)` })
    .from(sessionsTable).where(eq(sessionsTable.status, "active"));
  // FIX: Combine USDT invoice revenue + USD license key revenue
  const invoiceRevenue = await db.select({ total: sql<string>`COALESCE(SUM(amount_usdt), 0)` })
    .from(invoicesTable).where(and(eq(invoicesTable.status, "paid"), eq(invoicesTable.type, "payment")));
  const licenseRevenue = await db.select({ total: sql<string>`COALESCE(SUM(revenue_usd), 0)` })
    .from(financialTransactionsTable);
  const totalRevenue = [{
    total: String(parseFloat(invoiceRevenue[0]?.total ?? "0") + parseFloat(licenseRevenue[0]?.total ?? "0"))
  }];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const invoiceToday = await db.select({ total: sql<string>`COALESCE(SUM(amount_usdt), 0)` })
    .from(invoicesTable).where(and(eq(invoicesTable.status, "paid"), eq(invoicesTable.type, "payment"), gte(invoicesTable.paidAt, today)));
  const licenseToday = await db.select({ total: sql<string>`COALESCE(SUM(revenue_usd), 0)` })
    .from(financialTransactionsTable).where(gte(financialTransactionsTable.createdAt, today));
  const revenueToday = [{
    total: String(parseFloat(invoiceToday[0]?.total ?? "0") + parseFloat(licenseToday[0]?.total ?? "0"))
  }];
  const newUsersToday = await db.select({ count: sql<number>`COUNT(*)` })
    .from(licenseKeysTable).where(gte(licenseKeysTable.activatedAt, today));

  const [creditResetRow] = await db.select().from(settingsTable)
    .where(eq(settingsTable.key, "admin_credits_reset_at"));
  const creditResetAt = creditResetRow?.value ? new Date(creditResetRow.value) : null;

  const totalCredits = await db.select({
    total: sql<string>`COALESCE(SUM(amount_usdt), 0)`,
    count: sql<number>`COUNT(*)`,
    minutes: sql<string>`COALESCE(SUM(minutes), 0)`,
  }).from(invoicesTable).where(
    creditResetAt
      ? and(eq(invoicesTable.status, "paid"), eq(invoicesTable.type, "credit"), gte(invoicesTable.paidAt, creditResetAt))
      : and(eq(invoicesTable.status, "paid"), eq(invoicesTable.type, "credit"))
  );

  const recentUsers = await db.select().from(usersTable)
    .orderBy(desc(usersTable.createdAt)).limit(5);
  const recentInvoices = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.status, "paid"), eq(invoicesTable.type, "payment")))
    .orderBy(desc(invoicesTable.paidAt)).limit(5);
  const recentCredits = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.status, "paid"), eq(invoicesTable.type, "credit")))
    .orderBy(desc(invoicesTable.paidAt)).limit(5);

  const recentActivity = [
    ...recentUsers.map(u => ({
      type: "user_registered",
      message: `${u.username} registered`,
      timestamp: u.createdAt.toISOString(),
    })),
    ...recentInvoices.map(inv => ({
      type: "payment_received",
      message: `Payment of ${inv.amountUsdt} USDT for ${inv.minutes} min`,
      timestamp: (inv.paidAt ?? inv.createdAt).toISOString(),
    })),
    ...recentCredits.map(inv => ({
      type: "admin_credit",
      message: `Admin credited ${inv.minutes} min (≈${inv.amountUsdt} USDT)`,
      timestamp: (inv.paidAt ?? inv.createdAt).toISOString(),
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10);

  res.json({
    totalUsers: Number(totalUsers[0]?.count ?? 0),
    activeUsers: Number(activeUsers[0]?.count ?? 0),
    activeSessions: Number(activeSessions[0]?.count ?? 0),
    totalRevenue: parseFloat(totalRevenue[0]?.total ?? "0"),
    revenueToday: parseFloat(revenueToday[0]?.total ?? "0"),
    newUsersToday: Number(newUsersToday[0]?.count ?? 0),
    keysActivatedToday: Number(newUsersToday[0]?.count ?? 0),
    totalCreditedUsdt: parseFloat(totalCredits[0]?.total ?? "0"),
    totalCreditedMinutes: Number(totalCredits[0]?.minutes ?? 0),
    totalCreditsCount: Number(totalCredits[0]?.count ?? 0),
    creditStatsResetAt: creditResetAt?.toISOString() ?? null,
    recentActivity,
  });
});

router.get("/analytics", requireAdmin, async (_req, res) => {
  try {
    const [totalLicenseKeys] = await db.select({ count: sql<number>`COUNT(*)` }).from(licenseKeysTable);
    const [activeLicenseKeys] = await db.select({ count: sql<number>`COUNT(*)` })
      .from(licenseKeysTable).where(sql`is_active = true`);
    const [totalSessions] = await db.select({ count: sql<number>`COUNT(*)` }).from(sessionsTable);
    const [totalMinutesStreamed] = await db.select({
      total: sql<string>`COALESCE(SUM(duration_seconds), 0)`,
    }).from(sessionsTable);

    // Use raw SQL for status/type to avoid Drizzle ORM reserved-name conflicts
    const [totalRevenue] = await db.select({ total: sql<string>`COALESCE(SUM(amount_usdt), 0)` })
      .from(invoicesTable)
      .where(sql`status::text = 'paid' AND type::text = 'payment'`);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [newLicenseKeysToday] = await db.select({ count: sql<number>`COUNT(*)` })
      .from(licenseKeysTable).where(gte(licenseKeysTable.activatedAt, today));

    const totalMinutes = parseFloat(totalMinutesStreamed?.total ?? "0") / 60;
    res.json({
      totalLicenseKeys: Number(totalLicenseKeys?.count ?? 0),
      activeLicenseKeys: Number(activeLicenseKeys?.count ?? 0),
      totalSessions: Number(totalSessions?.count ?? 0),
      totalMinutesStreamed: Math.round(totalMinutes * 100) / 100,
      totalRevenue: parseFloat(totalRevenue?.total ?? "0"),
      newLicenseKeysToday: Number(newLicenseKeysToday?.count ?? 0),
    });
  } catch (err) {
    console.error("[admin:analytics]", err);
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

router.post("/credits/reset", requireAdmin, async (_req, res) => {
  const now = new Date();
  await db.insert(settingsTable)
    .values({ key: "admin_credits_reset_at", value: now.toISOString() })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: now.toISOString() } });
  res.json({ resetAt: now.toISOString() });
});

router.get("/users", requireAdmin, async (_req, res) => {
  const users = await db.select().from(usersTable)
    .orderBy(desc(usersTable.createdAt));
  const lastSessions = await db.select({
    userId: sessionsTable.userId,
    lastSession: sql<Date>`MAX(started_at)`,
  }).from(sessionsTable).groupBy(sessionsTable.userId);
  const lastSessionMap = new Map(lastSessions.map(s => [s.userId, s.lastSession]));

  res.json(users.map(u => ({
    id: u.id,
    email: u.email,
    username: u.username,
    membership: u.membership,
    totalMinutesPurchased: u.totalMinutesPurchased,
    totalMinutesUsed: Math.round(u.totalSecondsUsed / 60 * 100) / 100,
    freeSecondsRemaining: u.freeSecondsRemaining,
    createdAt: u.createdAt,
    lastSession: lastSessionMap.get(u.id) ?? null,
    isSubAdmin: (u as any).isSubAdmin ?? 0,
  })));
});

router.delete("/users/:userId", requireAdmin, async (req, res) => {
  const userId = parseInt(req.params["userId"] as string);
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.isAdmin) {
    res.status(403).json({ error: "Cannot delete an admin account" });
    return;
  }

  // Cascade-delete all data belonging to this user before removing the account
  await db.delete(chatMessagesTable).where(eq(chatMessagesTable.userId, userId));
  await db.delete(deviceFingerprintsTable).where(eq(deviceFingerprintsTable.userId, userId));
  await db.delete(invoicesTable).where(eq(invoicesTable.userId, userId));
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));

  res.json({ message: "User deleted" });
});

router.patch("/users/:userId", requireAdmin, async (req, res) => {
  const userId = parseInt(req.params["userId"] as string);
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }
  const parsed = AdminUpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const updates: any = {};
  if (parsed.data.membership) updates.membership = parsed.data.membership;
  if (parsed.data.totalMinutesPurchased !== undefined) updates.totalMinutesPurchased = parsed.data.totalMinutesPurchased;

  const [updated] = await db.update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, userId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    id: updated.id,
    email: updated.email,
    username: updated.username,
    membership: updated.membership,
    totalMinutesPurchased: updated.totalMinutesPurchased,
    totalMinutesUsed: updated.totalSecondsUsed / 60,
    freeSecondsRemaining: updated.freeSecondsRemaining,
    createdAt: updated.createdAt,
    lastSession: null,
  });
});

router.post("/users/:userId/reset-password", requireAdmin, async (req, res) => {
  const userId = parseInt(req.params["userId"] as string);
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }
  const { newPassword } = req.body as { newPassword?: string };
  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  await db.update(usersTable)
    .set({ passwordHash: hashPassword(newPassword) })
    .where(eq(usersTable.id, userId));
  res.json({ message: `Password reset for ${user.email}` });
});

// ── User Pricing CRUD ─────────────────────────────────────────────────────

// GET /admin/pricing — full list for admin UI
router.get("/pricing", requireAdmin, async (_req, res) => {
  const tiers = await db.select().from(pricingTable).orderBy(pricingTable.minutes);
  res.json(tiers.map(t => ({
    id: t.id,
    minutes: t.minutes,
    credits: t.credits,
    priceUsd: parseFloat(t.priceUsd),
    priceUsdt: parseFloat(t.priceUsdt),
    priceGhs: parseFloat(t.priceGhs),
    label: t.label,
    planType: t.planType ?? "topup",
    isActive: t.isActive ?? true,
  })));
});

// POST /admin/pricing — create a new user pricing tier
router.post("/pricing", requireAdmin, async (req, res) => {
  const { minutes, credits, priceUsd, priceUsdt, priceGhs, label, planType, isActive } = req.body;
  if (!minutes || !priceUsdt || !label) {
    return res.status(400).json({ error: "minutes, priceUsdt, and label are required" });
  }
  const [tier] = await db.insert(pricingTable).values({
    minutes: Number(minutes),
    credits: credits ?? 0,
    priceUsd: priceUsd ?? priceUsdt,
    priceUsdt: String(parseFloat(priceUsdt).toFixed(2)),
    priceGhs: priceGhs ?? "0",
    label,
    planType: planType ?? "topup",
    isActive: isActive ?? true,
  } as any).returning();
  return res.status(201).json(tier);
});

// PUT /admin/pricing/:id — update a user pricing tier
router.put("/pricing/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const { minutes, credits, priceUsd, priceUsdt, priceGhs, label, planType, isActive } = req.body;
  await db.update(pricingTable).set({
    ...(minutes   !== undefined && { minutes: Number(minutes) }),
    ...(credits   !== undefined && { credits: Number(credits) }),
    ...(priceUsd  !== undefined && { priceUsd: String(priceUsd) }),
    ...(priceUsdt !== undefined && { priceUsdt: String(parseFloat(priceUsdt).toFixed(2)) }),
    ...(priceGhs  !== undefined && { priceGhs: String(priceGhs) }),
    ...(label     !== undefined && { label }),
    ...(planType  !== undefined && { planType }),
    ...(isActive  !== undefined && { isActive }),
  } as any).where(eq(pricingTable.id, id));
  return res.json({ success: true });
});

// DELETE /admin/pricing/:id — delete a user pricing tier
router.delete("/pricing/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  await db.delete(pricingTable).where(eq(pricingTable.id, id));
  return res.json({ success: true });
});

router.get("/wallet", requireAdmin, async (req, res) => {
  const allSettings = await db.select().from(settingsTable);
  const getSetting = (key: string) => allSettings.find(s => s.key === key)?.value ?? "";
  const wallets: Array<{ address: string; network: string }> = [];
  for (let i = 1; i <= 3; i++) {
    const address = getSetting(`wallet_${i}_address`);
    if (address) wallets.push({ address, network: getSetting(`wallet_${i}_network`) || "TRC-20 (Tron)" });
  }
  // Fallback to legacy key if no numbered wallets exist
  if (wallets.length === 0) {
    const addr = getSetting("usdt_wallet");
    if (addr) wallets.push({ address: addr, network: getSetting("usdt_network") || "TRC-20 (Tron)" });
  }
  const first = wallets[0] ?? { address: "", network: "TRC-20 (Tron)" };
  res.json({ address: first.address, network: first.network, wallets });
});

router.put("/wallet", requireAdmin, async (req, res) => {
  const body = req.body as { address?: string; network?: string; wallets?: Array<{ address: string; network: string }> };

  // Support array of up to 3 wallets
  const walletsToSave: Array<{ address: string; network: string }> = [];
  if (Array.isArray(body.wallets) && body.wallets.length > 0) {
    body.wallets.slice(0, 3).forEach(w => {
      if (w.address) walletsToSave.push({ address: w.address, network: w.network || "USDT" });
    });
  } else if (body.address) {
    walletsToSave.push({ address: body.address, network: body.network || "USDT" });
  }

  if (walletsToSave.length === 0) {
    res.status(400).json({ error: "At least one wallet address is required" });
    return;
  }

  // Delete old numbered wallet keys, then re-insert
  for (let i = 1; i <= 3; i++) {
    await db.delete(settingsTable).where(eq(settingsTable.key, `wallet_${i}_address`));
    await db.delete(settingsTable).where(eq(settingsTable.key, `wallet_${i}_network`));
  }

  for (let i = 0; i < walletsToSave.length; i++) {
    const n = i + 1;
    await db.insert(settingsTable).values({ key: `wallet_${n}_address`, value: walletsToSave[i].address })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: walletsToSave[i].address } });
    await db.insert(settingsTable).values({ key: `wallet_${n}_network`, value: walletsToSave[i].network })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: walletsToSave[i].network } });
  }

  // Keep legacy keys pointing to first wallet for backward compat
  await db.insert(settingsTable).values({ key: "usdt_wallet", value: walletsToSave[0].address })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: walletsToSave[0].address } });
  await db.insert(settingsTable).values({ key: "usdt_network", value: walletsToSave[0].network })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: walletsToSave[0].network } });

  res.json({ address: walletsToSave[0].address, network: walletsToSave[0].network, wallets: walletsToSave });
});

router.post("/admins", requireAdmin, async (req, res) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "email, username (3-20 chars) and password (min 8) required" });
    return;
  }
  const { email, username, password } = parsed.data;
  const avatarUrl: string | null = typeof req.body.avatarUrl === "string" ? req.body.avatarUrl : null;

  const [existing] = await db.select().from(usersTable)
    .where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "Email already in use" });
    return;
  }

  const [newAdmin] = await db.insert(usersTable).values({
    email,
    username,
    passwordHash: hashPassword(password),
    membership: "active" as const,
    isAdmin: 1,
    avatarUrl,
  }).returning();

  res.status(201).json({
    id: newAdmin.id,
    email: newAdmin.email,
    username: newAdmin.username,
    avatarUrl: newAdmin.avatarUrl ?? null,
  });
});

router.get("/revenue-chart", requireAdmin, async (_req, res) => {
  // Build a 30-day date series (UTC days)
  const days: { date: string; start: Date; end: Date }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const end = new Date(d);
    end.setUTCDate(end.getUTCDate() + 1);
    days.push({ date: d.toISOString().slice(0, 10), start: d, end });
  }

  const rows = await db
    .select({
      day: sql<string>`DATE(paid_at AT TIME ZONE 'UTC')`,
      usdt: sql<string>`COALESCE(SUM(amount_usdt), 0)`,
      payments: sql<number>`COUNT(*)`,
    })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.status, "paid"),
        gte(invoicesTable.paidAt, days[0].start),
      ),
    )
    .groupBy(sql`DATE(paid_at AT TIME ZONE 'UTC')`)
    .orderBy(sql`DATE(paid_at AT TIME ZONE 'UTC')`);

  const rowMap = new Map(rows.map(r => [r.day, r]));

  res.json(
    days.map(d => ({
      date: d.date,
      usdt: parseFloat(rowMap.get(d.date)?.usdt ?? "0"),
      payments: Number(rowMap.get(d.date)?.payments ?? 0),
    })),
  );
});

// GET /admin/active-sessions — lightweight real-time count + list (poll every 5s)
router.get("/active-sessions", requireAdmin, async (_req, res) => {
  const sessions = await db.select({
    id: sessionsTable.id,
    userId: sessionsTable.userId,
    username: usersTable.username,
    email: usersTable.email,
    style: sessionsTable.style,
    startedAt: sessionsTable.startedAt,
  })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(eq(sessionsTable.status, "active"))
    .orderBy(desc(sessionsTable.startedAt));

  res.json({
    count: sessions.length,
    sessions: sessions.map(s => ({
      id: s.id,
      userId: s.userId,
      username: s.username,
      email: s.email,
      style: s.style ?? "natural",
      startedAt: s.startedAt,
    })),
  });
});

router.get("/sessions", requireAdmin, async (_req, res) => {
  // Auto-expire sessions whose heartbeat is older than 30 seconds (zombie sessions)
  const staleThreshold = new Date(Date.now() - 30_000);
  const staleSessions = await db.select().from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.status, "active"),
        sql`(
          (${sessionsTable.lastHeartbeatAt} IS NOT NULL AND ${sessionsTable.lastHeartbeatAt} < ${staleThreshold})
          OR
          (${sessionsTable.lastHeartbeatAt} IS NULL AND ${sessionsTable.startedAt} < ${staleThreshold})
        )`
      )
    );

  // Mark each stale session as stopped and deduct time from the user
  for (const session of staleSessions) {
    const now = new Date();
    const billingStart = (session as any).billingStartedAt ?? session.startedAt;
    const durationSeconds = Math.floor((now.getTime() - new Date(billingStart).getTime()) / 1000);
    await db.update(sessionsTable)
      .set({ status: "stopped", stoppedAt: now, durationSeconds })
      .where(eq(sessionsTable.id, session.id));

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId as number));
    if (user && !user.isAdmin) {
      const freeDeduct = Math.min(user.freeSecondsRemaining, durationSeconds);
      const paidDeduct = durationSeconds - freeDeduct;
      await db.update(usersTable)
        .set({
          freeSecondsRemaining: Math.max(0, user.freeSecondsRemaining - freeDeduct),
          totalSecondsUsed: user.totalSecondsUsed + paidDeduct,
        })
        .where(eq(usersTable.id, user.id));
    }
  }

  const sessions = await db.select({
    id: sessionsTable.id,
    userId: sessionsTable.userId,
    username: usersTable.username,
    status: sessionsTable.status,
    startedAt: sessionsTable.startedAt,
    style: sessionsTable.style,
  })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(eq(sessionsTable.status, "active"))
    .orderBy(desc(sessionsTable.startedAt));

  res.json(sessions.map(s => ({
    id: s.id,
    userId: s.userId,
    username: s.username,
    status: s.status,
    startedAt: s.startedAt,
    style: s.style ?? null,
  })));
});

router.post("/sessions/:sessionId/terminate", requireAdmin, async (req, res) => {
  const sessionId = req.params["sessionId"] as string;

  const [session] = await db.select().from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (session.status !== "active") {
    res.status(400).json({ error: "Session is not active" });
    return;
  }

  const now = new Date();
  const billingStart = session.billingStartedAt ?? session.startedAt;
  const durationSeconds = Math.floor((now.getTime() - billingStart.getTime()) / 1000);

  const [updated] = await db.update(sessionsTable)
    .set({ status: "stopped", stoppedAt: now, durationSeconds })
    .where(eq(sessionsTable.id, sessionId))
    .returning();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId as number));
  if (user && !user.isAdmin) {
    const freeDeduct = Math.min(user.freeSecondsRemaining, durationSeconds);
    const paidDeduct = durationSeconds - freeDeduct;
    await db.update(usersTable)
      .set({
        freeSecondsRemaining: Math.max(0, user.freeSecondsRemaining - freeDeduct),
        totalSecondsUsed: user.totalSecondsUsed + paidDeduct,
      })
      .where(eq(usersTable.id, user.id));
  }

  res.json({ id: updated.id, status: updated.status, durationSeconds: updated.durationSeconds });
});

router.post("/admins/:userId/suspend", requireAdmin, async (req, res) => {
  const userId = parseInt(req.params["userId"] as string);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const requestingAdmin = (req as any).user;
  if (requestingAdmin.id === userId) {
    res.status(403).json({ error: "You cannot suspend your own account" });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!target || !target.isAdmin) { res.status(404).json({ error: "Admin not found" }); return; }

  const [updated] = await db.update(usersTable)
    .set({ isAdmin: 0, membership: "suspended" as const })
    .where(eq(usersTable.id, userId))
    .returning();

  res.json({ id: updated.id, email: updated.email, username: updated.username, membership: updated.membership, isAdmin: updated.isAdmin });
});

router.get("/admin-sessions", requireAdmin, async (_req, res) => {
  const rows = await db.select({
    id: sessionsTable.id,
    userId: sessionsTable.userId,
    username: usersTable.username,
    email: usersTable.email,
    avatarUrl: usersTable.avatarUrl,
    status: sessionsTable.status,
    startedAt: sessionsTable.startedAt,
    stoppedAt: sessionsTable.stoppedAt,
    durationSeconds: sessionsTable.durationSeconds,
    style: sessionsTable.style,
  })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(eq(usersTable.isAdmin, 1))
    .orderBy(desc(sessionsTable.startedAt))
    .limit(200);

  res.json(rows.map(s => ({
    id: s.id,
    userId: s.userId,
    username: s.username,
    email: s.email,
    avatarUrl: s.avatarUrl ?? null,
    status: s.status,
    startedAt: s.startedAt,
    stoppedAt: s.stoppedAt ?? null,
    durationSeconds: s.durationSeconds ?? null,
    style: s.style ?? null,
  })));
});

// ── Decart API key health check ─────────────────────────────────────────────
router.get("/decart-status", requireAdmin, async (req, res) => {
  // DB-first resolution — same pattern as decart.ts resolveDecartApiKey()
  let apiKey: string | null = null;
  try {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "decart_api_key"));
    if (row?.value) apiKey = row.value;
  } catch { /* fall through */ }
  if (!apiKey) apiKey = process.env.DECART_API_KEY ?? null;

  if (!apiKey) {
    res.json({ ok: false, error: "DECART_API_KEY is not set on the server", checkedAt: new Date().toISOString() });
    return;
  }
  try {
    const client = createDecartClient({ apiKey });
    await client.tokens.create({
      expiresIn: 60,
      allowedModels: ["lucy-2.1"],
      constraints: { realtime: { maxSessionDuration: 60 } },
    });
    res.json({ ok: true, checkedAt: new Date().toISOString() });
  } catch (err: unknown) {
    const error = err instanceof Error
      ? err.message
      : String((err as any)?.message ?? (err as any)?.error ?? "Unknown error");
    req.log.warn({ err }, "Decart key health check failed");
    res.json({ ok: false, error, checkedAt: new Date().toISOString() });
  }
});

// ── Decart platform usage stats ──────────────────────────────────────────────
router.get("/decart-usage", requireAdmin, async (_req, res) => {
  const [totals] = await db
    .select({
      totalSeconds: sql<number>`COALESCE(SUM(${usersTable.totalSecondsUsed}), 0)`,
      totalUsers:   sql<number>`COUNT(DISTINCT ${usersTable.id})`,
    })
    .from(usersTable);

  const [sessionsToday] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(sessionsTable)
    .where(sql`${sessionsTable.startedAt} >= NOW() - INTERVAL '24 hours'`);

  const [sessionsAllTime] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(sessionsTable);

  const totalMinutes = Math.round((totals?.totalSeconds ?? 0) / 60);

  // Fetch the tier performance reset timestamp (if set)
  const [resetRow] = await db.select().from(settingsTable)
    .where(eq(settingsTable.key, "tier_performance_reset_at"));
  const resetAt = resetRow?.value ? new Date(resetRow.value) : null;
  const resetAtIso = resetAt?.toISOString() ?? null;

  // Per-tier session counts + streamed minutes (filtered by reset date if set)
  const tierRows = await db
    .select({
      label: sessionsTable.packageLabel,
      count: sql<number>`COUNT(*)`,
      totalSeconds: sql<number>`COALESCE(SUM(${sessionsTable.durationSeconds}), 0)`,
    })
    .from(sessionsTable)
    .where(resetAt ? gte(sessionsTable.startedAt, resetAt) : sql`1=1`)
    .groupBy(sessionsTable.packageLabel);

  // Per-tier revenue from paid invoices (filtered by reset date if set)
  const tiers = await db.select().from(pricingTable).orderBy(pricingTable.minutes);

  const revenueRows = await db
    .select({
      minutes: invoicesTable.minutes,
      totalRevenue: sql<string>`COALESCE(SUM(${invoicesTable.amountUsdt}), 0)`,
      purchaseCount: sql<number>`COUNT(*)`,
    })
    .from(invoicesTable)
    .where(
      resetAt
        ? and(eq(invoicesTable.status, "paid"), gte(invoicesTable.paidAt, resetAt))
        : eq(invoicesTable.status, "paid")
    )
    .groupBy(invoicesTable.minutes);

  const tierBreakdown = tiers.map(tier => {
    // Match by pricing tier label OR by "Xmin license" format from license-based sessions
    const row = tierRows.find(r =>
      r.label === tier.label ||
      r.label === `${tier.minutes}min license`
    );
    const rev = revenueRows.find(r => r.minutes === tier.minutes);
    return {
      label: tier.label,
      minutes: tier.minutes,
      sessionCount: Number(row?.count ?? 0),
      minutesStreamed: Math.round(Number(row?.totalSeconds ?? 0) / 60),
      revenueUsdt: parseFloat(rev?.totalRevenue ?? "0"),
      purchaseCount: Number(rev?.purchaseCount ?? 0),
    };
  });

  // Also include any sessions with null/unmatched labels as "Unknown"
  // Exclude sessions that matched a tier via the "Xmin license" fallback format
  const unknownRow = tierRows.find(r =>
    r.label === null ||
    (!tiers.find(t => t.label === r.label) && !tiers.find(t => `${t.minutes}min license` === r.label))
  );
  if (unknownRow) {
    tierBreakdown.push({
      label: "Unknown",
      minutes: 0,
      sessionCount: Number(unknownRow.count ?? 0),
      minutesStreamed: Math.round(Number(unknownRow.totalSeconds ?? 0) / 60),
      revenueUsdt: 0,
      purchaseCount: 0,
    });
  }

  res.json({
    totalMinutesStreamed: totalMinutes,
    totalSessionsAllTime: Number(sessionsAllTime?.count ?? 0),
    sessionsLast24h:      Number(sessionsToday?.count ?? 0),
    tierBreakdown,
    tierPerformanceResetAt: resetAtIso,
    note: "Decart does not expose a public credits API. These figures reflect usage through this platform.",
  });
});

// Reset tier performance — stores current timestamp; future queries filter from here
router.post("/decart-usage/reset", requireAdmin, async (_req, res) => {
  const now = new Date().toISOString();
  await db.insert(settingsTable)
    .values({ key: "tier_performance_reset_at", value: now })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: now } });
  res.json({ resetAt: now });
});

// ── Admin Credit Minutes to User ─────────────────────────────────────────────
router.post("/users/:userId/credit", requireAdmin, async (req, res) => {
  const userId = parseInt(req.params["userId"] as string);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const { minutes, note } = req.body as { minutes?: number; note?: string };
  if (!minutes || minutes < 1 || !Number.isInteger(minutes)) {
    res.status(400).json({ error: "minutes must be a positive integer" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.isAdmin) { res.status(400).json({ error: "Cannot credit admin accounts" }); return; }

  // Calculate USDT equivalent from pricing tiers (rate = priceUsdt / minutes, pick best match)
  const tiers = await db.select().from(pricingTable).orderBy(pricingTable.minutes);
  let ratePerMin = 1.90; // fallback: $1.90/min (Starter rate)
  if (tiers.length > 0) {
    const closest = tiers.reduce((prev, curr) =>
      Math.abs(curr.minutes - minutes) < Math.abs(prev.minutes - minutes) ? curr : prev
    );
    ratePerMin = parseFloat(closest.priceUsdt) / closest.minutes;
  }
  const amountUsdt = parseFloat((ratePerMin * minutes).toFixed(2));

  const creditedById = (req as any).user?.id ?? null;

  const now = new Date();
  const invoiceId = `crd_${Date.now()}_${userId}`;
  const [invoice] = await db.insert(invoicesTable).values({
    id: invoiceId,
    userId,
    minutes,
    amountUsd: amountUsdt.toString(),
    amountUsdt: amountUsdt.toString(),
    status: "paid",
    type: "credit",
    walletAddress: "ADMIN_CREDIT",
    txHash: null,
    note: note?.trim() || null,
    creditedBy: creditedById,
    paidAt: now,
  }).returning();

  await db.update(usersTable)
    .set({ totalMinutesPurchased: user.totalMinutesPurchased + minutes, membership: "active" })
    .where(eq(usersTable.id, userId));

  res.json({
    id: invoice.id,
    userId: invoice.userId,
    minutes: invoice.minutes,
    amountUsdt,
    amountUsd: amountUsdt,
    note: invoice.note,
    creditedBy: invoice.creditedBy,
    status: invoice.status,
    type: invoice.type,
    createdAt: invoice.createdAt,
    paidAt: invoice.paidAt,
  });
});

// ── List all admin credits ────────────────────────────────────────────────────
router.get("/credits", requireAdmin, async (_req, res) => {
  const credits = await db.select({
    id: invoicesTable.id,
    userId: invoicesTable.userId,
    minutes: invoicesTable.minutes,
    amountUsdt: invoicesTable.amountUsdt,
    note: invoicesTable.note,
    creditedBy: invoicesTable.creditedBy,
    createdAt: invoicesTable.createdAt,
    paidAt: invoicesTable.paidAt,
    username: usersTable.username,
    email: usersTable.email,
  })
    .from(invoicesTable)
    .leftJoin(usersTable, eq(invoicesTable.userId, usersTable.id))
    .where(and(eq(invoicesTable.status, "paid"), eq(invoicesTable.type, "credit")))
    .orderBy(desc(invoicesTable.paidAt));

  res.json(credits.map(c => ({
    ...c,
    amountUsdt: parseFloat(c.amountUsdt),
  })));
});

// ── Decart Credits Left (auto-tracked) ───────────────────────────────────────
router.get("/decart-credits", requireAdmin, async (_req, res) => {
  const settings = await db.select().from(settingsTable).where(
    sql`${settingsTable.key} IN ('decart_credits_left', 'decart_credits_set_at')`
  );
  const baseRow = settings.find(r => r.key === "decart_credits_left");
  const setAtRow = settings.find(r => r.key === "decart_credits_set_at");

  const base = baseRow ? Number(baseRow.value) : null;
  const setAt = setAtRow?.value ?? null;

  // Count seconds consumed by sessions that started on or after setAt
  let consumedSeconds = 0;
  let activeSessions = 0;
  if (setAt) {
    const setAtDate = new Date(setAt);
    const now = new Date();

    // Active sessions (not yet ended): count billing seconds from billingStartedAt to now
    // Only count sessions where Decart output has actually started (billingStartedAt is set)
    const activRows = await db.select({
      startedAt: sessionsTable.startedAt,
      billingStartedAt: sessionsTable.billingStartedAt,
    }).from(sessionsTable)
      .where(and(eq(sessionsTable.status, "active"), gte(sessionsTable.startedAt, setAtDate)));
    for (const r of activRows) {
      if (!r.billingStartedAt) continue; // output hasn't started yet — no credits consumed, don't count as active
      activeSessions += 1;
      consumedSeconds += Math.floor((now.getTime() - new Date(r.billingStartedAt).getTime()) / 1000);
    }

    // Stopped/expired sessions that started after setAt
    const doneRows = await db.select({
      durationSeconds: sessionsTable.durationSeconds,
    }).from(sessionsTable)
      .where(and(
        sql`${sessionsTable.status} IN ('stopped', 'expired')`,
        gte(sessionsTable.startedAt, setAtDate),
        isNotNull(sessionsTable.durationSeconds)
      ));
    for (const r of doneRows) {
      consumedSeconds += r.durationSeconds ?? 0;
    }
  }

  const creditsConsumed = consumedSeconds * 5; // 5 credits/sec per active stream
  const estimatedRemaining = base !== null ? Math.max(0, base - creditsConsumed) : null;

  // ── Hourly consumption rate (last 7 days of completed sessions) ─────────────
  // Use the later of: 7 days ago OR when balance was last set.
  // This ensures the rate reflects activity since the last top-up.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rateWindowStart = setAt
    ? new Date(Math.max(new Date(setAt).getTime(), sevenDaysAgo.getTime()))
    : sevenDaysAgo;

  const rateRows = await db
    .select({ durationSeconds: sessionsTable.durationSeconds })
    .from(sessionsTable)
    .where(and(
      sql`${sessionsTable.status} IN ('stopped', 'expired')`,
      gte(sessionsTable.startedAt, rateWindowStart),
      isNotNull(sessionsTable.durationSeconds),
    ));

  // Total billing seconds × 5 = credits consumed (updated rate: 5 credits/sec/stream)
  const totalBillingSecsForRate = rateRows.reduce((s, r) => s + (r.durationSeconds ?? 0), 0);
  const windowHours = Math.max(1, (Date.now() - rateWindowStart.getTime()) / (1_000 * 3_600));
  const hourlyRateCredits = (totalBillingSecsForRate * 5) / windowHours;

  // Estimated days remaining at current burn rate
  const daysRemaining = (estimatedRemaining !== null && hourlyRateCredits > 0)
    ? estimatedRemaining / (hourlyRateCredits * 24)
    : null;

  res.json({
    credits: base,
    setAt,
    consumedSeconds: creditsConsumed,
    activeSessions,
    estimatedRemaining,
    hourlyRateCredits: Math.round(hourlyRateCredits * 100) / 100,
    daysRemaining: daysRemaining !== null ? Math.round(daysRemaining * 10) / 10 : null,
  });
});

router.put("/decart-credits", requireAdmin, async (req, res) => {
  const raw = req.body?.credits;
  const credits = Number(raw);
  if (isNaN(credits) || credits < 0) {
    res.status(400).json({ error: "credits must be a non-negative number" });
    return;
  }
  const now = new Date().toISOString();
  await db
    .insert(settingsTable)
    .values({ key: "decart_credits_left", value: String(credits) })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: String(credits) } });
  await db
    .insert(settingsTable)
    .values({ key: "decart_credits_set_at", value: now })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: now } });
  res.json({ credits, setAt: now, consumedSeconds: 0, activeSessions: 0, estimatedRemaining: credits });
});

// ── Decart API credentials (stored in DB, live effect) ────────────────────────
// GET returns masked values so admin can confirm keys are set without exposing them.
// PUT saves new values; decart.ts reads from DB-first, so effect is immediate.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/decart-credentials", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(settingsTable).where(
      sql`${settingsTable.key} IN ('decart_api_key', 'decart_secret_key', 'decart_creds_updated_at')`
    );
    const apiKeyRow    = rows.find(r => r.key === "decart_api_key");
    const secretKeyRow = rows.find(r => r.key === "decart_secret_key");
    const updatedAtRow = rows.find(r => r.key === "decart_creds_updated_at");

    const mask = (v?: string) =>
      v && v.length > 12 ? v.slice(0, 8) + "••••••••" + v.slice(-4) : v ? "••••••••" : null;

    const source =
      apiKeyRow?.value ? "database" :
      process.env.DECART_API_KEY ? "environment" : "not_set";

    const response = {
      apiKeyConfigured:    !!apiKeyRow?.value || !!process.env.DECART_API_KEY,
      apiKeyMasked:        mask(apiKeyRow?.value) ?? (process.env.DECART_API_KEY ? "••••• (env var)" : null),
      secretKeyConfigured: !!secretKeyRow?.value || !!process.env.DECART_SECRET_KEY,
      secretKeyMasked:     mask(secretKeyRow?.value) ?? (process.env.DECART_SECRET_KEY ? "••••• (env var)" : null),
      source,
      updatedAt: updatedAtRow?.value ?? null,
    };
    res.json(response);
  } catch (error) {
    req.log?.warn({ error }, "Error fetching Decart credentials");
    res.status(500).json({ error: "Failed to fetch credentials" });
  }
});

router.put("/decart-credentials", requireAdmin, async (req, res) => {
  try {
    const { apiKey, secretKey } = req.body as { apiKey?: string; secretKey?: string };
    if (!apiKey?.trim() && !secretKey?.trim()) {
      res.status(400).json({ error: "Provide at least one credential to update" });
      return;
    }

    const upsert = async (key: string, value: string) => {
      await db.insert(settingsTable)
        .values({ key, value })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value } });
    };

    if (apiKey?.trim())    await upsert("decart_api_key", apiKey.trim());
    if (secretKey?.trim()) await upsert("decart_secret_key", secretKey.trim());
    const now = new Date().toISOString();
    await upsert("decart_creds_updated_at", now);

    res.json({ success: true, updatedAt: now });
  } catch (error) {
    req.log?.warn({ error }, "Error updating Decart credentials");
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save credentials" });
  }
});


// ── Sub Admin Management (main admin only) ───────────────────────────────────

router.get("/sub-admins", requireAdmin, async (_req, res) => {
  const subs = await db.select().from(usersTable)
    .where(eq((usersTable as any).isSubAdmin, 1));
  res.json(subs.map(u => ({
    id: u.id,
    email: u.email,
    username: u.username,
    membership: u.membership,
    subAdminMinutesBalance: (u as any).subAdminMinutesBalance ?? 0,
    createdAt: u.createdAt,
  })));
});

router.post("/sub-admins", requireAdmin, async (req, res) => {
  const { email, username, password } = req.body as { email?: string; username?: string; password?: string };
  if (!email || !username || !password || password.length < 8) {
    res.status(400).json({ error: "email, username, and password (min 8 chars) required" });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) { res.status(409).json({ error: "Email already in use" }); return; }
  const [newSub] = await db.insert(usersTable).values({
    email, username, passwordHash: hashPassword(password),
    membership: "active" as const,
    isAdmin: 0,
    freeSecondsRemaining: 0, // Sub admins get no free streaming credits
  } as any).returning();
  // Set isSubAdmin via direct update (Drizzle strict mode compat)
  await db.update(usersTable).set({ isAdmin: 0 } as any).where(eq(usersTable.id, newSub.id));
  await db.execute(`UPDATE users SET is_sub_admin = 1, sub_admin_minutes_balance = 0 WHERE id = ${newSub.id}`);
  // Audit
  const actingAdmin = (req as any).user;
  await db.insert(subAdminAuditTable).values({
    subAdminId: newSub.id, action: "created",
    performedBy: actingAdmin?.id ?? null,
    note: `Created by admin ${actingAdmin?.email ?? "unknown"}`,
  }).catch(() => {});
  res.status(201).json({ id: newSub.id, email: newSub.email, username: newSub.username });
});

router.put("/sub-admins/:id/minutes", requireAdmin, async (req: any, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid sub admin ID" }); return; }
  const { minutes } = req.body as { minutes?: number };
  if (!minutes || minutes < 1 || !Number.isInteger(minutes)) {
    res.status(400).json({ error: "minutes must be a positive integer" });
    return;
  }
  const result = await db.execute(
    `UPDATE users SET sub_admin_minutes_balance = sub_admin_minutes_balance + ${minutes}
     WHERE id = ${id} AND is_sub_admin = 1 RETURNING id, sub_admin_minutes_balance`
  );
  if (!result.rows?.length) { res.status(404).json({ error: "Sub admin not found" }); return; }
  await db.insert(subAdminAuditTable).values({
    subAdminId: id, action: "minutes_allocated", minutesAmount: minutes,
    performedBy: req.user?.id ?? null,
    note: `${minutes} minutes allocated by admin`,
  }).catch(() => {});
  const row = result.rows[0] as any;
  res.json({ id, subAdminMinutesBalance: row.sub_admin_minutes_balance });
});

router.post("/sub-admins/:id/suspend", requireAdmin, async (req: any, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid sub admin ID" }); return; }
  const [sub] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!sub || !(sub as any).isSubAdmin) { res.status(404).json({ error: "Sub admin not found" }); return; }
  const [updated] = await db.update(usersTable)
    .set({ membership: "suspended" as const }).where(eq(usersTable.id, id)).returning();
  await db.insert(subAdminAuditTable).values({
    subAdminId: id, action: "suspended", performedBy: req.user?.id ?? null,
    note: `Suspended by admin ${req.user?.email ?? "unknown"}`,
  }).catch(() => {});
  res.json({ id: updated.id, membership: updated.membership });
});

router.post("/sub-admins/:id/activate", requireAdmin, async (req: any, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid sub admin ID" }); return; }
  const [updated] = await db.update(usersTable)
    .set({ membership: "active" as const }).where(eq(usersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Sub admin not found" }); return; }
  res.json({ id: updated.id, membership: updated.membership });
});

router.delete("/sub-admins/:id", requireAdmin, async (req: any, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid sub admin ID" }); return; }
  const [sub] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!sub || !(sub as any).isSubAdmin) { res.status(404).json({ error: "Sub admin not found" }); return; }
  await db.execute(`UPDATE users SET is_sub_admin = 0, membership = 'suspended' WHERE id = ${id}`);
  await db.insert(subAdminAuditTable).values({
    subAdminId: id, action: "deleted", performedBy: req.user?.id ?? null,
    note: `Deleted (deactivated) by admin ${req.user?.email ?? "unknown"}`,
  }).catch(() => {});
  res.json({ message: "Sub admin removed" });
});

router.get("/sub-admin-audit", requireAdmin, async (_req, res) => {
  const rows = await db.select({
    id: subAdminAuditTable.id,
    subAdminId: subAdminAuditTable.subAdminId,
    action: subAdminAuditTable.action,
    targetUserId: subAdminAuditTable.targetUserId,
    minutesAmount: subAdminAuditTable.minutesAmount,
    note: subAdminAuditTable.note,
    performedBy: subAdminAuditTable.performedBy,
    createdAt: subAdminAuditTable.createdAt,
    subAdminEmail: usersTable.email,
    subAdminUsername: usersTable.username,
  })
    .from(subAdminAuditTable)
    .leftJoin(usersTable, eq(subAdminAuditTable.subAdminId, usersTable.id))
    .orderBy(desc(subAdminAuditTable.createdAt))
    .limit(500);
  res.json(rows);
});







// ═══════════════════════════════════════════════════════════════════════════
// DECART API KEY POOL MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

// GET /admin/decart-keys — list all keys with license key counts
router.get("/decart-keys", requireAdmin, async (_req, res) => {
  const keys = await db.select().from(decartApiKeysTable).orderBy(decartApiKeysTable.id);
  const licenseCounts = await db.select({
    keyId: licenseKeysTable.assignedDecartKeyId,
    count: sql<number>`COUNT(*)`,
  }).from(licenseKeysTable).where(isNotNull(licenseKeysTable.assignedDecartKeyId)).groupBy(licenseKeysTable.assignedDecartKeyId);
  const countMap = new Map(licenseCounts.map(c => [c.keyId, Number(c.count)]));

  res.json(keys.map(k => ({
    id: k.id,
    label: k.label,
    apiKeyPreview: k.apiKey.slice(0, 8) + "..." + k.apiKey.slice(-4),
    apiSecretPreview: k.apiSecret ? k.apiSecret.slice(0, 6) + "..." + k.apiSecret.slice(-4) : null,
    isActive: k.isActive,
    maxLicenseKeys: k.maxUsers,
    assignedLicenseKeys: countMap.get(k.id) ?? 0,
    createdAt: k.createdAt,
  })));
});

// POST /admin/decart-keys — add a new Decart API key
router.post("/decart-keys", requireAdmin, async (req, res) => {
  const { label, apiKey, apiSecret, maxUsers } = req.body;
  if (!label || !apiKey || !apiSecret) {
    res.status(400).json({ error: "label, apiKey, and apiSecret are required" });
    return;
  }

  // Inherit global credit settings so the new key starts with the same
  // configuration as all existing keys (thresholdPct, etc.)
  const [globalSettings] = await db
    .select()
    .from(decartCreditSettingsTable)
    .limit(1);
  const inheritedThresholdPct = globalSettings?.globalThresholdPct ?? 15;

  const [key] = await db.insert(decartApiKeysTable).values({
    label,
    apiKey,
    apiSecret,
    isActive: true,
    maxUsers: maxUsers ?? null,
    // Inherited from global settings
    thresholdPct: inheritedThresholdPct,
    // Explicit defaults to match existing key behaviour
    totalCreditsLoaded: 0,
    creditsBaseline: 0,
    assignmentStatus: "available",
    usageLoad: 0,
    healthStatus: "healthy",
  }).returning();
  res.status(201).json({
    id: key.id,
    label: key.label,
    apiKeyPreview: key.apiKey.slice(0, 8) + "..." + key.apiKey.slice(-4),
    apiSecretPreview: key.apiSecret ? key.apiSecret.slice(0, 6) + "..." + key.apiSecret.slice(-4) : null,
    isActive: key.isActive,
    maxLicenseKeys: key.maxUsers,
    assignedLicenseKeys: 0,
    createdAt: key.createdAt,
  });
});

// PUT /admin/decart-keys/:id — update key (label, active status, maxUsers)
router.put("/decart-keys/:id", requireAdmin, async (req, res) => {
  const keyId = parseInt(req.params["id"] as string);
  if (isNaN(keyId)) { res.status(400).json({ error: "Invalid key ID" }); return; }
  const { label, isActive, maxUsers, apiKey, apiSecret } = req.body;
  const updates: any = {};
  if (label !== undefined) updates.label = label;
  if (isActive !== undefined) updates.isActive = isActive;
  if (maxUsers !== undefined) updates.maxUsers = maxUsers;
  if (apiKey !== undefined) updates.apiKey = apiKey;
  if (apiSecret !== undefined) updates.apiSecret = apiSecret;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

  const [updated] = await db.update(decartApiKeysTable).set(updates)
    .where(eq(decartApiKeysTable.id, keyId)).returning();
  if (!updated) { res.status(404).json({ error: "Key not found" }); return; }
  res.json({ id: updated.id, label: updated.label, isActive: updated.isActive, maxUsers: updated.maxUsers });
});

// DELETE /admin/decart-keys/:id — remove a key (re-assigns its license keys to the least-loaded remaining key)
router.delete("/decart-keys/:id", requireAdmin, async (req, res) => {
  const keyId = parseInt(req.params["id"] as string);
  if (isNaN(keyId)) { res.status(400).json({ error: "Invalid key ID" }); return; }

  try {
    // Find an alternative active key to re-assign orphaned license keys
    const altKeys = await db.select({ id: decartApiKeysTable.id })
      .from(decartApiKeysTable)
      .where(and(eq(decartApiKeysTable.isActive, true), sql`${decartApiKeysTable.id} != ${keyId}`))
      .limit(1);
    const newKeyId = altKeys.length > 0 ? altKeys[0]!.id : null;

    // Re-assign license keys that were using the deleted Decart key
    await db.update(licenseKeysTable)
      .set({ assignedDecartKeyId: newKeyId })
      .where(eq(licenseKeysTable.assignedDecartKeyId, keyId));

    // Delete the key
    await db.delete(decartApiKeysTable).where(eq(decartApiKeysTable.id, keyId));

    const reassigned = await db.select({ count: sql<number>`COUNT(*)` })
      .from(licenseKeysTable)
      .where(eq(licenseKeysTable.assignedDecartKeyId, newKeyId ?? -1));

    res.json({ deleted: true, usersReassignedTo: newKeyId, reassignedCount: Number(reassigned[0]?.count ?? 0) });
  } catch (err: any) {
    console.error("[admin] DELETE /decart-keys error:", err);
    res.status(500).json({ error: "Failed to delete API key. Please try again." });
  }
});



// ── Section-Level Pricing Visibility Controls ───────────────────────────

// GET /admin/pricing-settings — returns which package sections are visible per user type
router.get("/pricing-settings", requireAdmin, async (_req, res) => {
  const settings = await db.select().from(settingsTable);
  const get = (key: string) => settings.find(s => s.key === key)?.value ?? "true";
  res.json({
    userMonthlyEnabled: get("user_monthly_enabled") === "true",
    subadminTopupEnabled: get("subadmin_topup_enabled") === "true",
  });
});

// PUT /admin/pricing-settings — update which package sections are visible per user type
router.put("/pricing-settings", requireAdmin, async (req, res) => {
  const { userMonthlyEnabled, subadminTopupEnabled } = req.body as {
    userMonthlyEnabled?: boolean;
    subadminTopupEnabled?: boolean;
  };
  const updates: Array<{ key: string; value: string }> = [];
  if (typeof userMonthlyEnabled === "boolean")
    updates.push({ key: "user_monthly_enabled", value: String(userMonthlyEnabled) });
  if (typeof subadminTopupEnabled === "boolean")
    updates.push({ key: "subadmin_topup_enabled", value: String(subadminTopupEnabled) });
  for (const { key, value } of updates) {
    await db
      .insert(settingsTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value } });
  }
  res.json({ success: true, updated: updates.map(u => u.key) });
});



// GET /admin/exchange-rates — live conversion rates for pricing calculator
router.get("/exchange-rates", requireAdmin, async (_req, res) => {
  try {
    const rates = await getAllRates();
    res.json(rates);
  } catch (err) {
    console.error("[exchange-rates] Error:", err);
    res.status(500).json({ error: "Failed to fetch rates" });
  }
});

// ── Sub-Admin Pricing CRUD ───────────────────────────────────────────────────

// GET /admin/sub-admin-pricing — list all sub-admin pricing tiers
router.get("/sub-admin-pricing", requireAdmin, async (_req, res) => {
  const tiers = await db.select().from(subAdminPricingTable).orderBy(subAdminPricingTable.minutes);
  res.json(tiers.map(t => ({
    ...t,
    priceUsdt: parseFloat(t.priceUsdt),
    priceUsd: parseFloat((t as any).priceUsd ?? t.priceUsdt),
    priceGhs: parseFloat((t as any).priceGhs ?? "0"),
    credits: (t as any).credits ?? 0,
  })));
});

// POST /admin/sub-admin-pricing — create a sub-admin pricing tier
router.post("/sub-admin-pricing", requireAdmin, async (req, res) => {
  const { minutes, credits, priceUsd, priceUsdt, priceGhs, label, planType, isActive } = req.body;
  if (!minutes || !priceUsdt || !label) {
    return res.status(400).json({ error: "minutes, priceUsdt, and label are required" });
  }
  const [tier] = await db.insert(subAdminPricingTable).values({
    minutes, credits: credits ?? 0, priceUsd: priceUsd ?? priceUsdt,
    priceUsdt, priceGhs: priceGhs ?? "0", label, planType: planType ?? "topup",
    isActive: isActive ?? true,
  } as any).returning();
  return res.json(tier);
});

// PUT /admin/sub-admin-pricing/:id — update a sub-admin pricing tier
router.put("/sub-admin-pricing/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const { minutes, credits, priceUsd, priceUsdt, priceGhs, label, planType, isActive } = req.body;
  await db.update(subAdminPricingTable).set({
    ...(minutes !== undefined && { minutes }),
    ...(credits !== undefined && { credits }),
    ...(priceUsd !== undefined && { priceUsd }),
    ...(priceUsdt !== undefined && { priceUsdt }),
    ...(priceGhs !== undefined && { priceGhs }),
    ...(label !== undefined && { label }),
    ...(planType !== undefined && { planType }),
    ...(isActive !== undefined && { isActive }),
  } as any).where(eq(subAdminPricingTable.id, id));
  return res.json({ success: true });
});

// DELETE /admin/sub-admin-pricing/:id — delete a sub-admin pricing tier
router.delete("/sub-admin-pricing/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  await db.delete(subAdminPricingTable).where(eq(subAdminPricingTable.id, id));
  return res.json({ success: true });
});


// ── License Modal Message Settings ──────────────────────────────────────────

// GET /admin/license-message — get the current license modal message
router.get("/license-message", requireAdmin, async (_req, res) => {
  const allSettings = await db.select().from(settingsTable);
  const getMessage = (key: string) => allSettings.find(s => s.key === key)?.value ?? null;
  res.json({
    title: getMessage("license_modal_title") ?? "License Required to Continue",
    message: getMessage("license_modal_message") ?? "Purchase a License Key to activate your software.",
    contactInfo: getMessage("license_modal_contact") ?? "For assistance, contact us via Telegram: @rich_life2k15 or Email: loveoflots06@gmail.com",
    footerText: getMessage("license_modal_footer") ?? "License is bound to this device. 1 license per machine.",
  });
});

// PUT /admin/license-message — update the license modal message
router.put("/license-message", requireAdmin, async (req, res) => {
  const { title, message, contactInfo, footerText } = req.body as {
    title?: string; message?: string; contactInfo?: string; footerText?: string;
  };
  const updates: Record<string, string> = {};
  if (title !== undefined) updates["license_modal_title"] = title;
  if (message !== undefined) updates["license_modal_message"] = message;
  if (contactInfo !== undefined) updates["license_modal_contact"] = contactInfo;
  if (footerText !== undefined) updates["license_modal_footer"] = footerText;
  
  for (const [key, value] of Object.entries(updates)) {
    const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
    if (existing.length > 0) {
      await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key));
    } else {
      await db.insert(settingsTable).values({ key, value });
    }
  }
  res.json({ success: true, updated: Object.keys(updates) });
});

// GET /admin/license-message/public — public endpoint (no auth) for Electron to fetch message
router.get("/license-message/public", async (_req, res) => {
  const allSettings = await db.select().from(settingsTable);
  const getMessage = (key: string) => allSettings.find(s => s.key === key)?.value ?? null;
  res.json({
    title: getMessage("license_modal_title") ?? "License Required to Continue",
    message: getMessage("license_modal_message") ?? "Purchase a License Key to activate your software.",
    contactInfo: getMessage("license_modal_contact") ?? "For assistance, contact us via Telegram: @rich_life2k15 or Email: loveoflots06@gmail.com",
    footerText: getMessage("license_modal_footer") ?? "License is bound to this device. 1 license per machine.",
  });
});


// ── Usage Analytics & Session Audit ──────────────────────────────────────────

// GET /admin/usage-analytics — aggregate usage stats
router.get("/usage-analytics", requireAdmin, async (_req, res) => {
  try {
    const stats = await db.execute(`
      SELECT
        COUNT(DISTINCT s.user_id) AS active_users,
        COUNT(s.id) AS total_sessions,
        COALESCE(SUM(s.duration_seconds), 0) AS total_seconds_streamed,
        COALESCE(AVG(s.duration_seconds), 0) AS avg_session_seconds,
        (SELECT COUNT(*) FROM users WHERE is_admin = 0 AND is_sub_admin = 0) AS total_users,
        (SELECT COUNT(*) FROM license_keys WHERE is_active = true) AS active_license_keys,
        (SELECT COUNT(*) FROM license_keys WHERE minutes_credited = true) AS redeemed_keys
      FROM sessions s
      WHERE s.started_at > NOW() - INTERVAL '30 days'
    `);
    const row = stats.rows[0] as any;
    res.json({
      activeUsers: parseInt(row.active_users ?? "0"),
      totalSessions: parseInt(row.total_sessions ?? "0"),
      totalMinutesStreamed: Math.round(parseInt(row.total_seconds_streamed ?? "0") / 60),
      avgSessionMinutes: Math.round(parseInt(row.avg_session_seconds ?? "0") / 60),
      totalUsers: parseInt(row.total_users ?? "0"),
      activeLicenseKeys: parseInt(row.active_license_keys ?? "0"),
      redeemedKeys: parseInt(row.redeemed_keys ?? "0"),
    });
  } catch (err) {
    console.error("[usage-analytics]", err);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// GET /admin/session-audit — detailed session logs with user info
router.get("/session-audit", requireAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const userId = req.query.userId ? parseInt(req.query.userId as string) : null;
  
  try {
    let query = `
      SELECT s.id, s.user_id, u.email, u.username, s.status, s.style,
             s.started_at, s.stopped_at, s.duration_seconds, s.package_label,
             s.last_heartbeat_at, s.billing_started_at
      FROM sessions s
      INNER JOIN users u ON s.user_id = u.id
    `;
    if (userId) query += ` WHERE s.user_id = ${userId}`;
    query += ` ORDER BY s.started_at DESC LIMIT ${limit}`;
    
    const result = await db.execute(query);
    res.json(result.rows.map((r: any) => ({
      id: r.id, userId: r.user_id, email: r.email, username: r.username,
      status: r.status, style: r.style,
      startedAt: r.started_at, stoppedAt: r.stopped_at,
      durationSeconds: r.duration_seconds,
      durationFormatted: r.duration_seconds
        ? `${Math.floor(r.duration_seconds / 60)}m ${r.duration_seconds % 60}s`
        : null,
      packageLabel: r.package_label,
      lastHeartbeatAt: r.last_heartbeat_at,
      billingStartedAt: r.billing_started_at,
    })));
  } catch (err) {
    console.error("[session-audit]", err);
    res.status(500).json({ error: "Failed to fetch session audit" });
  }
});

// GET /admin/user-usage/:userId — per-user usage breakdown
router.get("/user-usage/:userId", requireAdmin, async (req, res) => {
  const userId = parseInt(req.params["userId"] as string);
  if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });
  
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "User not found" });
    
    const sessions = await db.execute(`
      SELECT id, status, style, started_at, stopped_at, duration_seconds, package_label
      FROM sessions WHERE user_id = ${userId}
      ORDER BY started_at DESC LIMIT 50
    `);
    
    const totalSeconds = await db.execute(
      `SELECT COALESCE(SUM(duration_seconds), 0) as total FROM sessions WHERE user_id = ${userId}`
    );
    
    return res.json({
      user: {
        id: user.id, email: user.email, username: user.username,
        totalMinutesPurchased: user.totalMinutesPurchased,
        totalSecondsUsed: user.totalSecondsUsed,
        freeSecondsRemaining: user.freeSecondsRemaining,
        remainingMinutes: Math.max(0, Math.floor(
          ((user.totalMinutesPurchased * 60) - user.totalSecondsUsed + user.freeSecondsRemaining) / 60
        )),
      },
      totalSessionMinutes: Math.round(parseInt((totalSeconds.rows[0] as any).total) / 60),
      sessionCount: sessions.rows.length,
      sessions: sessions.rows.map((r: any) => ({
        id: r.id, status: r.status, style: r.style,
        startedAt: r.started_at, stoppedAt: r.stopped_at,
        durationSeconds: r.duration_seconds,
        durationFormatted: r.duration_seconds
          ? `${Math.floor(r.duration_seconds / 60)}m ${r.duration_seconds % 60}s` : null,
        packageLabel: r.package_label,
      })),
    });
  } catch (err) {
    console.error("[user-usage]", err);
    return res.status(500).json({ error: "Failed to fetch user usage" });
  }
});

// POST /admin/users/:userId/adjust-credits — admin adjusts user credits
router.post("/users/:userId/adjust-credits", requireAdmin, async (req, res) => {
  const userId = parseInt(req.params["userId"] as string);
  const { minutes, reason } = req.body as { minutes?: number; reason?: string };
  
  if (!minutes || !Number.isInteger(minutes)) {
    return res.status(400).json({ error: "minutes must be an integer (positive to add, negative to deduct)" });
  }
  
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return res.status(404).json({ error: "User not found" });
  
  const newTotal = Math.max(0, user.totalMinutesPurchased + minutes);
  await db.update(usersTable)
    .set({ totalMinutesPurchased: newTotal, membership: "active" as const })
    .where(eq(usersTable.id, userId));
  
  return res.json({
    success: true,
    userId,
    previousMinutes: user.totalMinutesPurchased,
    adjustedBy: minutes,
    newTotal,
    reason: reason || `Admin adjusted by ${minutes} minutes`,
  });
});

router.get("/license-keys", requireAdmin, async (_req, res) => {
  try {
    const licenses = await db.select({
      id: licenseKeysTable.id,
      key: licenseKeysTable.key,
      isActive: licenseKeysTable.isActive,
      activatedAt: licenseKeysTable.activatedAt,
      expiresAt: licenseKeysTable.expiresAt,
      minutesAllocated: licenseKeysTable.minutesAllocated,
      usedSeconds: licenseKeysTable.usedSeconds,
      deviceId: licenseKeysTable.deviceId,
      notes: licenseKeysTable.notes,
      createdAt: licenseKeysTable.createdAt,
    }).from(licenseKeysTable).orderBy(desc(licenseKeysTable.createdAt));

    const result = licenses.map(l => ({
      id: l.id,
      key: l.key,
      isActive: l.isActive,
      activatedAt: l.activatedAt,
      expiresAt: l.expiresAt,
      minutesAllocated: l.minutesAllocated,
      minutesUsed: Math.round((l.usedSeconds / 60) * 100) / 100,
      minutesRemaining: Math.max(0, Math.round((((l.minutesAllocated ?? 0) * 60 - (l.usedSeconds ?? 0)) / 60) * 100) / 100),
      deviceId: l.deviceId,
      notes: l.notes,
      createdAt: l.createdAt,
    }));

    res.json(result);
  } catch (err) {
    console.error("Failed to fetch license keys:", err);
    res.status(500).json({ error: "Failed to fetch license keys" });
  }
});

router.get("/license-keys/active-streaming", requireAdmin, async (_req, res) => {
  try {
    const activeLicenses = await db.select({
      id: licenseKeysTable.id,
      key: licenseKeysTable.key,
      isActive: licenseKeysTable.isActive,
      activatedAt: licenseKeysTable.activatedAt,
      minutesAllocated: licenseKeysTable.minutesAllocated,
      usedSeconds: licenseKeysTable.usedSeconds,
      sessionId: sessionsTable.id,
      sessionStyle: sessionsTable.style,
      sessionStartedAt: sessionsTable.startedAt,
    }).from(licenseKeysTable)
      .innerJoin(sessionsTable, eq(licenseKeysTable.id, sessionsTable.licenseKeyId))
      .where(eq(sessionsTable.status, "active"))
      .orderBy(desc(sessionsTable.startedAt));

    const result = activeLicenses.map(l => ({
      id: l.id,
      key: l.key,
      isActive: l.isActive,
      activatedAt: l.activatedAt,
      minutesAllocated: l.minutesAllocated,
      minutesUsed: Math.round((l.usedSeconds / 60) * 100) / 100,
      minutesRemaining: Math.max(0, Math.round((((l.minutesAllocated ?? 0) * 60 - (l.usedSeconds ?? 0)) / 60) * 100) / 100),
      sessionId: l.sessionId,
      style: l.sessionStyle ?? "natural",
      startedAt: l.sessionStartedAt,
    }));

    res.json({
      count: result.length,
      sessions: result,
    });
  } catch (err) {
    console.error("Failed to fetch active license sessions:", err);
    res.status(500).json({ error: "Failed to fetch active license sessions" });
  }
});

router.patch("/license-keys/:keyId", requireAdmin, async (req, res) => {
  try {
    const { keyId } = req.params;
    const { minutesAllocated, isActive, expiresAt, notes } = req.body;

    const updates: any = {};
    if (minutesAllocated !== undefined) updates.minutesAllocated = minutesAllocated;
    if (isActive !== undefined) updates.isActive = isActive;
    if (expiresAt !== undefined) updates.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (notes !== undefined) updates.notes = notes;

    await db.update(licenseKeysTable)
      .set(updates)
      .where(eq(licenseKeysTable.id, parseInt(keyId as string)));

    res.json({ success: true });
  } catch (err) {
    console.error("Failed to update license key:", err);
    res.status(500).json({ error: "Failed to update license key" });
  }
});

router.delete("/license-keys/:keyId", requireAdmin, async (req, res) => {
  try {
    const { keyId } = req.params;
    await db.delete(licenseKeysTable).where(eq(licenseKeysTable.id, parseInt(keyId as string)));
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to delete license key:", err);
    res.status(500).json({ error: "Failed to delete license key" });
  }
});

router.post("/license-keys/:keyId/credit", requireAdmin, async (req, res) => {
  try {
    const { keyId } = req.params;
    const { minutes } = req.body;

    if (!minutes || minutes < 1) {
      res.status(400).json({ error: "Minutes must be at least 1" });
      return;
    }

    const [license] = await db.select().from(licenseKeysTable).where(eq(licenseKeysTable.id, parseInt(keyId as string)));
    if (!license) {
      res.status(404).json({ error: "License key not found" });
      return;
    }

    const newMinutesAllocated = license.minutesAllocated + minutes;
    await db.update(licenseKeysTable)
      .set({ minutesAllocated: newMinutesAllocated })
      .where(eq(licenseKeysTable.id, parseInt(keyId as string)));

    res.json({
      success: true,
      previousMinutes: license.minutesAllocated,
      creditedMinutes: minutes,
      newTotal: newMinutesAllocated,
    });
  } catch (err) {
    console.error("Failed to credit license key:", err);
    res.status(500).json({ error: "Failed to credit license key" });
  }
});

router.post("/license-keys/:sessionId/terminate", requireAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const sessionIdStr = sessionId as string;
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionIdStr));
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    await db.update(sessionsTable)
      .set({
        status: "stopped",
        stoppedAt: new Date(),
        durationSeconds: Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000),
      })
      .where(eq(sessionsTable.id, sessionIdStr));

    res.json({ success: true });
  } catch (err) {
    console.error("Failed to terminate session:", err);
    res.status(500).json({ error: "Failed to terminate session" });
  }
});

// GET /api/admin/analytics/summary -- financial analytics dashboard summary
router.get("/analytics/summary", requireAdmin, async (req, res) => {
  try {
    // Total Revenue (sum of all revenue_usd from financial transactions)
    const [totalRevenueRow] = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(revenue_usd AS DECIMAL)), 0)`,
    }).from(financialTransactionsTable);
    const totalRevenue = parseFloat(totalRevenueRow?.total ?? "0");

    // Total API Cost
    const [totalApiCostRow] = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(api_cost_usd AS DECIMAL)), 0)`,
    }).from(financialTransactionsTable);
    const totalApiCost = parseFloat(totalApiCostRow?.total ?? "0");

    // Total Profit (sum of profit_usd where is_loss = false)
    const [totalProfitRow] = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(profit_usd AS DECIMAL)), 0)`,
    }).from(financialTransactionsTable).where(eq(financialTransactionsTable.isLoss, false));
    const totalProfit = parseFloat(totalProfitRow?.total ?? "0");

    // Total Loss (sum of profit_usd where is_loss = true, as absolute value)
    const [totalLossRow] = await db.select({
      total: sql<string>`COALESCE(SUM(ABS(CAST(profit_usd AS DECIMAL))), 0)`,
    }).from(financialTransactionsTable).where(eq(financialTransactionsTable.isLoss, true));
    const totalLoss = parseFloat(totalLossRow?.total ?? "0");

    // Net Earnings (total profit - total loss)
    const netEarnings = totalRevenue - totalApiCost;

    // Total Licenses Generated (count where transaction_type = 'new_license')
    const [totalLicensesRow] = await db.select({
      count: sql<number>`COUNT(*)`,
    }).from(financialTransactionsTable).where(eq(financialTransactionsTable.transactionType, "new_license"));
    const totalLicenses = Number(totalLicensesRow?.count ?? 0);

    // Total Renewals (count where transaction_type = 'renewal')
    const [totalRenewalsRow] = await db.select({
      count: sql<number>`COUNT(*)`,
    }).from(financialTransactionsTable).where(eq(financialTransactionsTable.transactionType, "renewal"));
    const totalRenewals = Number(totalRenewalsRow?.count ?? 0);

    res.json({
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      totalLoss: Math.round(totalLoss * 100) / 100,
      netEarnings: Math.round(netEarnings * 100) / 100,
      totalApiCost: Math.round(totalApiCost * 100) / 100,
      totalLicenses,
      totalRenewals,
    });
  } catch (err) {
    console.error("[admin:analytics:summary]", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/admin/analytics/transactions -- financial transaction ledger with pagination
router.get("/analytics/transactions", requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 25);
    const offset = (page - 1) * limit;

    // Fetch transactions with total count
    const transactions = await db.select().from(financialTransactionsTable)
      .orderBy(desc(financialTransactionsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [countRow] = await db.select({
      count: sql<number>`COUNT(*)`,
    }).from(financialTransactionsTable);
    const totalCount = Number(countRow?.count ?? 0);

    const formattedTransactions = transactions.map(t => ({
      id: t.id,
      licenseKey: t.licenseKey,
      transactionType: t.transactionType,
      packageLabel: t.packageLabel,
      minutesAllocated: t.minutesAllocated,
      packagePrice: Math.round(parseFloat(t.revenueUsd) * 100) / 100,
      apiCost: Math.round(parseFloat(t.apiCostUsd) * 100) / 100,
      profitLoss: Math.round(parseFloat(t.profitUsd) * 100) / 100,
      isLoss: t.isLoss,
      createdAt: t.createdAt.toISOString(),
    }));

    res.json({
      transactions: formattedTransactions,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (err) {
    console.error("[admin:analytics:transactions]", err);
    res.status(500).json({ error: "Server error" });
  }
});


// GET /api/admin/analytics/per-key -- per-license-key breakdown for tracking
router.get("/analytics/per-key", requireAdmin, async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        lk.id,
        lk.key,
        lk.minutes_allocated,
        lk.used_seconds,
        lk.is_active,
        lk.created_at,
        lk.last_used_at,
        COUNT(s.id)::int                          AS session_count,
        COALESCE(SUM(s.duration_seconds), 0)::int AS total_stream_seconds,
        COALESCE(ft.revenue_usd, 0)               AS revenue_usd
      FROM license_keys lk
      LEFT JOIN sessions s ON s.license_key_id = lk.id
      LEFT JOIN (
        SELECT license_key, SUM(CAST(revenue_usd AS DECIMAL)) AS revenue_usd
        FROM financial_transactions
        GROUP BY license_key
      ) ft ON ft.license_key = lk.key
      GROUP BY lk.id, lk.key, lk.minutes_allocated, lk.used_seconds,
               lk.is_active, lk.created_at, lk.last_used_at, ft.revenue_usd
      ORDER BY lk.created_at DESC
    `);

    const keys = (result.rows as any[]).map((r: any) => ({
      id:               Number(r.id),
      key:              r.key as string,
      minutesAllocated: parseFloat(r.minutes_allocated ?? "0"),
      minutesUsed:      Math.round((Number(r.used_seconds ?? 0) / 60) * 100) / 100,
      minutesRemaining: Math.max(0, Math.round(((parseFloat(r.minutes_allocated ?? "0") * 60 - Number(r.used_seconds ?? 0)) / 60) * 100) / 100),
      sessionCount:     Number(r.session_count ?? 0),
      totalStreamMinutes: Math.round((Number(r.total_stream_seconds ?? 0) / 60) * 100) / 100,
      revenueUsd:       Math.round(parseFloat(r.revenue_usd ?? "0") * 100) / 100,
      isActive:         Boolean(r.is_active),
      lastUsedAt:       r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
      createdAt:        new Date(r.created_at).toISOString(),
    }));

    const totals = {
      totalMinutesAllocated: Math.round(keys.reduce((s, k) => s + k.minutesAllocated, 0) * 100) / 100,
      totalMinutesUsed:      Math.round(keys.reduce((s, k) => s + k.minutesUsed, 0) * 100) / 100,
      totalStreamMinutes:    Math.round(keys.reduce((s, k) => s + k.totalStreamMinutes, 0) * 100) / 100,
      totalSessions:         keys.reduce((s, k) => s + k.sessionCount, 0),
      totalRevenueUsd:       Math.round(keys.reduce((s, k) => s + k.revenueUsd, 0) * 100) / 100,
    };

    res.json({ keys, totals });
  } catch (err) {
    console.error("[admin:analytics:per-key]", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  DECART CREDIT TRACKING ENDPOINTS
// ─────────────────────────────────────────────────────────────

/** GET /api/admin/decart-keys/credit-status */
router.get("/decart-keys/credit-status", requireAdmin, async (req, res) => {
  try {
    const [settings] = await db.select().from(decartCreditSettingsTable).where(eq(decartCreditSettingsTable.id, 1)).limit(1);
    const globalPct = settings?.globalThresholdPct ?? 15;
    const useGlobal = settings?.useGlobalThreshold ?? false;
    const statuses = await getAllKeysCreditStatus(globalPct, useGlobal);
    res.json({ keys: statuses, globalSettings: { globalThresholdPct: globalPct, useGlobalThreshold: useGlobal } });
  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve credit status" });
  }
});

/** POST /api/admin/decart-keys/:id/topup */
router.post("/decart-keys/:id/topup", requireAdmin, async (req, res) => {
  const keyId = parseInt(req.params["id"] as string);
  const { credits } = req.body as { credits: number };
  if (!credits || isNaN(credits) || credits <= 0) { res.status(400).json({ error: "credits must be a positive number" }); return; }
  try {
    const result = await recordTopup(keyId, credits);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to record top-up" });
  }
});

/** POST /api/admin/decart-keys/:id/topup-delta
 *  Adds deltaCredits on top of the current tracked remaining balance, then resets
 *  the baseline. The computation and write are performed inside a single DB
 *  transaction to minimise timing drift when sessions are actively consuming credits.
 */
router.post("/decart-keys/:id/topup-delta", requireAdmin, async (req, res) => {
  const keyId = parseInt(req.params["id"] as string);
  const { deltaCredits } = req.body as { deltaCredits: number };
  if (!deltaCredits || isNaN(deltaCredits) || deltaCredits <= 0) {
    res.status(400).json({ error: "deltaCredits must be a positive number" });
    return;
  }
  try {
    const result = await recordTopupDelta(keyId, deltaCredits);
    res.json({ success: true, ...result });
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      res.status(404).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err.message ?? "Failed to record top-up" });
  }
});

/** PUT /api/admin/decart-keys/:id/threshold */
router.put("/decart-keys/:id/threshold", requireAdmin, async (req, res) => {
  const keyId = parseInt(req.params["id"] as string);
  const { thresholdPct } = req.body as { thresholdPct: number };
  if (thresholdPct === undefined || thresholdPct < 0 || thresholdPct > 100) { res.status(400).json({ error: "thresholdPct must be 0-100" }); return; }
  try {
    await db.update(decartApiKeysTable).set({ thresholdPct, updatedAt: new Date() }).where(eq(decartApiKeysTable.id, keyId));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Failed to update threshold" }); }
});

/** GET /api/admin/decart-keys/:id/usage-history */
router.get("/decart-keys/:id/usage-history", requireAdmin, async (req, res) => {
  const keyId = parseInt(req.params["id"] as string);
  const limit = Math.min(parseInt((req.query.limit as string) ?? "50"), 200);
  try {
    const history = await getKeyUsageHistory(keyId, limit);
    res.json(history);
  } catch (err) { res.status(500).json({ error: "Failed to retrieve usage history" }); }
});

/** GET /api/admin/decart-credit-settings */
router.get("/decart-credit-settings", requireAdmin, async (req, res) => {
  try {
    const [settings] = await db.select().from(decartCreditSettingsTable).limit(1);
    res.json(settings ?? { globalThresholdPct: 15, useGlobalThreshold: false });
  } catch (err) { res.status(500).json({ error: "Failed to get settings" }); }
});

/** PUT /api/admin/decart-credit-settings */
router.put("/decart-credit-settings", requireAdmin, async (req, res) => {
  const { globalThresholdPct, useGlobalThreshold } = req.body as { globalThresholdPct?: number; useGlobalThreshold?: boolean };
  try {
    await db.update(decartCreditSettingsTable).set({
      ...(globalThresholdPct !== undefined && { globalThresholdPct }),
      ...(useGlobalThreshold !== undefined && { useGlobalThreshold }),
      updatedAt: new Date(),
    }).where(eq(decartCreditSettingsTable.id, 1));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Failed to update global settings" }); }
});

// ── Billing rate control ──────────────────────────────────────────────────────

/** GET /api/admin/billing-rate */
router.get("/billing-rate", async (_req, res) => {
  try {
    const rate = await getBillingRate();

    // Live burn monitor fields (spec §3, §4 — read-only, no billing logic)
    const burnMultiplier     = Math.round((rate / BASE_BILLING_RATE) * 1000) / 1000;
    const liveBurnSpeed      = rate / 2;            // seconds consumed per real second (heartbeat formula)
    const realStreamMinutes  = Math.round((120 / rate) * 10) / 10; // real streaming mins per licence hour

    let burnPreviewText: string;
    if (liveBurnSpeed === 1) {
      burnPreviewText = `At rate ${rate}: licence depletes 1:1 with real time (60 min licence = 60 min streaming)`;
    } else if (liveBurnSpeed > 1) {
      burnPreviewText = `At rate ${rate}: 60 min licence lasts ~${realStreamMinutes} min of real streaming (${liveBurnSpeed}× depletion)`;
    } else {
      burnPreviewText = `At rate ${rate}: 60 min licence lasts ~${realStreamMinutes} min of real streaming (slower than real-time)`;
    }

    res.json({
      rate,
      defaultRate:      DECART_CREDITS_PER_SEC,
      baseRate:         BASE_BILLING_RATE,
      burnMultiplier,
      liveBurnSpeed,
      realStreamMinutesPerLicenseHour: realStreamMinutes,
      burnPreview:      burnPreviewText,
    });
  } catch {
    res.status(500).json({ error: "Failed to load billing rate" });
  }
});

/** PUT /api/admin/billing-rate */
router.put("/billing-rate", requireAdmin, async (req: any, res) => {
  const raw  = req.body?.rate;
  const rate = typeof raw === "number" ? raw : parseInt(raw, 10);
  if (!Number.isFinite(rate) || rate < 1 || rate > 100) {
    res.status(400).json({ error: "Rate must be a whole number between 1 and 100" });
    return;
  }
  try {
    // Read current rate for audit log
    const [prevRow] = await db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, "billing_credits_per_sec"));
    const prevParsed = prevRow ? parseInt(prevRow.value, 10) : NaN;
    const previousRate = Number.isFinite(prevParsed) && prevParsed >= 1 ? prevParsed : DECART_CREDITS_PER_SEC;

    await db.insert(settingsTable)
      .values({ key: "billing_credits_per_sec", value: String(rate) })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: String(rate) } });

    invalidateBillingRateCache();

    // Record audit log (non-fatal if it fails)
    const actor = req.user as { id?: number; email?: string } | undefined;
    await db.insert(billingRateAuditTable).values({
      previousRate,
      newRate: rate,
      changedBy: actor?.id ?? null,
      changedByEmail: actor?.email ?? null,
      note: `Changed from ${previousRate} to ${rate} cr/s`,
    }).catch(() => { /* non-fatal */ });

    // Push live update to all connected admin dashboard clients (read-only observability)
    emitBillingRateChanged(previousRate, rate, actor?.email ?? null);

    // SPEC §4 MANDATORY: Re-fetch from DB to confirm the saved value matches.
    // Never return the input rate — return the DB-verified rate only.
    const confirmedRate = await getBillingRate();
    res.json({ ok: true, rate: confirmedRate });
  } catch (err) {
    res.status(500).json({ error: "Failed to save billing rate" });
  }
});

/** GET /api/admin/billing-rate/audit — billing rate change history */
router.get("/billing-rate/audit", requireAdmin, async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(billingRateAuditTable)
      .orderBy(desc(billingRateAuditTable.createdAt))
      .limit(200);
    res.json(rows.map(r => ({
      id: r.id,
      previousRate: r.previousRate,
      newRate: r.newRate,
      changedBy: r.changedBy,
      changedByEmail: r.changedByEmail,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to load billing rate audit log" });
  }
});

export default router;
