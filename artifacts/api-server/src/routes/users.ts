import { Router } from "express";
import { db, usersTable, sessionsTable, invoicesTable, pricingTable, settingsTable } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth, verifyToken } from "../lib/auth";
import { randomUUID } from "crypto";
import { SetUsageTimeBody } from "@workspace/api-zod";
import { registerSSEClient } from "../lib/sse";
import { usdToUsdt } from "../lib/rates";

const router = Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const recentSessions = await db.select().from(sessionsTable)
    .where(eq(sessionsTable.userId, user.id))
    .orderBy(desc(sessionsTable.startedAt))
    .limit(5);
  const recentInvoices = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.userId, user.id))
    .orderBy(desc(invoicesTable.createdAt))
    .limit(5);
  const totalSpentResult = await db.select({ total: sql<string>`COALESCE(SUM(CAST(amount_usd AS NUMERIC)), 0)` })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.userId, user.id), eq(invoicesTable.status, "paid")));
  const totalSpent = parseFloat(totalSpentResult[0]?.total ?? "0");

  res.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      membership: user.membership,
      freeSecondsRemaining: user.freeSecondsRemaining,
      totalMinutesPurchased: user.totalMinutesPurchased,
      totalSecondsUsed: user.totalSecondsUsed,
      createdBySubAdmin: user.createdBySubAdmin ?? false,
    },
    recentSessions,
    recentInvoices,
    totalSpent,
  });
});

router.post("/set-usage-time", requireAuth, async (req, res) => {
  const parsed = SetUsageTimeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input. Minimum 10 minutes." });
    return;
  }
  const { minutes } = parsed.data;
  const user = (req as any).user;

  // Get current pricing — priceUsdt column now stores USD price
  const tiers = await db.select().from(pricingTable).orderBy(pricingTable.minutes);
  let pricePerMinuteUsd = 0.2; // default $0.20/min
  if (tiers.length > 0) {
    const cheapest = tiers[0];
    pricePerMinuteUsd = parseFloat(cheapest.priceUsdt) / cheapest.minutes;
  }
  const amountUsd = minutes * pricePerMinuteUsd;

  // Convert USD → USDT using live exchange rate
  const amountUsdt = await usdToUsdt(amountUsd);

  const invoiceId = randomUUID();

  // Call bcon.global to generate a unique per-payment receiving address
  const { createPaymentAddress } = await import("../lib/bcon");
  const bconResult = await createPaymentAddress({
    originAmount: amountUsd,
    originCurrency: "USD",
    externalId: invoiceId,
    paymentCurrency: "USDT",
    chain: "tron",
  });

  // Use bcon-generated address when available; fall back to admin-configured wallet
  let walletAddress: string;
  let walletNetwork: string;
  let exactAmountUsdt: number = amountUsdt;

  if (bconResult.success) {
    walletAddress = bconResult.address;
    walletNetwork = "TRC-20 (Tron)";
    const parsed = parseFloat(bconResult.paymentAmount);
    if (!isNaN(parsed) && parsed > 0) exactAmountUsdt = parsed;
  } else {
    req.log.warn({ error: bconResult.error }, "bcon.global address creation failed — using fallback wallet");
    const allSettings = await db.select().from(settingsTable);
    const getSetting = (key: string) => allSettings.find(s => s.key === key)?.value ?? null;
    walletAddress = getSetting("usdt_wallet") || process.env.USDT_WALLET || "";
    walletNetwork = getSetting("usdt_network") || "TRC-20 (Tron)";
  }

  const [invoice] = await db.insert(invoicesTable).values({
    id: invoiceId,
    userId: user.id,
    minutes,
    amountUsd: amountUsd.toFixed(2),
    amountUsdt: exactAmountUsdt.toFixed(6),
    status: "pending",
    walletAddress,
    walletNetwork,
  }).returning();

  res.json({
    id: invoice.id,
    userId: invoice.userId,
    minutes: invoice.minutes,
    amountUsd: invoice.amountUsd != null ? parseFloat(invoice.amountUsd) : amountUsd,
    amountUsdt: parseFloat(invoice.amountUsdt),
    status: invoice.status,
    walletAddress: invoice.walletAddress,
    walletNetwork,
    allWallets: [{ address: walletAddress, network: walletNetwork }],
    txHash: invoice.txHash,
    createdAt: invoice.createdAt,
    paidAt: invoice.paidAt,
    gatewayUrl: null,
    paymentoToken: null,
  });
});

// SSE endpoint — auth via query param (EventSource can't set headers)
router.get("/sse", async (req, res) => {
  const token = req.query["token"] as string;
  if (!token) { res.status(401).end(); return; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).end(); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send initial ping
  res.write("event: ping\ndata: connected\n\n");

  const cleanup = await registerSSEClient(payload.userId, res);

  // Keep-alive ping every 25s
  const keepAlive = setInterval(() => {
    try { res.write("event: ping\ndata: ok\n\n"); } catch { clearInterval(keepAlive); }
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    Promise.resolve(cleanup()).catch(() => { /* ignore cleanup errors */ });
  });
});

export default router;
