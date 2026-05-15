import nodemailer from "nodemailer";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export interface PaymentNotificationPayload {
  invoiceId: string;
  userId: number;
  userEmail: string;
  username?: string;
  minutes: number;
  amountUsd?: number;
  amountUsdt: number;
  txHash: string;
  paidAt: Date;
  network?: string;
}

async function getSetting(key: string): Promise<string> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? "";
}

async function setSetting(key: string, value: string) {
  await db.insert(settingsTable).values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value } });
}

export async function getNotificationSettings() {
  const [webhookUrl, smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, smtpTo, smtpEnabled, webhookEnabled, userEmailEnabled,
         telegramToken, telegramChatId, telegramEnabled] =
    await Promise.all([
      getSetting("notif_webhook_url"),
      getSetting("notif_smtp_host"),
      getSetting("notif_smtp_port"),
      getSetting("notif_smtp_user"),
      getSetting("notif_smtp_pass"),
      getSetting("notif_smtp_from"),
      getSetting("notif_smtp_to"),
      getSetting("notif_smtp_enabled"),
      getSetting("notif_webhook_enabled"),
      getSetting("notif_user_email_enabled"),
      getSetting("notif_telegram_token"),
      getSetting("notif_telegram_chat_id"),
      getSetting("notif_telegram_enabled"),
    ]);
  return { webhookUrl, smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, smtpTo, smtpEnabled, webhookEnabled, userEmailEnabled,
           telegramToken, telegramChatId, telegramEnabled };
}

export async function saveNotificationSettings(settings: {
  webhookUrl?: string;
  webhookEnabled?: boolean;
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  smtpTo?: string;
  smtpEnabled?: boolean;
  userEmailEnabled?: boolean;
  telegramToken?: string;
  telegramChatId?: string;
  telegramEnabled?: boolean;
}) {
  const ops: Promise<void>[] = [];
  const s = (k: string, v: string) => ops.push(setSetting(k, v));
  if (settings.webhookUrl       !== undefined) s("notif_webhook_url",        settings.webhookUrl);
  if (settings.webhookEnabled   !== undefined) s("notif_webhook_enabled",    String(settings.webhookEnabled));
  if (settings.smtpHost         !== undefined) s("notif_smtp_host",          settings.smtpHost);
  if (settings.smtpPort         !== undefined) s("notif_smtp_port",          settings.smtpPort);
  if (settings.smtpUser         !== undefined) s("notif_smtp_user",          settings.smtpUser);
  if (settings.smtpPass         !== undefined) s("notif_smtp_pass",          settings.smtpPass);
  if (settings.smtpFrom         !== undefined) s("notif_smtp_from",          settings.smtpFrom);
  if (settings.smtpTo           !== undefined) s("notif_smtp_to",            settings.smtpTo);
  if (settings.smtpEnabled      !== undefined) s("notif_smtp_enabled",       String(settings.smtpEnabled));
  if (settings.userEmailEnabled !== undefined) s("notif_user_email_enabled", String(settings.userEmailEnabled));
  if (settings.telegramToken    !== undefined) s("notif_telegram_token",     settings.telegramToken);
  if (settings.telegramChatId   !== undefined) s("notif_telegram_chat_id",   settings.telegramChatId);
  if (settings.telegramEnabled  !== undefined) s("notif_telegram_enabled",   String(settings.telegramEnabled));
  await Promise.all(ops);
}

// ─── Shared transporter helper ─────────────────────────────────────────────

function makeTransporter(settings: Awaited<ReturnType<typeof getNotificationSettings>>) {
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: parseInt(settings.smtpPort || "587"),
    secure: parseInt(settings.smtpPort || "587") === 465,
    auth: settings.smtpUser ? { user: settings.smtpUser, pass: settings.smtpPass } : undefined,
  });
}

// ─── Webhook ───────────────────────────────────────────────────────────────

