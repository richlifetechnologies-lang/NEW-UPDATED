import { Router } from "express";
import { db, licenseKeysTable, decartApiKeysTable, sessionsTable, pricingTable, financialTransactionsTable, deviceSecurityEventsTable } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { requireAdmin, requireLicense } from "../lib/auth";
import { notifyLicenseActivated } from "../lib/notifications";
import { getBillingRateForLicense } from "../lib/billing-rate-cache";
import { computeCompressionFactor } from "../lib/billing-math";
import { invalidateLicenseTokenCache } from "./decart";
import { decartPool } from "../lib/decart-pool";

const router = Router();

function genSegment(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// POST /api/license/validate
router.post("/validate", async (req, res) => {
  try {
    const { key, deviceId } = req.body as { key?: string; deviceId?: string };
    if (!key) return res.status(400).json({ valid: false, error: "Missing key" });
    const normalizedKey = key.trim().toUpperCase();
    const [license] = await db.select().from(licenseKeysTable).where(eq(licenseKeysTable.key, normalizedKey)).limit(1);
    if (!license) return res.json({ valid: false, error: "License key not found" });
    if (!license.isActive) return res.json({ valid: false, error: "License key has been revoked" });
    if (license.expiresAt && license.expiresAt < new Date()) return res.json({ valid: false, error: "License key has expired" });
    if (!license.streamingEnabled) return res.json({ valid: false, error: "Streaming is disabled for this license" });
    // Also accept device ID from the X-Device-ID header (set automatically
    // by the frontend for every request) as a fallback to the body field.
    const headerDeviceId = (req.headers["x-device-id"] as string | undefined)?.trim();
    const effectiveDeviceId = (deviceId && deviceId.trim()) ? deviceId.trim() : (headerDeviceId ?? null);

    if (effectiveDeviceId) {
      if (license.deviceId && license.deviceId !== effectiveDeviceId) {
        // Key is already bound to a different device — BLOCK and FLAG SECURITY EVENT
        const clientIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null;
        const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;
        db.insert(deviceSecurityEventsTable).values({
          licenseKey: normalizedKey,
          eventType: "blocked",
          attemptedDeviceId: effectiveDeviceId,
          boundDeviceId: license.deviceId,
          ipAddress: clientIp,
          userAgent,
        }).catch(() => {});
        return res.json({ valid: false, error: "This license key is already activated on another device. Contact your admin to unbind it." });
      }
      if (!license.deviceId) {
        // First-time binding — attach device and record activation timestamp
        const now = new Date();
        await db.update(licenseKeysTable).set({ deviceId: effectiveDeviceId, activatedAt: now }).where(eq(licenseKeysTable.key, normalizedKey));
        // Log the binding event so admin can see device metadata
        const clientIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null;
        const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;
        db.insert(deviceSecurityEventsTable).values({
          licenseKey: normalizedKey,
          eventType: "bound",
          attemptedDeviceId: effectiveDeviceId,
          boundDeviceId: null,
          ipAddress: clientIp,
          userAgent,
        }).catch(() => {});
        notifyLicenseActivated({ key: normalizedKey, minutesAllocated: license.minutesAllocated ?? 0, activatedAt: now, deviceId: effectiveDeviceId }).catch(() => {});
      }
    } else if (!license.activatedAt) {
      // No device ID at all — record activation timestamp only (legacy path)
      const now = new Date();
      await db.update(licenseKeysTable).set({ activatedAt: now }).where(eq(licenseKeysTable.key, normalizedKey));
      notifyLicenseActivated({ key: normalizedKey, minutesAllocated: license.minutesAllocated ?? 0, activatedAt: now, deviceId: null }).catch(() => {});
    }
    await db.update(licenseKeysTable).set({ lastUsedAt: new Date() }).where(eq(licenseKeysTable.key, normalizedKey));
    const allocatedSeconds = (license.minutesAllocated ?? 0) * 60;
    const usedSeconds = license.usedSeconds ?? 0;
    return res.json({
      valid: true,
      minutesAllocated: license.minutesAllocated ?? 0,
      remainingSeconds: Math.max(0, allocatedSeconds - usedSeconds),
      streamingEnabled: license.streamingEnabled,
    });
  } catch (err) { console.error("[license:validate]", err); return res.status(500).json({ valid: false, error: "Server error" }); }
});

// GET /api/license/status -- does NOT block on streamingEnabled (fixes #3)
// FIX: Include current active session's unbilled seconds so user dashboard
// always shows live remaining time while streaming (not just after stop).
router.get("/status", requireLicense, async (req, res) => {
  try {
    const license = (req as any).license;
    const allocatedSeconds = (license.minutesAllocated ?? 0) * 60;
    const usedSeconds = license.usedSeconds ?? 0;
    // Add unbilled seconds from any active session right now
    let effectiveUsedSeconds = usedSeconds;
    try {
      const [activeSession] = await db.select().from(sessionsTable)
        .where(and(eq(sessionsTable.licenseKeyId, license.id), eq(sessionsTable.status, "active")))
        .limit(1);
      if (activeSession) {
        const billingStart = activeSession.billingStartedAt ?? activeSession.startedAt;
        const sessionSeconds = Math.max(0, Math.floor((Date.now() - billingStart.getTime()) / 1000));
        effectiveUsedSeconds = Math.min(allocatedSeconds, usedSeconds + sessionSeconds);
      }
    } catch { /* non-fatal */ }
    const remainingSeconds = Math.max(0, allocatedSeconds - effectiveUsedSeconds);

    // TCE display layer — compute display_remaining (UX only, NEVER gates access)
    let displayRemainingSeconds = remainingSeconds;
    let cachedBillingRate: number | null = null;
    try {
      cachedBillingRate = await getBillingRateForLicense(license.id);
      displayRemainingSeconds = Math.round(remainingSeconds * computeCompressionFactor(cachedBillingRate));
    } catch { /* non-fatal — fall back to real seconds */ }

    let assignedApiKey: string | null = null;
    try {
      if ((license as any).assignedDecartKeyId) {
        const [dk] = await db.select().from(decartApiKeysTable)
          .where(eq(decartApiKeysTable.id, (license as any).assignedDecartKeyId)).limit(1);
        if (dk) assignedApiKey = dk.label;
      }
    } catch { /* column may not exist yet on older deployments */ }

    const remainingMinutes = remainingSeconds / 60;
    const minutesUsed = effectiveUsedSeconds / 60;
    return res.json({
      key: license.key,
      isActive: license.isActive,
      streamingEnabled: license.streamingEnabled,
      minutesAllocated: license.minutesAllocated ?? 0,
      usedSeconds: effectiveUsedSeconds,
      remainingSeconds,
      remainingMinutes,
      minutesUsed,
      minutesRemaining: remainingMinutes,
      creditsAllocated: (license as any).creditsAllocated ?? (license.minutesAllocated ?? 0),
      creditsUsed: (license as any).creditsUsed ?? minutesUsed,
      creditsRemaining: Math.max(0,
        ((license as any).creditsAllocated ?? license.minutesAllocated ?? 0) - minutesUsed
      ),
      assignedApiKey,
      expiresAt: license.expiresAt ?? null,
      activatedAt: license.activatedAt ?? null,
      lastUsedAt: license.lastUsedAt ?? null,
      createdAt: license.createdAt,
      // ── Consistency fields ────────────────────────────────────────────────────
      // FINAL TCE EXHAUSTION MODEL (DISPLAY-BOUND):
      //   Commercial exhaustion authority = displayRemainingSeconds (NOT realRemainingSeconds).
      //   Billing truth                   = real seconds (wallet.used_seconds).
      //   Profit analytics                = real seconds.
      //   Decart burn                     = real seconds.
      //   UX countdown / licenseStatus    = display seconds.
      //
      //   licenseStatus = "exhausted" when displayRemainingSeconds <= 0, even if
      //   realRemainingSeconds > 0 (hidden real balance is internal margin buffer only).
      realRemainingSeconds: remainingSeconds,
      realUsedSeconds:      effectiveUsedSeconds,
      displayRemainingSeconds,
      displayAllocatedSeconds: Math.round(
        (license.minutesAllocated ?? 0) * 60
        * (cachedBillingRate != null && cachedBillingRate > 0
            ? computeCompressionFactor(cachedBillingRate)
            : 1)
      ),
      licenseStatus: ((): string => {
        if (!license.isActive) return "revoked";
        if (license.expiresAt && license.expiresAt < new Date()) return "date_expired";
        // DISPLAY-BOUND exhaustion: commercial entitlement is controlled by displayRemainingSeconds.
        // realRemainingSeconds > 0 does NOT restore access once display time is exhausted.
        if (displayRemainingSeconds <= 0) return "exhausted";
        return "active";
      })(),
    });
  } catch (err) { console.error("[license:status]", err); return res.status(500).json({ error: "Server error" }); }
});

// POST /api/license/usage
router.post("/usage", requireLicense, async (req, res) => {
  try {
    const license = (req as any).license;
    const { secondsUsed } = req.body as { secondsUsed?: number };
    if (typeof secondsUsed !== "number" || secondsUsed < 0) return res.status(400).json({ error: "Invalid secondsUsed value" });
    const maxDeductable = Math.max(0, (license.minutesAllocated ?? 0) * 60 - (license.usedSeconds ?? 0));
    const actualDeduction = Math.min(secondsUsed, maxDeductable);
    const newUsedSeconds = (license.usedSeconds ?? 0) + actualDeduction;
    await db.update(licenseKeysTable).set({ usedSeconds: newUsedSeconds, lastUsedAt: new Date() }).where(eq(licenseKeysTable.id, license.id));
    return res.json({ success: true, usedSeconds: newUsedSeconds, remainingSeconds: Math.max(0, (license.minutesAllocated ?? 0) * 60 - newUsedSeconds) });
  } catch (err) { return res.status(500).json({ error: "Server error" }); }
});

// POST /api/license/generate -- admin can optionally select a specific Decart API key to assign
// Feature 1: pass `decartApiKeyId` in the request body to assign a specific key;
// if omitted, the first active key is used as before.
// Also records a financial transaction for the new license.
// Feature: pass `decartCredits` to auto-calculate minutesAllocated = decartCredits / 120
router.post("/generate", requireAdmin, async (req, res) => {
  try {
    const { notes, expiresAt, minutesAllocated, decartCredits, decartApiKeyId, pricingId } = req.body as {
      notes?: string;
      expiresAt?: string;
      minutesAllocated?: number;
      decartCredits?: number;
      decartApiKeyId?: number;
      pricingId?: number;
    };
    const key = [genSegment(), genSegment(), genSegment(), genSegment()].join("-");
    let assignedDecartKeyId: number | null = null;
    try {
      if (decartApiKeyId) {
        const [selectedKey] = await db.select()
          .from(decartApiKeysTable)
          .where(and(eq(decartApiKeysTable.id, decartApiKeyId), eq(decartApiKeysTable.isActive, true)))
          .limit(1);
        if (selectedKey) {
          assignedDecartKeyId = selectedKey.id;
        }
      } else {
        const [available] = await db.select()
          .from(decartApiKeysTable)
          .where(eq(decartApiKeysTable.isActive, true))
          .limit(1);
        if (available) {
          assignedDecartKeyId = available.id;
        }
      }
    } catch { /* column not yet migrated -- skip silently */ }

    // Calculate minutesAllocated: use decartCredits / 120 if provided, else use minutesAllocated
    const calculatedMinutes = decartCredits ? decartCredits / 120 : minutesAllocated ?? 0;
    const insertData: any = { key, notes: notes ?? null, expiresAt: expiresAt ? new Date(expiresAt) : null, minutesAllocated: calculatedMinutes };
    if (assignedDecartKeyId) insertData.assignedDecartKeyId = assignedDecartKeyId;
    await db.insert(licenseKeysTable).values(insertData);

    // Record financial transaction for new license
    try {
      let pricing = null;
      if (pricingId) {
        const [p] = await db.select().from(pricingTable).where(eq(pricingTable.id, pricingId)).limit(1);
        pricing = p;
      } else if (calculatedMinutes && calculatedMinutes > 0) {
        // Auto-select package by minutes allocated
        const [p] = await db.select().from(pricingTable)
          .where(and(eq(pricingTable.minutes, calculatedMinutes), eq(pricingTable.isActive, true)))
          .limit(1);
        pricing = p;
      }

      if (pricing) {
        const revenueUsd = parseFloat(pricing.priceUsd);
        const allocatedMinutes = calculatedMinutes;
        const apiCostPerMinute = parseFloat(pricing.apiCostPerMinuteUsd);
        const apiCostUsd = allocatedMinutes * apiCostPerMinute;
        const profitUsd = revenueUsd - apiCostUsd;
        const isLoss = profitUsd < 0;

        await db.insert(financialTransactionsTable).values({
          licenseKey: key,
          transactionType: "new_license",
          pricingId: pricing.id,
          packageLabel: pricing.label,
          minutesAllocated: allocatedMinutes,
          durationDays: null,
          revenueUsd: revenueUsd.toString(),
          revenueGhs: "0",
          apiCostPerMinuteUsd: apiCostPerMinute.toString(),
          apiCostUsd: apiCostUsd.toString(),
          profitUsd: profitUsd.toString(),
          isLoss,
          exchangeRateGhsPerUsd: "1",
          notes: notes ?? null,
          createdByAdminId: (req as any).user?.id ?? null,
        });
      }
    } catch (err) {
      console.error("[license:generate:financial-tx]", err);
      // Non-fatal: transaction recording failed, but license was created successfully
    }

    return res.json({ key, assignedDecartKeyId });
  } catch (err) { console.error("[license:generate]", err); return res.status(500).json({ error: "Server error" }); }
});

// PATCH /api/license/:key/reassign -- reassign an existing license to a different Decart API key
// Feature 2: send `{ decartApiKeyId: number | null }` to move a license to a different key.
// The assignment count in GET /admin/decart-keys updates automatically on the next fetch.
router.patch("/:key/reassign", requireAdmin, async (req, res) => {
  try {
    const licenseKeyStr = (req.params.key as string).toUpperCase();
    const { decartApiKeyId } = req.body as { decartApiKeyId: number | null };

    // Validate the license exists
    const [license] = await db.select()
      .from(licenseKeysTable)
      .where(eq(licenseKeysTable.key, licenseKeyStr))
      .limit(1);
    if (!license) return res.status(404).json({ error: "License key not found" });

    // If a specific Decart API key is provided, validate it exists and is active
    if (decartApiKeyId !== null && decartApiKeyId !== undefined) {
      const [newKey] = await db.select()
        .from(decartApiKeysTable)
        .where(and(eq(decartApiKeysTable.id, decartApiKeyId), eq(decartApiKeysTable.isActive, true)))
        .limit(1);
      if (!newKey) return res.status(404).json({ error: "Decart API key not found or inactive" });
    }

    // Update the license's assigned Decart API key
    await db.update(licenseKeysTable)
      .set({ assignedDecartKeyId: decartApiKeyId ?? null })
      .where(eq(licenseKeysTable.key, licenseKeyStr));

    // Immediately evict this license's cached Decart token so the very next
    // stream request fetches a fresh token from the newly assigned API key.
    // Also force the pool to reload so in-memory state stays consistent.
    invalidateLicenseTokenCache(licenseKeyStr);
    decartPool.load().catch(() => {});

    return res.json({ success: true, key: licenseKeyStr, assignedDecartKeyId: decartApiKeyId ?? null });
  } catch (err: any) {
    console.error("[license:reassign]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /api/license/list -- enriched with assigned API key label and live remaining minutes (fixes #8/#9)
// FIX: Account for active sessions when calculating remaining minutes, so admin view matches dashboard
router.get("/list", requireAdmin, async (_req, res) => {
  try {
    const licenses = await db.select().from(licenseKeysTable).orderBy(licenseKeysTable.createdAt);
    const enriched = await Promise.all(licenses.map(async lic => {
      let assignedApiKey: string | null = null;
      try {
        if ((lic as any).assignedDecartKeyId) {
          const [k] = await db.select().from(decartApiKeysTable)
            .where(eq(decartApiKeysTable.id, (lic as any).assignedDecartKeyId)).limit(1);
          if (k) assignedApiKey = k.label;
        }
      } catch { /* skip */ }

      // Calculate live remaining minutes accounting for active sessions (same logic as /status)
      const allocatedSeconds = (lic.minutesAllocated ?? 0) * 60;
      const usedSeconds = lic.usedSeconds ?? 0;
      let effectiveUsedSeconds = usedSeconds;
      try {
        const [activeSession] = await db.select().from(sessionsTable)
          .where(and(eq(sessionsTable.licenseKeyId, lic.id), eq(sessionsTable.status, "active")))
          .limit(1);
        if (activeSession) {
          const billingStart = activeSession.billingStartedAt ?? activeSession.startedAt;
          const sessionSeconds = Math.max(0, Math.floor((Date.now() - billingStart.getTime()) / 1000));
          effectiveUsedSeconds = Math.min(allocatedSeconds, usedSeconds + sessionSeconds);
        }
      } catch { /* non-fatal */ }
      const remainingSeconds = Math.max(0, allocatedSeconds - effectiveUsedSeconds);

      return { ...lic, assignedApiKey, usedSeconds: effectiveUsedSeconds, remainingSeconds };
    }));
    return res.json(enriched);
  } catch (err) { return res.status(500).json({ error: "Server error" }); }
});

router.put("/:key", requireAdmin, async (req, res) => {
  try {
    const { minutesAllocated, streamingEnabled, isActive, notes, expiresAt } = req.body;
    const updates: Record<string, any> = {};
    if (typeof minutesAllocated === "number") updates.minutesAllocated = minutesAllocated;
    if (typeof streamingEnabled === "boolean") updates.streamingEnabled = streamingEnabled;
    if (typeof isActive === "boolean") updates.isActive = isActive;
    if (typeof notes === "string") updates.notes = notes;
    if (expiresAt !== undefined) updates.expiresAt = expiresAt ? new Date(expiresAt) : null;
    await db.update(licenseKeysTable).set(updates).where(eq(licenseKeysTable.key, (req.params.key as string).toUpperCase()));
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Server error" }); }
});

router.delete("/:key/revoke", requireAdmin, async (req, res) => {
  try { await db.update(licenseKeysTable).set({ isActive: false }).where(eq(licenseKeysTable.key, (req.params.key as string).toUpperCase())); return res.json({ success: true }); }
  catch { return res.status(500).json({ error: "Server error" }); }
});

// PATCH /api/license/:key/bind -- bind a device to a license key (admin only)
// Enforces the single-device rule: if deviceId is already set, returns 409 Conflict.
// The admin must call DELETE /:key/unbind before binding a new device.
router.patch("/:key/bind", requireAdmin, async (req, res) => {
  try {
    const key = (req.params.key as string).toUpperCase();
    const { deviceId } = req.body as { deviceId?: string };
    if (!deviceId || !deviceId.trim()) {
      return res.status(400).json({ error: "deviceId is required" });
    }
    const [license] = await db.select()
      .from(licenseKeysTable)
      .where(eq(licenseKeysTable.key, key))
      .limit(1);
    if (!license) return res.status(404).json({ error: "License key not found" });
    if (license.deviceId) {
      return res.status(409).json({
        error: "License key is already bound to a device. Unbind it first.",
        boundDeviceId: license.deviceId,
      });
    }
    await db.update(licenseKeysTable)
      .set({ deviceId: deviceId.trim(), activatedAt: new Date() })
      .where(eq(licenseKeysTable.key, key));
    return res.json({ success: true, key, deviceId: deviceId.trim() });
  } catch (err: any) {
    console.error("[license:bind]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:key/unbind", requireAdmin, async (req, res) => {
  try { await db.update(licenseKeysTable).set({ deviceId: null, activatedAt: null }).where(eq(licenseKeysTable.key, (req.params.key as string).toUpperCase())); return res.json({ success: true }); }
  catch { return res.status(500).json({ error: "Server error" }); }
});

// POST /api/license/:key/renew -- renew an existing license and record financial transaction
router.post("/:key/renew", requireAdmin, async (req, res) => {
  try {
    const key = (req.params.key as string).toUpperCase();
    const { pricingId, expiresAt, minutesAllocated, decartCredits } = req.body as {
      pricingId?: number;
      expiresAt?: string;
      minutesAllocated?: number;
      decartCredits?: number;
    };

    const [license] = await db.select().from(licenseKeysTable)
      .where(eq(licenseKeysTable.key, key))
      .limit(1);
    if (!license) return res.status(404).json({ error: "License key not found" });

    // Calculate minutesAllocated: use decartCredits / 120 if provided, else use minutesAllocated
    const calculatedMinutes = decartCredits ? decartCredits / 120 : minutesAllocated;

    // Get pricing info
    let pricing = null;
    if (pricingId) {
      const [p] = await db.select().from(pricingTable).where(eq(pricingTable.id, pricingId)).limit(1);
      pricing = p;
    } else if (calculatedMinutes && calculatedMinutes > 0) {
      const [p] = await db.select().from(pricingTable)
        .where(and(eq(pricingTable.minutes, calculatedMinutes), eq(pricingTable.isActive, true)))
        .limit(1);
      pricing = p;
    }

    if (!pricing) return res.status(400).json({ error: "Invalid or missing pricing package" });

    // Update license
    const updateData: Record<string, any> = {};
    if (calculatedMinutes !== undefined) updateData.minutesAllocated = calculatedMinutes;
    if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
    // FIX (Bug #4): reset usage counter + device binding on renewal.
    // This gives the renewed license fresh minutes and lets it auto-bind
    // to whichever device enters the key first after renewal.
    updateData.usedSeconds = 0;      // fresh minutes start at zero
    updateData.deviceId = null;       // release device lock so new device can bind
    updateData.activatedAt = null;    // clear prior activation timestamp
    await db.update(licenseKeysTable).set(updateData).where(eq(licenseKeysTable.key, key));

    // Record financial transaction for renewal
    try {
      const revenueUsd = parseFloat(pricing.priceUsd);
      const allocatedMinutes = calculatedMinutes ?? pricing.minutes;
      const apiCostPerMinute = parseFloat(pricing.apiCostPerMinuteUsd);
      const apiCostUsd = allocatedMinutes * apiCostPerMinute;
      const profitUsd = revenueUsd - apiCostUsd;
      const isLoss = profitUsd < 0;

      await db.insert(financialTransactionsTable).values({
        licenseKey: key,
        transactionType: "renewal",
        pricingId: pricing.id,
        packageLabel: pricing.label,
        minutesAllocated: allocatedMinutes,
        durationDays: null,
        revenueUsd: revenueUsd.toString(),
        revenueGhs: "0",
        apiCostPerMinuteUsd: apiCostPerMinute.toString(),
        apiCostUsd: apiCostUsd.toString(),
        profitUsd: profitUsd.toString(),
        isLoss,
        exchangeRateGhsPerUsd: "1",
        createdByAdminId: (req as any).user?.id ?? null,
      });
    } catch (err) {
      console.error("[license:renew:financial-tx]", err);
    }

    return res.json({ success: true, key });
  } catch (err: any) {
    console.error("[license:renew]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:key", requireAdmin, async (req, res) => {
  try {
    const key = (req.params.key as string).toUpperCase();
    // Look up the license to get its numeric id (needed for FK-linked sessions)
    const [license] = await db.select({ id: licenseKeysTable.id })
      .from(licenseKeysTable)
      .where(eq(licenseKeysTable.key, key))
      .limit(1);
    if (!license) return res.status(404).json({ error: "License key not found" });

    // Delete sessions linked to this license first (FK constraint)
    await db.delete(sessionsTable).where(eq(sessionsTable.licenseKeyId, license.id));

    // Now safe to delete the license key itself
    await db.delete(licenseKeysTable).where(eq(licenseKeysTable.id, license.id));

    // Note: financial_transactions records for this license are preserved (no cascade delete)

    return res.json({ success: true });
  } catch (err: any) {
    console.error("[license:delete]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
