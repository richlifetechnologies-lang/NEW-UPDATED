import { Router } from "express";
import { requireSubAdmin, hashPassword } from "../lib/auth";
import { db, usersTable, sessionsTable, settingsTable, subAdminAuditTable, invoicesTable, pricingTable, subAdminPricingTable } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { usdToUsdt } from "../lib/rates";

const router = Router();

// GET /subadmin/me — profile + both minute balances
router.get("/me", requireSubAdmin, async (req, res) => {
  const user = (req as any).user;
  const result = await db.execute(`SELECT sub_admin_minutes_balance, total_minutes_purchased FROM users WHERE id = ${user.id}`);
  const row = result.rows[0] as any;
  res.json({
    id: user.id, email: user.email, username: user.username, membership: user.membership,
    subAdminMinutesBalance: row?.sub_admin_minutes_balance ?? 0,
    totalMinutesPurchased: row?.total_minutes_purchased ?? 0,
  });
});

// GET /subadmin/active-sessions — only sessions for users THIS sub admin created
router.get("/active-sessions", requireSubAdmin, async (req, res) => {
  const subAdmin = (req as any).user;
  const result = await db.execute(`
    SELECT s.id, s.user_id, u.username, u.email, s.style, s.started_at
    FROM sessions s
    INNER JOIN users u ON s.user_id = u.id
    WHERE s.status = 'active' AND u.created_by_sub_admin_id = ${subAdmin.id}
    ORDER BY s.started_at DESC
  `);
  const sessions = result.rows.map((r: any) => ({
    id: r.id, userId: r.user_id, username: r.username,
    email: r.email, style: r.style, startedAt: r.started_at,
  }));
  res.json({ count: sessions.length, sessions });
});

// GET /subadmin/recent-activity — sessions + users for THIS sub admin only
router.get("/recent-activity", requireSubAdmin, async (req, res) => {
  const subAdmin = (req as any).user;
  const sessResult = await db.execute(`
    SELECT s.id, s.user_id, u.username, s.status, s.started_at, s.stopped_at, s.duration_seconds, s.style
    FROM sessions s
    INNER JOIN users u ON s.user_id = u.id
    WHERE u.created_by_sub_admin_id = ${subAdmin.id}
    ORDER BY s.started_at DESC LIMIT 20
  `);
  const recentSessions = sessResult.rows.map((r: any) => ({
    id: r.id, userId: r.user_id, username: r.username,
    status: r.status, startedAt: r.started_at, stoppedAt: r.stopped_at,
    durationSeconds: r.duration_seconds, style: r.style,
  }));
  const userResult = await db.execute(`
    SELECT id, username, email, created_at FROM users
    WHERE created_by_sub_admin_id = ${subAdmin.id}
    ORDER BY created_at DESC LIMIT 10
  `);
  const recentUsers = userResult.rows.map((r: any) => ({
    id: r.id, username: r.username, email: r.email, createdAt: r.created_at,
  }));
  res.json({ recentSessions, recentUsers });
});

// GET /subadmin/users/search?email= — search user by email (only sub admin's users)
router.get("/users/search", requireSubAdmin, async (req, res) => {
  const subAdmin = (req as any).user;
  const email = (req.query.email as string)?.trim().toLowerCase();
  if (!email) { res.status(400).json({ error: "email query param required" }); return; }
  const result = await db.execute(`
    SELECT id, email, username, membership, total_minutes_purchased,
           total_seconds_used::numeric / 60 AS total_minutes_used,
           free_seconds_remaining, created_at
    FROM users WHERE email = '${email.replace(/'/g, "''")}'
      AND created_by_sub_admin_id = ${subAdmin.id}
    LIMIT 1
  `);
  if (!result.rows.length) { res.status(404).json({ error: "No user found with that email in your accounts" }); return; }
  const r = result.rows[0] as any;
  res.json({
    id: r.id, email: r.email, username: r.username, membership: r.membership,
    totalMinutesPurchased: r.total_minutes_purchased,
    totalMinutesUsed: Number(r.total_minutes_used ?? 0),
    freeSecondsRemaining: r.free_seconds_remaining,
    createdAt: r.created_at,
  });
});

