import { Router } from "express";
import { db, invoicesTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { notifyPaymentConfirmed } from "../lib/notifications";
import { getAddressHistory } from "../lib/bcon";


const router = Router();

router.get("/invoices", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const invoices = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.userId, user.id))
    .orderBy(desc(invoicesTable.createdAt));
  res.json(invoices.map(inv => {
    const network = inv.walletNetwork ?? "USDT";
    return {
      id: inv.id,
      userId: inv.userId,
      minutes: inv.minutes,
      amountUsd: inv.amountUsd != null ? parseFloat(inv.amountUsd) : parseFloat(inv.amountUsdt),
      amountUsdt: parseFloat(inv.amountUsdt),
      status: inv.status,
      type: inv.type ?? "payment",
      walletAddress: inv.walletAddress,
      walletNetwork: network,
      allWallets: inv.walletAddress
        ? [{ address: inv.walletAddress, network }]
        : [],
      txHash: inv.txHash,
      note: inv.note ?? null,
      creditedBy: inv.creditedBy ?? null,
      createdAt: inv.createdAt,
      paidAt: inv.paidAt,
    };
  }));
});

// GET /payments/status/:invoiceId — poll invoice status from DB
router.get("/status/:invoiceId", requireAuth, async (req, res) => {
  const invoiceId = req.params["invoiceId"] as string;
  const user = (req as any).user;

  const [invoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId));

  if (!invoice || invoice.userId !== user.id) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  if (invoice.status === "paid") {
    res.json({
      invoiceId,
      status: "paid",
      confirmed: true,
      minutesAdded: 0,
      message: "Payment confirmed.",
    });
    return;
  }

  res.json({
    invoiceId,
    status: invoice.status,
    confirmed: false,
    minutesAdded: 0,
    message: "Waiting for payment confirmation.",
  });
});

// POST /payments/verify — check bcon.global address history to confirm payment
router.post("/verify", requireAuth, async (req, res) => {
  const { invoiceId } = req.body;
  const user = (req as any).user;

  if (!invoiceId) {
    res.status(400).json({ error: "invoiceId is required" });
    return;
  }

  const [invoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId));

  if (!invoice || invoice.userId !== user.id) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  if (invoice.status === "paid") {
    res.json({ verified: true, invoice: formatInvoice(invoice), minutesAdded: 0,
      message: "Payment already confirmed." });
    return;
  }

  if (!invoice.walletAddress) {
    res.json({ verified: false, invoice: formatInvoice(invoice), minutesAdded: 0,
      message: "No wallet address on record for this invoice." });
    return;
  }

  // Check bcon.global transaction history for this address
  const history = await getAddressHistory(invoice.walletAddress);

  if (!history.success || !history.transactions?.length) {
    res.json({ verified: false, invoice: formatInvoice(invoice), minutesAdded: 0,
      message: "No transactions found yet. Please wait for your payment to confirm." });
    return;
  }

  const confirmed = history.transactions.find(tx => tx.status === "confirmed");
  if (!confirmed) {
    res.json({ verified: false, invoice: formatInvoice(invoice), minutesAdded: 0,
      message: "Transaction detected but not yet confirmed. Usually takes 1–2 minutes." });
    return;
  }

  await creditInvoice(invoice, user, confirmed.txid, res);
});

// GET /payments/webhook — bcon.global callback (query params: status, addr, value, txid, external_id)
router.get("/webhook", async (req, res) => {
  const { status, addr, value, txid, external_id } = req.query as Record<string, string>;

  req.log?.info({ status, addr, value, txid, external_id }, "bcon.global webhook received");

  // status=2 means confirmed on bcon.global
  if (status !== "2") {
    res.json({ received: true, action: "ignored", status });
    return;
  }

  if (!external_id) {
    res.status(400).json({ error: "Missing external_id" });
    return;
  }

  const [invoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, external_id));

  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  if (invoice.status === "paid") {
    res.json({ received: true, action: "already_paid" });
    return;
  }

  const now = new Date();
  const txRef = txid || addr || "bcon";

  await db.update(invoicesTable)
    .set({ status: "paid", txHash: txRef, paidAt: now })
    .where(eq(invoicesTable.id, external_id));

  const [freshUser] = await db.select().from(usersTable)
    .where(eq(usersTable.id, invoice.userId));

  if (freshUser) {
    await db.update(usersTable)
      .set({
        totalMinutesPurchased: (freshUser.totalMinutesPurchased ?? 0) + invoice.minutes,
        membership: "active",
      })
      .where(eq(usersTable.id, invoice.userId));

    notifyPaymentConfirmed({
      invoiceId: invoice.id,
      userId: invoice.userId,
      userEmail: freshUser.email,
      minutes: invoice.minutes,
      amountUsdt: parseFloat(invoice.amountUsdt),
      txHash: txRef,
      paidAt: now,
    }).catch(() => {});
  }

  req.log?.info({ invoiceId: invoice.id, minutes: invoice.minutes }, "bcon.global payment credited");
  res.json({ received: true, action: "credited", invoiceId: invoice.id });
});

