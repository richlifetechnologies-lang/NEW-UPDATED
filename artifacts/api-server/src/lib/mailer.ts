import nodemailer from "nodemailer";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

async function getSetting(key: string): Promise<string> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? "";
}

function makeTransporter(host: string, port: number, user: string, pass: string) {
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });
}

/**
 * Resolve SMTP config: environment variables take priority over admin DB settings.
 * Env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
async function resolveSmtpConfig() {
  const envHost = process.env["SMTP_HOST"] ?? "";
  if (envHost) {
    return {
      host: envHost,
      port: parseInt(process.env["SMTP_PORT"] ?? "587"),
      user: process.env["SMTP_USER"] ?? "",
      pass: process.env["SMTP_PASS"] ?? "",
      from: process.env["SMTP_FROM"] ?? process.env["SMTP_USER"] ?? "noreply@fullswap.app",
    };
  }

  // Fall back to admin-panel DB settings
  const [host, port, user, pass, from] = await Promise.all([
    getSetting("notif_smtp_host"),
    getSetting("notif_smtp_port"),
    getSetting("notif_smtp_user"),
    getSetting("notif_smtp_pass"),
    getSetting("notif_smtp_from"),
  ]);

  return {
    host,
    port: parseInt(port || "587"),
    user,
    pass,
    from: from || user || "noreply@fullswap.app",
  };
}

export async function sendVerificationEmail(toEmail: string, pin: string, username: string): Promise<{ sent: boolean }> {
  const smtp = await resolveSmtpConfig();

  if (!smtp.host) {
    logger.warn({ toEmail }, "SMTP host not configured — verification PIN logged to console");
    logger.info({ toEmail, pin }, "Email verification PIN (set SMTP_HOST/SMTP_USER/SMTP_PASS env vars, or configure in Admin → Notifications)");
    return { sent: false };
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Verify your FULL SWAP account</title></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#161b22;border-radius:16px;overflow:hidden;border:1px solid #30363d">
        <tr><td style="background:linear-gradient(135deg,#00d2d3,#0ea5e9);padding:28px 32px">
          <p style="margin:0;color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">FULL SWAP</p>
          <p style="margin:3px 0 0;color:rgba(255,255,255,0.7);font-size:11px;letter-spacing:2px;text-transform:uppercase">Live Streaming Studio</p>
        </td></tr>
        <tr><td style="padding:36px 32px 0;text-align:center">
          <p style="margin:0 0 6px;font-size:28px">🔐</p>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#e6edf3">Verify your email</h1>
          <p style="margin:0;font-size:14px;color:#8b949e">Hi ${username}, enter this PIN to activate your account</p>
        </td></tr>
        <tr><td style="padding:28px 32px">
          <div style="background:#0d1117;border:2px solid #00d2d3;border-radius:12px;padding:24px;text-align:center">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:2px">Your verification PIN</p>
            <p style="margin:0;font-size:52px;font-weight:900;color:#00d2d3;letter-spacing:12px;font-family:monospace">${pin}</p>
            <p style="margin:8px 0 0;font-size:11px;color:#8b949e">Valid for 15 minutes</p>
          </div>
        </td></tr>
        <tr><td style="padding:0 32px 32px;text-align:center">
          <p style="margin:0;font-size:12px;color:#6e7681">If you didn't create a FULL SWAP account, you can safely ignore this email.</p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #30363d;text-align:center">
          <p style="margin:0;font-size:11px;color:#484f58">FULL SWAP · AI Video Studio · fullswap.app</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const transporter = makeTransporter(smtp.host, smtp.port, smtp.user, smtp.pass);

  await transporter.sendMail({
    from: smtp.from,
    to: toEmail,
    subject: `${pin} — Your FULL SWAP verification PIN`,
    html,
    text: `Your FULL SWAP verification PIN is: ${pin}\n\nThis PIN expires in 15 minutes.\n\nIf you didn't create this account, ignore this email.`,
  });

  logger.info({ to: toEmail }, "Verification email sent");
  return { sent: true };
}

export async function sendAdminNotification(subject: string, body: string): Promise<void> {
  const smtp = await resolveSmtpConfig();
  const [smtpEnabled, smtpTo] = await Promise.all([
    getSetting("notif_smtp_enabled"),
    getSetting("notif_smtp_to"),
  ]);

  if (!smtp.host || smtpEnabled !== "true" || !smtpTo) return;

  const transporter = makeTransporter(smtp.host, smtp.port, smtp.user, smtp.pass);
  await transporter.sendMail({
    from: smtp.from,
    to: smtpTo,
    subject,
    text: body,
  });
}
