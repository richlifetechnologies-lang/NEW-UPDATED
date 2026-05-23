/**
 * admin-token-window.ts — Token Window Monitoring + Configuration
 *
 * Provides:
 *  GET  /api/admin/token-window/sessions  — live active session monitoring with token window info
 *  GET  /api/admin/token-window/global    — get/set global default token window
 *  PUT  /api/admin/token-window/global    — update global default token window
 *  GET  /api/admin/token-window/sub-admin/:id  — get sub-admin default token window
 *  PUT  /api/admin/token-window/sub-admin/:id  — set sub-admin default token window
 *  PUT  /api/admin/token-window/key/:licenseKey — set per-key token window
 */

import { Router } from "express";
import { db, licenseKeysTable, sessionsTable, decartApiKeysTable, settingsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router = Router();

const GLOBAL_TOKEN_WINDOW_KEY = "global_default_token_window_minutes";
const FALLBACK_TOKEN_WINDOW_MIN = 15; // default if nothing configured

/** Resolve the effective token window for a license key (same logic as decart.ts) */
async function resolveTokenWindowMinutes(license: any): Promise<number> {
  // 1. Per-key override (highest priority)
  if (license.tokenWindowMinutes != null && license.tokenWindowMinutes > 0) {
    return license.tokenWindowMinutes;
  }

  // 2. Sub-admin default
  if (license.createdBySubAdminId) {
    try {
      const result = await db.execute(
        `SELECT default_token_window_minutes FROM users WHERE id = ${license.createdBySubAdminId} AND is_sub_admin = 1 LIMIT 1`
      );
      const row = result.rows[0] as any;
      if (row?.default_token_window_minutes != null && row.default_token_window_minutes > 0) {
        return row.default_token_window_minutes;
      }
    } catch { /* non-fatal */ }
  }

  // 3. Global default from settings table
  try {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, GLOBAL_TOKEN_WINDOW_KEY));
    if (row?.value) {
      const v = parseFloat(row.value);
      if (v > 0) return v;
    }
  } catch { /* non-fatal */ }

  return FALLBACK_TOKEN_WINDOW_MIN;
}

// GET /api/admin/token-window/sessions — live session state with token window info
router.get("/sessions", requireAdmin, async (_req, res) => {
  try {
    const activeSessions = await db.select({
      id: sessionsTable.id,
      licenseKeyId: sessionsTable.licenseKeyId,
      decartKeyId: sessionsTable.decartKeyId,
      startedAt: sessionsTable.startedAt,
      lastHeartbeatAt: sessionsTable.lastHeartbeatAt,
      status: sessionsTable.status,
    })
      .from(sessionsTable)
      .where(eq(sessionsTable.status, "active"));

    const enriched = await Promise.all(activeSessions.map(async (session) => {
      let licenseKey = "—";
      let apiKeyLabel = "—";
      let tokenWindowMinutes = FALLBACK_TOKEN_WINDOW_MIN;
      let minutesAllocated = 0;
      let usedSeconds = 0;
      let licenseIsNewKey = false;

      if (session.licenseKeyId) {
        try {
          const [lic] = await db.select().from(licenseKeysTable)
            .where(eq(licenseKeysTable.id, session.licenseKeyId)).limit(1);
          if (lic) {
            licenseKey = lic.key;
            minutesAllocated = lic.minutesAllocated ?? 0;
            usedSeconds = lic.usedSeconds ?? 0;
            licenseIsNewKey = !!(lic as any).isNewKey;
            tokenWindowMinutes = await resolveTokenWindowMinutes(lic);
          }
        } catch { /* non-fatal */ }
      }

      if (session.decartKeyId) {
        try {
          const [dk] = await db.select().from(decartApiKeysTable)
            .where(eq(decartApiKeysTable.id, session.decartKeyId)).limit(1);
          if (dk) apiKeyLabel = dk.label;
        } catch { /* non-fatal */ }
      }

      const now = Date.now();
      const sessionStartMs = new Date(session.startedAt).getTime();
      const elapsedMs = now - sessionStartMs;
      const elapsedMinutes = elapsedMs / 60000;
      const tokenWindowMs = tokenWindowMinutes * 60 * 1000;
      const remainingTokenMs = Math.max(0, tokenWindowMs - elapsedMs);
      const remainingTokenMinutes = remainingTokenMs / 60000;

      let sessionStatus: "ACTIVE" | "EXPIRED" | "BLOCKED" | "TERMINATED";
      if (session.status !== "active") {
        sessionStatus = "TERMINATED";
      } else if (elapsedMinutes >= tokenWindowMinutes) {
        sessionStatus = "EXPIRED";
      } else {
        sessionStatus = "ACTIVE";
      }

      return {
        sessionId: session.id,
        licenseKey,
        apiKey: apiKeyLabel,
        tokenWindowMinutes,
        remainingTokenMinutes: Math.round(remainingTokenMinutes * 100) / 100,
        elapsedMinutes: Math.round(elapsedMinutes * 100) / 100,
        sessionStartTime: session.startedAt,
        lastHeartbeatAt: session.lastHeartbeatAt,
        sessionStatus,
        decartStreamStatus: session.status === "active" ? "RUNNING" : "STOPPED",
        minutesAllocated,
        remainingWalletSeconds: Math.max(0, minutesAllocated * 60 - usedSeconds),
        isNewKey: licenseIsNewKey,
      };
    }));

    res.json({ sessions: enriched, count: enriched.length });
  } catch (err) {
    console.error("[token-window:sessions]", err);
    res.status(500).json({ error: "Failed to load session data" });
  }
});

