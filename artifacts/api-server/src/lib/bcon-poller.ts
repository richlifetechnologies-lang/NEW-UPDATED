import { db, invoicesTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getAddressHistory } from "./bcon";
import { notifyPaymentConfirmed } from "./notifications";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 10_000;

export async function creditInvoiceCore(invoice: {
  id: string;
  userId: number;
  minutes: number;
  amountUsdt: string;
}, txRef: string): Promise<void> {
  const now = new Date();

  await db.update(invoicesTable)
    .set({ status: "paid", txHash: txRef, paidAt: now })
    .where(eq(invoicesTable.id, invoice.id));

  const [freshUser] = await db.select().from(usersTable)
    .where(eq(usersTable.id, invoice.userId));

  if (!freshUser) return;

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

  logger.info({ invoiceId: invoice.id, userId: invoice.userId, minutes: invoice.minutes },
    "bcon-poller: payment confirmed and minutes credited");
}

async function pollPendingInvoices(): Promise<void> {
  try {
    const pending = await db.select().from(invoicesTable)
      .where(inArray(invoicesTable.status, ["pending"]));

    const withWallet = pending.filter(inv => inv.walletAddress);

    if (withWallet.length === 0) return;

    await Promise.allSettled(
      withWallet.map(async (invoice) => {
        const history = await getAddressHistory(invoice.walletAddress!);
        if (!history.success || !history.transactions?.length) return;

        const confirmed = history.transactions.find(tx => tx.status === "confirmed");
        if (!confirmed) return;

        // Re-fetch to guard against race conditions before crediting
        const [fresh] = await db.select().from(invoicesTable)
          .where(eq(invoicesTable.id, invoice.id));
        if (!fresh || fresh.status === "paid" || fresh.status === "cancelled") return;

        await creditInvoiceCore(invoice, confirmed.txid);
      })
    );
  } catch (err) {
    logger.warn({ err }, "bcon-poller: poll cycle error");
  }
}

export function startBconPoller(): void {
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "bcon-poller: starting");
  setInterval(pollPendingInvoices, POLL_INTERVAL_MS);
  // Run one cycle immediately on startup
  pollPendingInvoices();
}