// POST /subadmin/users/:userId/credit — deducts from combined balance (allocated + purchased)
router.post("/users/:userId/credit", requireSubAdmin, async (req, res) => {
  const subAdmin = (req as any).user;
  const userId = parseInt(req.params["userId"] as string);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
  const { minutes, note } = req.body as { minutes?: number; note?: string };
  if (!minutes || minutes < 1 || !Number.isInteger(minutes)) {
    res.status(400).json({ error: "minutes must be a positive integer" }); return;
  }
  // Combined balance: admin-allocated + self-purchased
  const balResult = await db.execute(
    `SELECT sub_admin_minutes_balance, total_minutes_purchased FROM users WHERE id = ${subAdmin.id}`
  );
  const row = balResult.rows[0] as any;
  const allocated  = row?.sub_admin_minutes_balance ?? 0;
  const purchased  = row?.total_minutes_purchased    ?? 0;
  const totalAvail = allocated + purchased;
  if (totalAvail < minutes) {
    res.status(400).json({ error: `Insufficient balance. You have ${totalAvail} minutes available (${allocated} allocated + ${purchased} purchased).` });
    return;
  }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (target.isAdmin || (target as any).isSubAdmin) {
    res.status(400).json({ error: "Cannot credit admin accounts" }); return;
  }
  // Deduct: use allocated first, then purchased
  const fromAllocated = Math.min(allocated, minutes);
  const fromPurchased = minutes - fromAllocated;
  await db.execute(
    `UPDATE users SET sub_admin_minutes_balance = sub_admin_minutes_balance - ${fromAllocated},
     total_minutes_purchased = total_minutes_purchased - ${fromPurchased}
     WHERE id = ${subAdmin.id}`
  );
  await db.update(usersTable)
    .set({ totalMinutesPurchased: target.totalMinutesPurchased + minutes, membership: "active" as const })
    .where(eq(usersTable.id, userId));
  await db.insert(subAdminAuditTable).values({
    subAdminId: subAdmin.id, action: "credit_user", targetUserId: userId, minutesAmount: minutes,
    note: note?.trim() || `${minutes} min credited to ${target.email}`,
  }).catch(() => {});
  const newBal = await db.execute(
    `SELECT sub_admin_minutes_balance, total_minutes_purchased FROM users WHERE id = ${subAdmin.id}`
  );
  const nb = newBal.rows[0] as any;
  res.json({
    success: true, creditedMinutes: minutes,
    targetUser: { id: target.id, email: target.email, username: target.username },
    subAdminBalanceRemaining: (nb?.sub_admin_minutes_balance ?? 0) + (nb?.total_minutes_purchased ?? 0),
  });
});

// POST /subadmin/users/create — Create user with ZERO free credits, tracked to this sub admin
router.post("/users/create", requireSubAdmin, async (req, res) => {
  const subAdmin = (req as any).user;
  const { email, username, password } = req.body as { email?: string; username?: string; password?: string };
  if (!email?.trim() || !username?.trim() || !password || password.length < 8) {
    res.status(400).json({ error: "email, username, and password (min 8 chars) are required" }); return;
  }
  if (email.trim().toLowerCase() === subAdmin.email.toLowerCase()) {
    res.status(400).json({ error: "You cannot create a user account using your own Sub Admin email address" }); return;
  }
  const [existingEmail] = await db.select().from(usersTable).where(eq(usersTable.email, email.trim().toLowerCase()));
  if (existingEmail) { res.status(409).json({ error: "Email already in use" }); return; }
  const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.username, username.trim()));
  if (existingUser) { res.status(409).json({ error: "Username already taken" }); return; }
  const [newUser] = await db.insert(usersTable).values({
    email: email.trim().toLowerCase(), username: username.trim(),
    passwordHash: hashPassword(password), membership: "free_trial" as const,
    freeSecondsRemaining: 0, totalMinutesPurchased: 0, totalSecondsUsed: 0,
    isAdmin: 0, emailVerified: false,
  } as any).returning();
  // Tag user to this sub admin for session filtering + billing disabled
  await db.execute(
    `UPDATE users SET created_by_sub_admin = 1, created_by_sub_admin_id = ${subAdmin.id} WHERE id = ${newUser.id}`
  );
  await db.insert(subAdminAuditTable).values({
    subAdminId: subAdmin.id, action: "create_user", targetUserId: newUser.id,
    note: `Created user account for ${newUser.email} (no free credits)`,
  }).catch(() => {});
  res.status(201).json({
    id: newUser.id, email: newUser.email, username: newUser.username,
    membership: newUser.membership, freeSecondsRemaining: newUser.freeSecondsRemaining,
    message: "User account created successfully with no free streaming credits",
  });
});