async function fireWebhook(settings: Awaited<ReturnType<typeof getNotificationSettings>>, payload: PaymentNotificationPayload) {
  if (settings.webhookEnabled !== "true" || !settings.webhookUrl) return;
  try {
    const res = await fetch(settings.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-FullSwap-Event": "payment.confirmed" },
      body: JSON.stringify({
        event: "payment.confirmed",
        invoiceId: payload.invoiceId,
        userId: payload.userId,
        userEmail: payload.userEmail,
        minutes: payload.minutes,
        amountUsdt: payload.amountUsdt,
        txHash: payload.txHash,
        paidAt: payload.paidAt.toISOString(),
      }),
      signal: AbortSignal.timeout(10000),
    });
    logger.info({ status: res.status, url: settings.webhookUrl }, "Webhook fired");
  } catch (err) {
    logger.warn({ err }, "Webhook delivery failed");
  }
}

// ─── Admin notification email ──────────────────────────────────────────────

async function sendAdminEmail(settings: Awaited<ReturnType<typeof getNotificationSettings>>, payload: PaymentNotificationPayload) {
  if (settings.smtpEnabled !== "true" || !settings.smtpHost || !settings.smtpTo) return;
  try {
    const transporter = makeTransporter(settings);
    await transporter.sendMail({
      from: settings.smtpFrom || settings.smtpUser || "noreply@fullswap.app",
      to: settings.smtpTo,
      subject: `Payment Confirmed — ${payload.minutes} min for ${payload.userEmail}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <h2 style="color:#0ea5e9">FULL SWAP — Payment Confirmed</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:6px 0;color:#6b7280">User</td><td style="padding:6px 0;font-weight:600">${payload.userEmail}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Minutes Added</td><td style="padding:6px 0;font-weight:600">${payload.minutes} min</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Amount</td><td style="padding:6px 0;font-weight:600">${payload.amountUsdt} USDT${payload.amountUsd ? ` ($${payload.amountUsd.toFixed(2)} USD)` : ""}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Invoice ID</td><td style="padding:6px 0;font-family:monospace;font-size:12px">${payload.invoiceId}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">TX Hash</td><td style="padding:6px 0;font-family:monospace;font-size:11px">${payload.txHash}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Confirmed At</td><td style="padding:6px 0">${payload.paidAt.toUTCString()}</td></tr>
          </table>
        </div>`,
      text: `FULL SWAP Payment Confirmed\n\nUser: ${payload.userEmail}\nMinutes: ${payload.minutes}\nAmount: ${payload.amountUsdt} USDT\nTX: ${payload.txHash}\nInvoice: ${payload.invoiceId}`,
    });
    logger.info({ to: settings.smtpTo }, "Admin payment confirmation email sent");
  } catch (err) {
    logger.warn({ err }, "Admin email delivery failed");
  }
}

// ─── User confirmation email ───────────────────────────────────────────────