// GET /api/admin/token-window/global — get global default token window
router.get("/global", requireAdmin, async (_req, res) => {
  try {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, GLOBAL_TOKEN_WINDOW_KEY));
    const minutes = row?.value ? parseFloat(row.value) : FALLBACK_TOKEN_WINDOW_MIN;
    res.json({ globalDefaultTokenWindowMinutes: minutes });
  } catch (err) {
    res.status(500).json({ error: "Failed to read global token window" });
  }
});

// PUT /api/admin/token-window/global — update global default token window
router.put("/global", requireAdmin, async (req, res) => {
  const { minutes } = req.body as { minutes?: number };
  if (!minutes || typeof minutes !== "number" || minutes < 1 || minutes > 480) {
    res.status(400).json({ error: "minutes must be a number between 1 and 480" });
    return;
  }
  try {
    await db.insert(settingsTable)
      .values({ key: GLOBAL_TOKEN_WINDOW_KEY, value: String(minutes) })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: String(minutes) } });
    res.json({ success: true, globalDefaultTokenWindowMinutes: minutes });
  } catch (err) {
    res.status(500).json({ error: "Failed to update global token window" });
  }
});

// GET /api/admin/token-window/sub-admin/:id — get sub-admin token window
router.get("/sub-admin/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid sub-admin ID" }); return; }
  try {
    await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS default_token_window_minutes REAL`).catch(() => {});
    const result = await db.execute(
      `SELECT id, username, email, default_token_window_minutes FROM users WHERE id = ${id} AND is_sub_admin = 1 LIMIT 1`
    );
    if (!result.rows.length) { res.status(404).json({ error: "Sub-admin not found" }); return; }
    const row = result.rows[0] as any;
    res.json({
      id: row.id,
      username: row.username,
      email: row.email,
      defaultTokenWindowMinutes: row.default_token_window_minutes ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to read sub-admin token window" });
  }
});

// PUT /api/admin/token-window/sub-admin/:id — set sub-admin default token window
router.put("/sub-admin/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid sub-admin ID" }); return; }
  const { minutes } = req.body as { minutes?: number | null };
  if (minutes !== null && minutes !== undefined && (typeof minutes !== "number" || minutes < 1 || minutes > 480)) {
    res.status(400).json({ error: "minutes must be a number between 1 and 480, or null to clear" });
    return;
  }
  try {
    await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS default_token_window_minutes REAL`).catch(() => {});
    const val = minutes === null || minutes === undefined ? "NULL" : String(minutes);
    await db.execute(
      `UPDATE users SET default_token_window_minutes = ${val} WHERE id = ${id} AND is_sub_admin = 1`
    );
    res.json({ success: true, id, defaultTokenWindowMinutes: minutes ?? null });
  } catch (err) {
    res.status(500).json({ error: "Failed to update sub-admin token window" });
  }
});

// PUT /api/admin/token-window/key/:licenseKey — set per-key token window override
router.put("/key/:licenseKey", requireAdmin, async (req, res) => {
  const licenseKey = (req.params.licenseKey as string).toUpperCase();
  const { minutes } = req.body as { minutes?: number | null };
  if (minutes !== null && minutes !== undefined && (typeof minutes !== "number" || minutes < 1 || minutes > 480)) {
    res.status(400).json({ error: "minutes must be a number between 1 and 480, or null to clear" });
    return;
  }
  try {
    await db.execute(`ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS token_window_minutes REAL`).catch(() => {});
    await db.execute(`ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS is_new_key BOOLEAN DEFAULT FALSE`).catch(() => {});
    const [existing] = await db.select().from(licenseKeysTable).where(eq(licenseKeysTable.key, licenseKey)).limit(1);
    if (!existing) { res.status(404).json({ error: "License key not found" }); return; }
    await db.update(licenseKeysTable)
      .set({ tokenWindowMinutes: minutes ?? null } as any)
      .where(eq(licenseKeysTable.key, licenseKey));
    res.json({ success: true, key: licenseKey, tokenWindowMinutes: minutes ?? null });
  } catch (err) {
    res.status(500).json({ error: "Failed to update key token window" });
  }
});

  // DELETE /api/admin/token-window/bulk-clear — clear token_window_minutes on ALL license keys
  // This makes every key fall back to the global/sub-admin/system default (30s hard cap).
  router.delete("/bulk-clear", requireAdmin, async (_req, res) => {
    try {
      await db.execute(`ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS token_window_minutes REAL`).catch(() => {});
      const result = await db.execute(
        `UPDATE license_keys SET token_window_minutes = NULL WHERE token_window_minutes IS NOT NULL`
      );
      const affected = (result as any).rowCount ?? (result as any).rowsAffected ?? 0;
      res.json({ success: true, clearedCount: affected, message: `Cleared token_window_minutes from ${affected} license key(s). All keys now use the system default.` });
    } catch (err) {
      console.error("[token-window:bulk-clear]", err);
      res.status(500).json({ error: "Failed to bulk-clear token window overrides" });
    }
  });
  
export default router;