// GET /subadmin/pricing — sub admin packages filtered by section-level visibility settings
router.get("/pricing", requireSubAdmin, async (_req, res) => {
  // Check if PAYG top-ups are enabled for sub-admins (default: enabled)
  const allSettings = await db.select().from(settingsTable);
  const subadminTopupEnabled = allSettings.find(s => s.key === "subadmin_topup_enabled")?.value ?? "true";

  let tiers = await db.select().from(subAdminPricingTable).orderBy(subAdminPricingTable.minutes);

  // Fallback to user pricing tiers if no sub admin tiers configured yet
  if (tiers.length === 0) {
    const userTiers = await db.select().from(pricingTable).orderBy(pricingTable.minutes);
    return res.json(
      userTiers
        .filter(t => {
          if (!(t.isActive ?? true)) return false;
          if (t.planType === "topup" && subadminTopupEnabled !== "true") return false;
          return true;
        })
        .map(t => ({ id: t.id, minutes: t.minutes, priceUsdt: parseFloat(t.priceUsdt), label: t.label, planType: t.planType ?? "topup" }))
    );
  }

  return res.json(
    tiers
      .filter(t => {
        if (!(t.isActive ?? true)) return false;
        if (t.planType === "topup" && subadminTopupEnabled !== "true") return false;
        return true;
      })
      .map(t => ({ id: t.id, minutes: t.minutes, priceUsdt: parseFloat(t.priceUsdt), label: t.label, planType: t.planType ?? "topup" }))
  );
});

// GET /subadmin/invoices — return sub admin's own invoices (excludes active pending orders)
router.get("/invoices", requireSubAdmin, async (req, res) => {
  const subAdmin = (req as any).user;
  const invs = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.userId, subAdmin.id))
    .orderBy(desc(invoicesTable.createdAt)).limit(50);
  // Only return completed, cancelled, failed, and expired orders — not active pending
  const filtered = invs.filter(inv => inv.status !== "pending");
  res.json(filtered.map(inv => ({
    id: inv.id, minutes: inv.minutes,
    amountUsdt: parseFloat(inv.amountUsdt), status: inv.status,
    walletAddress: inv.walletAddress, createdAt: inv.createdAt, paidAt: inv.paidAt,
  })));
});

// POST /subadmin/invoices/:invoiceId/cancel — user clicked cancel button
router.post("/invoices/:invoiceId/cancel", requireSubAdmin, async (req, res) => {
  const subAdmin = (req as any).user;
  const invoiceId = req.params["invoiceId"] as string;

  const [invoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId));

  if (!invoice || invoice.userId !== subAdmin.id) {
    res.status(404).json({ error: "Invoice not found" }); return;
  }

  if (invoice.status !== "pending") {
    res.json({ cancelled: false, message: `Invoice is already ${invoice.status}` }); return;
  }

  await db.update(invoicesTable)
    .set({ status: "cancelled" })
    .where(eq(invoicesTable.id, invoiceId));

  res.json({ cancelled: true, invoiceId });
});

// POST /subadmin/invoices/:invoiceId/fail — countdown timer expired, mark as failed
router.post("/invoices/:invoiceId/fail", requireSubAdmin, async (req, res) => {
  const subAdmin = (req as any).user;
  const invoiceId = req.params["invoiceId"] as string;

  const [invoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId));

  if (!invoice || invoice.userId !== subAdmin.id) {
    res.status(404).json({ error: "Invoice not found" }); return;
  }

  if (invoice.status !== "pending") {
    res.json({ failed: false, message: `Invoice is already ${invoice.status}` }); return;
  }

  await db.update(invoicesTable)
    .set({ status: "cancelled" })
    .where(eq(invoicesTable.id, invoiceId));

  res.json({ failed: true, invoiceId });
});

// POST /subadmin/topup — create a top-up invoice (minutes go to totalMinutesPurchased for distribution)
router.post("/topup", requireSubAdmin, async (req, res) => {
  const subAdmin = (req as any).user;
  const { minutes } = req.body as { minutes?: number };
  if (!minutes || minutes < 1 || !Number.isInteger(minutes)) {
    res.status(400).json({ error: "minutes must be a positive integer" }); return;
  }
  const tiers = await db.select().from(pricingTable).orderBy(pricingTable.minutes);
  let pricePerMinuteUsd = 0.2;
  if (tiers.length > 0) {
    const cheapest = tiers[0];
    pricePerMinuteUsd = parseFloat(cheapest.priceUsdt) / cheapest.minutes;
  }
  const amountUsd = minutes * pricePerMinuteUsd;
  const amountUsdt = await usdToUsdt(amountUsd);
  const invoiceId = randomUUID();
  const allSettings = await db.select().from(settingsTable);
  const getSetting = (key: string) => allSettings.find(s => s.key === key)?.value ?? null;
  const walletAddress: string = getSetting("usdt_wallet") || process.env.USDT_WALLET || "";
  const walletNetwork = getSetting("usdt_network") || "TRC-20 (Tron)";
  const exactAmountUsdt = amountUsdt;
  const [invoice] = await db.insert(invoicesTable).values({
    id: invoiceId, userId: subAdmin.id, minutes,
    amountUsd: amountUsd.toFixed(2), amountUsdt: exactAmountUsdt.toFixed(6),
    status: "pending", walletAddress,
  }).returning();
  res.json({
    id: invoice.id, minutes: invoice.minutes,
    amountUsd: parseFloat(invoice.amountUsd ?? "0"),
    amountUsdt: parseFloat(invoice.amountUsdt),
    walletAddress: invoice.walletAddress,
    walletNetwork, status: invoice.status, createdAt: invoice.createdAt,
  });
});


