import { Router } from "express";
import { requireAdmin } from "../lib/auth";
import {
  getNotificationSettings,
  saveNotificationSettings,
  testNotifications,
} from "../lib/notifications";

const router = Router();

router.get("/", requireAdmin, async (req, res) => {
  const settings = await getNotificationSettings();
  res.json({
    webhookUrl: settings.webhookUrl,
    webhookEnabled: settings.webhookEnabled === "true",
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpPassSet: !!settings.smtpPass,
    smtpFrom: settings.smtpFrom,
    smtpTo: settings.smtpTo,
    smtpEnabled: settings.smtpEnabled === "true",
    userEmailEnabled: settings.userEmailEnabled === "true",
    telegramTokenSet: !!settings.telegramToken,
    telegramChatId: settings.telegramChatId,
    telegramEnabled: settings.telegramEnabled === "true",
  });
});

router.put("/", requireAdmin, async (req, res) => {
  const {
    webhookUrl, webhookEnabled,
    smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, smtpTo, smtpEnabled,
    userEmailEnabled,
    telegramToken, telegramChatId, telegramEnabled,
  } = req.body;
  await saveNotificationSettings({
    webhookUrl, webhookEnabled,
    smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, smtpTo, smtpEnabled,
    userEmailEnabled,
    ...(telegramToken   !== undefined ? { telegramToken }   : {}),
    ...(telegramChatId  !== undefined ? { telegramChatId }  : {}),
    ...(telegramEnabled !== undefined ? { telegramEnabled } : {}),
  });
  res.json({ ok: true });
});

router.post("/test", requireAdmin, async (req, res) => {
  const { type } = req.body as { type: "webhook" | "email" | "user-email" | "telegram" };
  if (!["webhook", "email", "user-email", "telegram"].includes(type)) {
    res.status(400).json({ error: "type must be webhook, email, user-email, or telegram" });
    return;
  }
  await testNotifications(type);
  res.json({ ok: true, message: `Test ${type} sent` });
});

export default router;