function fmtDate(d: Date) {
  return d.toLocaleString("en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

async function sendUserConfirmationEmail(settings: Awaited<ReturnType<typeof getNotificationSettings>>, payload: PaymentNotificationPayload) {
  if (settings.userEmailEnabled !== "true" || !settings.smtpHost || !payload.userEmail) return;
  const from = settings.smtpFrom || settings.smtpUser || "noreply@fullswap.app";
  const usdLine = payload.amountUsd ? `$${payload.amountUsd.toFixed(2)} USD` : `${payload.amountUsdt} USDT`;
  const network = payload.network || "TRC-20 (Tron)";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment Confirmed</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

        <!-- Header -->
        <tr><td style="background:#00d2d3;padding:28px 32px">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <p style="margin:0;color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.5px">FULL SWAP</p>
                <p style="margin:2px 0 0;color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:2px;text-transform:uppercase">AI Video Studio</p>
              </td>
              <td align="right">
                <span style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;letter-spacing:1px">✓ PAYMENT CONFIRMED</span>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Hero -->
        <tr><td style="padding:32px 32px 0;text-align:center">
          <div style="width:64px;height:64px;background:#f0fdf4;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center">
            <span style="font-size:32px">✅</span>
          </div>
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#0f172a">Payment Received!</h1>
          <p style="margin:0;font-size:15px;color:#64748b">
            Hi ${payload.username || payload.userEmail.split("@")[0]}, your USDT payment has been confirmed on-chain.<br>
            Your session time is ready to use.
          </p>
        </td></tr>

        <!-- Amount highlight -->
        <tr><td style="padding:24px 32px">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa;border:2px solid #00d2d3;border-radius:10px">
            <tr><td style="padding:20px;text-align:center">
              <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px">Minutes Added to Your Account</p>
              <p style="margin:0;font-size:48px;font-weight:900;color:#00d2d3;line-height:1">${payload.minutes}</p>
              <p style="margin:4px 0 0;font-size:14px;color:#64748b;font-weight:500">minutes</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Receipt table -->
        <tr><td style="padding:0 32px 24px">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:2px">Receipt Details</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px">
            <tr style="background:#f8fafc">
              <td style="padding:10px 16px;color:#64748b;font-weight:600;width:40%">Invoice ID</td>
              <td style="padding:10px 16px;color:#0f172a;font-family:monospace;font-size:11px">${payload.invoiceId.slice(0, 16)}...</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;color:#64748b;font-weight:600;border-top:1px solid #e2e8f0">Amount Paid</td>
              <td style="padding:10px 16px;color:#0f172a;font-weight:700;border-top:1px solid #e2e8f0">${usdLine}</td>
            </tr>
            <tr style="background:#f8fafc">
              <td style="padding:10px 16px;color:#64748b;font-weight:600;border-top:1px solid #e2e8f0">USDT Amount</td>
              <td style="padding:10px 16px;color:#0f172a;font-family:monospace;font-size:12px;border-top:1px solid #e2e8f0">${payload.amountUsdt.toFixed(6)} USDT</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;color:#64748b;font-weight:600;border-top:1px solid #e2e8f0">Network</td>
              <td style="padding:10px 16px;color:#0f172a;border-top:1px solid #e2e8f0">${network}</td>
            </tr>
            <tr style="background:#f8fafc">
              <td style="padding:10px 16px;color:#64748b;font-weight:600;border-top:1px solid #e2e8f0">TX Hash</td>
              <td style="padding:10px 16px;color:#0f172a;font-family:monospace;font-size:10px;word-break:break-all;border-top:1px solid #e2e8f0">${payload.txHash}</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;color:#64748b;font-weight:600;border-top:1px solid #e2e8f0">Confirmed At</td>
              <td style="padding:10px 16px;color:#0f172a;border-top:1px solid #e2e8f0">${fmtDate(payload.paidAt)}</td>
            </tr>
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding:0 32px 32px;text-align:center">
          <p style="margin:0 0 16px;font-size:13px;color:#64748b">
            Log in to your dashboard to start streaming with your new session time.
          </p>
          <a href="https://fullswap.app/dashboard" style="display:inline-block;background:#00d2d3;color:#ffffff;font-size:14px;font-weight:700;padding:12px 32px;border-radius:8px;text-decoration:none">Open Dashboard →</a>
        </td></tr>

        <!-- Divider -->
        <tr><td style="padding:0 32px"><hr style="border:none;border-top:1px solid #e2e8f0;margin:0"></td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 32px;text-align:center">
          <p style="margin:0;font-size:11px;color:#94a3b8">FULL SWAP · AI Video Studio · fullswap.app</p>
          <p style="margin:4px 0 0;font-size:11px;color:#94a3b8">This is an automated receipt. Please keep it for your records.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `FULL SWAP — Payment Confirmed!\n\nHi ${payload.username || payload.userEmail.split("@")[0]},\n\nYour USDT payment has been confirmed. ${payload.minutes} minutes have been added to your account.\n\nReceipt:\n  Invoice: ${payload.invoiceId}\n  Amount:  ${usdLine}\n  USDT:    ${payload.amountUsdt.toFixed(6)}\n  Network: ${network}\n  TX Hash: ${payload.txHash}\n  Paid At: ${fmtDate(payload.paidAt)}\n\nOpen your dashboard: https://fullswap.app/dashboard\n\nFULL SWAP · AI Video Studio`;

  try {
    const transporter = makeTransporter(settings);
    await transporter.sendMail({
      from,
      to: payload.userEmail,
      subject: `✅ Payment Confirmed — ${payload.minutes} minutes added to your FULL SWAP account`,
      html,
      text,
    });
    logger.info({ to: payload.userEmail }, "User confirmation email sent");
  } catch (err) {
    logger.warn({ err }, "User confirmation email delivery failed");
  }
}

// ─── Main notification dispatcher ─────────────────────────────────────────

export async function notifyPaymentConfirmed(payload: PaymentNotificationPayload) {
  try {
    const settings = await getNotificationSettings();
    await Promise.all([
      fireWebhook(settings, payload),
      sendAdminEmail(settings, payload),
    ]);
  } catch (err) {
    logger.warn({ err }, "Notification dispatch error");
  }
}

// ─── Trial expired ─────────────────────────────────────────────────────────

export interface TrialExpiredPayload {
  userId: number;
  userEmail: string;
  username: string;
  expiredAt: Date;
}

async function fireTrialExpiredWebhook(settings: Awaited<ReturnType<typeof getNotificationSettings>>, payload: TrialExpiredPayload) {
  if (settings.webhookEnabled !== "true" || !settings.webhookUrl) return;
  try {
    await fetch(settings.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-FullSwap-Event": "trial.expired" },
      body: JSON.stringify({
        event: "trial.expired",
        userId: payload.userId,
        userEmail: payload.userEmail,
        username: payload.username,
        expiredAt: payload.expiredAt.toISOString(),
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    logger.warn({ err }, "Trial expired webhook failed");
  }
}

async function sendTrialExpiredEmail(settings: Awaited<ReturnType<typeof getNotificationSettings>>, payload: TrialExpiredPayload) {
  if (settings.smtpEnabled !== "true" || !settings.smtpHost || !settings.smtpTo) return;
  try {
    const transporter = makeTransporter(settings);
    await transporter.sendMail({
      from: settings.smtpFrom || settings.smtpUser || "noreply@fullswap.app",
      to: settings.smtpTo,
      subject: `Free Trial Expired — ${payload.userEmail}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <h2 style="color:#f59e0b">FULL SWAP — Free Trial Expired</h2>
          <p style="font-size:14px;color:#374151">A user's free trial has run out. This is a potential conversion opportunity.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">
            <tr><td style="padding:6px 0;color:#6b7280">User</td><td style="padding:6px 0;font-weight:600">${payload.userEmail}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Username</td><td style="padding:6px 0;font-weight:600">${payload.username}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Trial Used</td><td style="padding:6px 0;font-weight:600">1 min 30 sec</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Expired At</td><td style="padding:6px 0">${payload.expiredAt.toUTCString()}</td></tr>
          </table>
          <p style="margin-top:16px;font-size:12px;color:#9ca3af">They have been shown the purchase prompt on their dashboard.</p>
        </div>`,
      text: `FULL SWAP Trial Expired\n\nUser: ${payload.userEmail}\nUsername: ${payload.username}\nExpired: ${payload.expiredAt.toUTCString()}`,
    });
    logger.info({ to: settings.smtpTo }, "Trial expired email sent");
  } catch (err) {
    logger.warn({ err }, "Trial expired email failed");
  }
}

export async function notifyTrialExpired(payload: TrialExpiredPayload) {
  try {
    const settings = await getNotificationSettings();
    await Promise.all([
      fireTrialExpiredWebhook(settings, payload),
      sendTrialExpiredEmail(settings, payload),
    ]);
  } catch (err) {
    logger.warn({ err }, "Trial expired notification dispatch error");
  }
}

// ─── Telegram ──────────────────────────────────────────────────────────────

async function sendTelegramMessage(token: string, chatId: string, html: string) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
}

async function fireTelegram(settings: Awaited<ReturnType<typeof getNotificationSettings>>, html: string) {
  if (settings.telegramEnabled !== "true" || !settings.telegramToken || !settings.telegramChatId) return;
  try {
    await sendTelegramMessage(settings.telegramToken, settings.telegramChatId, html);
    logger.info("Telegram notification sent");
  } catch (err) {
    logger.warn({ err }, "Telegram delivery failed");
  }
}

// ─── License activated notification ────────────────────────────────────────

export interface LicenseActivatedPayload {
  key: string;
  minutesAllocated: number;
  activatedAt: Date;
  deviceId?: string | null;
}

export async function notifyLicenseActivated(payload: LicenseActivatedPayload) {
  try {
    const settings = await getNotificationSettings();
    const shortKey = payload.key.slice(0, 5) + "-••••••••••";
    const msg =
      `🔑 <b>License Key Activated</b>\n\n` +
      `<b>Key:</b> <code>${shortKey}</code>\n` +
      `<b>Minutes:</b> ${payload.minutesAllocated} min\n` +
      `<b>Device:</b> ${payload.deviceId || "web-browser"}\n` +
      `<b>Time:</b> ${payload.activatedAt.toUTCString()}`;
    await fireTelegram(settings, msg);
  } catch (err) {
    logger.warn({ err }, "License activated notification dispatch error");
  }
}

// ─── Session dead / frozen notification ────────────────────────────────────

export interface SessionDeadPayload {
  sessionId: string;
  licenseKey?: string | null;
  durationSecs: number;
  reason: "out_of_time" | "orphan" | "freeze" | "stopped";
  killedAt: Date;
}

function fmt(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

const REASON_LABEL: Record<SessionDeadPayload["reason"], string> = {
  out_of_time: "⏰ Out of Time",
  orphan:      "💀 Orphaned (client died)",
  freeze:      "🧊 Deduction Frozen",
  stopped:     "✅ Stopped normally",
};

export async function notifySessionDead(payload: SessionDeadPayload) {
  // Only alert admin on problematic kills, not normal stops
  if (payload.reason === "stopped") return;
  try {
    const settings = await getNotificationSettings();
    const shortKey = payload.licenseKey ? payload.licenseKey.slice(0, 5) + "-••••••••••" : "unknown";
    const emoji = payload.reason === "out_of_time" ? "⏰" : payload.reason === "freeze" ? "🧊" : "💀";
    const msg =
      `${emoji} <b>Session Killed — ${REASON_LABEL[payload.reason]}</b>\n\n` +
      `<b>Session:</b> <code>${payload.sessionId.slice(0, 8)}…</code>\n` +
      `<b>License:</b> <code>${shortKey}</code>\n` +
      `<b>Duration:</b> ${fmt(payload.durationSecs)}\n` +
      `<b>Reason:</b> ${payload.reason}\n` +
      `<b>At:</b> ${payload.killedAt.toUTCString()}`;
    await fireTelegram(settings, msg);
  } catch (err) {
    logger.warn({ err }, "Session dead notification dispatch error");
  }
}

// ─── Test helpers ──────────────────────────────────────────────────────────

export async function testNotifications(type: "webhook" | "email" | "user-email" | "telegram") {
  const settings = await getNotificationSettings();
  const testPayload: PaymentNotificationPayload = {
    invoiceId: "test-invoice-" + Date.now(),
    userId: 0,
    userEmail: settings.smtpTo || settings.smtpUser || "test@example.com",
    username: "TestUser",
    minutes: 60,
    amountUsd: 12.00,
    amountUsdt: 12.001200,
    txHash: "0x" + "a".repeat(64),
    paidAt: new Date(),
    network: "TRC-20 (Tron)",
  };
  if (type === "webhook")    await fireWebhook({ ...settings, webhookEnabled: "true" }, testPayload);
  if (type === "email")      await sendAdminEmail({ ...settings, smtpEnabled: "true" }, testPayload);
  if (type === "user-email") await sendUserConfirmationEmail({ ...settings, userEmailEnabled: "true" }, testPayload);
  if (type === "telegram")   await fireTelegram({ ...settings, telegramEnabled: "true" },
    `🧪 <b>FULL SWAP — Test Notification</b>\n\nTelegram alerts are working correctly.\n<b>Time:</b> ${new Date().toUTCString()}`);
}
