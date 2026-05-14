// ============================================================
// ADD THESE ROUTES TO: artifacts/api-server/src/routes/admin.ts
// Place after existing decart-keys routes (search for "decart-keys")
// Import at top: import { getKeyCreditStatus, getAllKeysCreditStatus, recordTopup, getKeyUsageHistory } from "../lib/credit-tracker";
// ============================================================

// ─────────────────────────────────────────────────────────────
//  DECART CREDIT TRACKING ENDPOINTS
// ─────────────────────────────────────────────────────────────

/** GET /api/admin/decart-keys/credit-status
 *  Returns real-time credit status for all Decart API keys */
router.get("/decart-keys/credit-status", requireAdmin, async (req, res) => {
  try {
    // Get global settings
    const [settings] = await db
      .select()
      .from(decartCreditSettingsTable)
      .where(eq(decartCreditSettingsTable.id, 1))
      .limit(1);

    const globalPct = settings?.globalThresholdPct ?? 15;
    const useGlobal = settings?.useGlobalThreshold ?? false;

    const statuses = await getAllKeysCreditStatus(globalPct, useGlobal);
    res.json({ keys: statuses, globalSettings: { globalThresholdPct: globalPct, useGlobalThreshold: useGlobal } });
  } catch (err) {
    logger.error({ err }, "Failed to get credit status");
    res.status(500).json({ error: "Failed to retrieve credit status" });
  }
});

/** POST /api/admin/decart-keys/:id/topup
 *  Record a credit top-up for a key and reset the usage baseline */
router.post("/decart-keys/:id/topup", requireAdmin, async (req, res) => {
  const keyId = parseInt(req.params.id);
  const { credits } = req.body as { credits: number };

  if (!credits || isNaN(credits) || credits <= 0) {
    res.status(400).json({ error: "credits must be a positive number" });
    return;
  }

  try {
    const result = await recordTopup(keyId, credits);
    res.json({ success: true, ...result });
  } catch (err: any) {
    logger.error({ err, keyId }, "Failed to record top-up");
    res.status(500).json({ error: err.message ?? "Failed to record top-up" });
  }
});

/** PUT /api/admin/decart-keys/:id/threshold
 *  Set the per-key warning threshold percentage */
router.put("/decart-keys/:id/threshold", requireAdmin, async (req, res) => {
  const keyId = parseInt(req.params.id);
  const { thresholdPct } = req.body as { thresholdPct: number };

  if (thresholdPct === undefined || thresholdPct < 0 || thresholdPct > 100) {
    res.status(400).json({ error: "thresholdPct must be 0–100" });
    return;
  }

  try {
    await db
      .update(decartApiKeysTable)
      .set({ thresholdPct, updatedAt: new Date() })
      .where(eq(decartApiKeysTable.id, keyId));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to update threshold");
    res.status(500).json({ error: "Failed to update threshold" });
  }
});

/** GET /api/admin/decart-keys/:id/usage-history
 *  Get session-by-session usage history for a Decart key */
router.get("/decart-keys/:id/usage-history", requireAdmin, async (req, res) => {
  const keyId = parseInt(req.params.id);
  const limit = Math.min(parseInt(req.query.limit as string ?? "50"), 200);
  try {
    const history = await getKeyUsageHistory(keyId, limit);
    res.json(history);
  } catch (err) {
    logger.error({ err }, "Failed to get usage history");
    res.status(500).json({ error: "Failed to retrieve usage history" });
  }
});

/** GET /api/admin/decart-credit-settings
 *  Get global credit threshold settings */
router.get("/decart-credit-settings", requireAdmin, async (req, res) => {
  try {
    const [settings] = await db
      .select()
      .from(decartCreditSettingsTable)
      .limit(1);
    res.json(settings ?? { globalThresholdPct: 15, useGlobalThreshold: false });
  } catch (err) {
    res.status(500).json({ error: "Failed to get settings" });
  }
});

/** PUT /api/admin/decart-credit-settings
 *  Update global credit threshold settings */
router.put("/decart-credit-settings", requireAdmin, async (req, res) => {
  const { globalThresholdPct, useGlobalThreshold } = req.body as {
    globalThresholdPct?: number;
    useGlobalThreshold?: boolean;
  };

  try {
    await db
      .update(decartCreditSettingsTable)
      .set({
        ...(globalThresholdPct !== undefined && { globalThresholdPct }),
        ...(useGlobalThreshold !== undefined && { useGlobalThreshold }),
        updatedAt: new Date(),
      })
      .where(eq(decartCreditSettingsTable.id, 1));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to update global settings");
    res.status(500).json({ error: "Failed to update global settings" });
  }
});