// GET /subadmin/my-users — all users created by this sub admin
router.get("/my-users", requireSubAdmin, async (req, res) => {
  const subAdmin = (req as any).user;
  const result = await db.execute(`
    SELECT id, email, username, membership, total_minutes_purchased,
           total_seconds_used::numeric / 60 AS total_minutes_used,
           free_seconds_remaining, created_at
    FROM users
    WHERE created_by_sub_admin_id = ${subAdmin.id}
    ORDER BY created_at DESC
  `);
  res.json(result.rows.map((r: any) => ({
    id: r.id, email: r.email, username: r.username, membership: r.membership,
    totalMinutesPurchased: r.total_minutes_purchased,
    totalMinutesUsed: Number(r.total_minutes_used ?? 0),
    freeSecondsRemaining: r.free_seconds_remaining,
    createdAt: r.created_at,
  })));
});


// ── License Key Generation ─────────────────────────────────────────────────────
// POST /subadmin/license/generate — sub-admin generates a license key with allocated minutes
router.post("/license/generate", requireSubAdmin, async (req, res) => {
  const subAdmin = (req as any).user;
  const { minutes, notes } = req.body as { minutes?: number; notes?: string };

  if (!minutes || minutes < 1 || !Number.isInteger(minutes)) {
    res.status(400).json({ error: "minutes must be a positive integer" }); return;
  }

  // Check combined balance
  const balResult = await db.execute(
    `SELECT sub_admin_minutes_balance, total_minutes_purchased FROM users WHERE id = ${subAdmin.id}`
  );
  const row = balResult.rows[0] as any;
  const allocated = row?.sub_admin_minutes_balance ?? 0;
  const purchased = row?.total_minutes_purchased ?? 0;
  const totalAvail = allocated + purchased;

  if (totalAvail < minutes) {
    res.status(400).json({
      error: `Insufficient balance. You have ${totalAvail} minutes available (${allocated} allocated + ${purchased} purchased). Cannot generate a ${minutes}-minute key.`,
    }); return;
  }

  // Generate license key
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const genSegment = () => Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const key = [genSegment(), genSegment(), genSegment(), genSegment()].join("-");

  // Deduct from sub-admin: use allocated first, then purchased
  const fromAllocated = Math.min(allocated, minutes);
  const fromPurchased = minutes - fromAllocated;
  await db.execute(
    `UPDATE users SET sub_admin_minutes_balance = sub_admin_minutes_balance - ${fromAllocated},
     total_minutes_purchased = total_minutes_purchased - ${fromPurchased}
     WHERE id = ${subAdmin.id}`
  );

  // Insert license key with minutes
  await db.execute(
    `INSERT INTO license_keys (key, minutes_allocated, created_by_sub_admin_id, notes, is_active)
     VALUES ('${key}', ${minutes}, ${subAdmin.id}, '${(notes || "").replace(/'/g, "''")}', true)`
  );

  // Audit trail
  await db.insert(subAdminAuditTable).values({
    subAdminId: subAdmin.id,
    action: "generate_license_key",
    minutesAmount: minutes,
    note: `Generated license key ${key} with ${minutes} minutes`,
  }).catch(() => {});

  // Get updated balance
  const newBal = await db.execute(
    `SELECT sub_admin_minutes_balance, total_minutes_purchased FROM users WHERE id = ${subAdmin.id}`
  );
  const nb = newBal.rows[0] as any;

  res.json({
    key,
    minutesAllocated: minutes,
    balanceRemaining: (nb?.sub_admin_minutes_balance ?? 0) + (nb?.total_minutes_purchased ?? 0),
  });
});

// GET /subadmin/license/list — list all license keys generated by this sub-admin
router.get("/license/list", requireSubAdmin, async (req, res) => {
  const subAdmin = (req as any).user;
  const result = await db.execute(`
    SELECT id, key, device_id, is_active, activated_at, expires_at, created_at,
           notes, minutes_allocated, minutes_credited
    FROM license_keys
    WHERE created_by_sub_admin_id = ${subAdmin.id}
    ORDER BY created_at DESC
  `);
  res.json(result.rows.map((r: any) => ({
    id: r.id, key: r.key, deviceId: r.device_id, isActive: r.is_active,
    activatedAt: r.activated_at, expiresAt: r.expires_at, createdAt: r.created_at,
    notes: r.notes, minutesAllocated: r.minutes_allocated,
    minutesCredited: r.minutes_credited,
  })));
});

export default router;