// Also accept POST webhook in case bcon.global uses POST
router.post("/webhook", async (req, res) => {
  // Merge body and query params — bcon may send either way
  const params = { ...req.body, ...req.query } as Record<string, string>;
  const { status, addr, value, txid, external_id } = params;

  req.log?.info({ status, addr, value, txid, external_id }, "bcon.global webhook (POST) received");

  if (status !== "2") {
    res.json({ received: true, action: "ignored", status });
    return;
  }

  if (!external_id) {
    res.status(400).json({ error: "Missing external_id" });
    return;
  }

  const [invoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, external_id));

  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  if (invoice.status === "paid") {
    res.json({ received: true, action: "already_paid" });
    return;
  }

  const now = new Date();
  const txRef = txid || addr || "bcon";

  await db.update(invoicesTable)
    .set({ status: "paid", txHash: txRef, paidAt: now })
    .where(eq(invoicesTable.id, external_id));

  const [freshUser] = await db.select().from(usersTable)
    .where(eq(usersTable.id, invoice.userId));

  if (freshUser) {
    await db.update(usersTable)
      .set({
        totalMinutesPurchased: (freshUser.totalMinutesPurchased ?? 0) + invoice.minutes,
        membership: "active",
      })
      .where(eq(usersTable.id, invoice.userId));

    notifyPaymentConfirmed({
      invoiceId: invoice.id,
      userId: invoice.userId,
      userEmail: freshUser.email,
      minutes: invoice.minutes,
      amountUsdt: parseFloat(invoice.amountUsdt),
      txHash: txRef,
      paidAt: now,
    }).catch(() => {});
  }

  req.log?.info({ invoiceId: invoice.id, minutes: invoice.minutes }, "bcon.global payment (POST) credited");
  res.json({ received: true, action: "credited", invoiceId: invoice.id });
});

// POST /payments/cancel/:invoiceId — cancel a pending invoice
router.post("/cancel/:invoiceId", requireAuth, async (req, res) => {
  const invoiceId = req.params["invoiceId"] as string;
  const user = (req as any).user;

  const [invoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId));

  if (!invoice || invoice.userId !== user.id) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  if (invoice.status !== "pending") {
    res.json({ cancelled: false, message: `Invoice is already ${invoice.status}` });
    return;
  }

  await db.update(invoicesTable)
    .set({ status: "cancelled" })
    .where(eq(invoicesTable.id, invoiceId));

  req.log?.info({ invoiceId, userId: user.id }, "Invoice cancelled by timeout");
  res.json({ cancelled: true, invoiceId });
});

router.get("/wallet", async (_req, res) => {
  const { db: _db, settingsTable } = await import("@workspace/db");
  const allSettings = await _db.select().from(settingsTable);
  const get = (key: string) => allSettings.find(s => s.key === key)?.value ?? null;

  const wallets: Array<{ address: string; network: string }> = [];
  for (let i = 1; i <= 3; i++) {
    const addr = get(`wallet_${i}_address`);
    const net  = get(`wallet_${i}_network`);
    if (addr) wallets.push({ address: addr, network: net || "USDT" });
  }
  const legacyAddr = get("usdt_wallet") || process.env.USDT_WALLET || "";
  const legacyNet  = get("usdt_network") || "TRC-20 (Tron)";
  if (wallets.length === 0 && legacyAddr) wallets.push({ address: legacyAddr, network: legacyNet });

  res.json({
    address: wallets[0]?.address ?? "",
    network: wallets[0]?.network ?? "TRC-20 (Tron)",
    wallets,
  });
});


async function creditInvoice(invoice: any, user: any, txRef: string, res: any) {
  const now = new Date();
  const [updatedInvoice] = await db.update(invoicesTable)
    .set({ status: "paid", txHash: txRef, paidAt: now })
    .where(eq(invoicesTable.id, invoice.id))
    .returning();

  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  await db.update(usersTable)
    .set({
      totalMinutesPurchased: (freshUser?.totalMinutesPurchased ?? 0) + invoice.minutes,
      membership: "active",
    })
    .where(eq(usersTable.id, user.id));

  notifyPaymentConfirmed({
    invoiceId: invoice.id,
    userId: user.id,
    userEmail: user.email,
    minutes: invoice.minutes,
    amountUsdt: parseFloat(invoice.amountUsdt),
    txHash: txRef,
    paidAt: now,
  }).catch(() => {});

  res.json({
    verified: true,
    invoice: formatInvoice(updatedInvoice),
    minutesAdded: invoice.minutes,
    message: `Payment confirmed! ${invoice.minutes} minutes added to your account.`,
  });
}

function formatInvoice(inv: any) {
  const network = inv.walletNetwork ?? "USDT";
  return {
    id: inv.id,
    userId: inv.userId,
    minutes: inv.minutes,
    amountUsd: inv.amountUsd != null ? parseFloat(inv.amountUsd) : parseFloat(inv.amountUsdt),
    amountUsdt: parseFloat(inv.amountUsdt),
    status: inv.status,
    type: inv.type ?? "payment",
    walletAddress: inv.walletAddress,
    walletNetwork: network,
    allWallets: inv.walletAddress
      ? [{ address: inv.walletAddress, network }]
      : [],
    txHash: inv.txHash,
    note: inv.note ?? null,
    creditedBy: inv.creditedBy ?? null,
    createdAt: inv.createdAt,
    paidAt: inv.paidAt,
  };
}

export default router;
