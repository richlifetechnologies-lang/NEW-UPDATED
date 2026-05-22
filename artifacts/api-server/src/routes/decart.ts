import { Router } from "express";
import { createDecartClient } from "@decartai/sdk";
import { requireLicense } from "../lib/auth";
import { decartPool } from "../lib/decart-pool";
import { db, decartApiKeysTable, sessionsTable, licenseKeysTable, settingsTable } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { getBillingRateForLicense } from "../lib/billing-rate-cache";
import { computeCompressionFactor, computeDisplaySeconds, licenseRemainingSeconds } from "../lib/billing-math";

const router = Router();

// ---- In-process rate limiter (by license key) --------------------------------
const RATE_LIMIT_MAX    = 10;
const RATE_LIMIT_WINDOW = 60_000; // 1 minute

interface RateLimitEntry { count: number; resetAt: number }
const rateLimitStore = new Map<string, RateLimitEntry>();

// ---- Token cache (by license key) --------------------------------
// tokenWindowSec is stored so wallet-window validation can detect when the
// cached token's original window exceeds the current wallet balance.
interface CachedToken {
  apiKey: string;
  expiresAt: number;
  sourceKeyId: number;
  tokenWindowSec: number; // window used at creation time — for wallet-window validation
}
const tokenCache = new Map<string, CachedToken>();

// TOKEN_WINDOW_SEC — fallback default when no per-key/sub-admin/global window is set.
// BUG #1 FIX: was Math.min(remainingSeconds, 4 * 3600) which caused Decart to
// pre-charge or pre-reserve the FULL remaining licence time (e.g. 4 hours) at
// token-creation time. Cap to 15 minutes so each token covers one streaming
// session without pre-charging hours of credits up-front.
// The frontend tokenRefreshRef fetches a new token when the current one nears expiry.
const TOKEN_WINDOW_SEC_DEFAULT = 15 * 60; // 15 minutes fallback

const GLOBAL_TOKEN_WINDOW_SETTING = "global_default_token_window_minutes";

/**
 * Resolve the effective token window in seconds for a license.
 * Priority: licenceKey.tokenWindowMinutes > subAdmin.defaultTokenWindowMinutes > global setting > hardcoded default
 * Never throws — falls back to TOKEN_WINDOW_SEC_DEFAULT on any error.
 */
async function resolveTokenWindowSec(license: any): Promise<number> {
  try {
    // 1. Per-key override (highest priority)
    const keyWindow = (license as any).tokenWindowMinutes;
    if (keyWindow != null && keyWindow > 0) {
      return Math.round(keyWindow * 60);
    }

    // 2. Sub-admin default
    const subAdminId = (license as any).createdBySubAdminId;
    if (subAdminId) {
      try {
        const result = await db.execute(
          `SELECT default_token_window_minutes FROM users WHERE id = ${subAdminId} AND is_sub_admin = 1 LIMIT 1`
        );
        const row = result.rows[0] as any;
        if (row?.default_token_window_minutes != null && row.default_token_window_minutes > 0) {
          return Math.round(row.default_token_window_minutes * 60);
        }
      } catch { /* non-fatal */ }
    }

    // 3. Global default from settings
    try {
      const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, GLOBAL_TOKEN_WINDOW_SETTING));
      if (row?.value) {
        const v = parseFloat(row.value);
        if (v > 0) return Math.round(v * 60);
      }
    } catch { /* non-fatal */ }
  } catch { /* non-fatal */ }

  return TOKEN_WINDOW_SEC_DEFAULT;
}

function checkRateLimit(licenseKey: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(licenseKey);
  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(licenseKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }
  entry.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now >= entry.resetAt) rateLimitStore.delete(key);
  }
}, 60_000);

async function getOrCreateToken(
  licenseKey: string,
  apiKeyToUse: string,
  tokenWindowSec: number,
  sourceKeyId: number,
  currentRemainingSeconds: number
): Promise<{ apiKey: string; expiresAt: number } | null> {
  const now = Date.now();
  const cached = tokenCache.get(licenseKey);

  // Wallet-window validation: discard cached token if wallet shrank below its window.
  // A stale token with tokenWindowSec > currentRemainingSeconds would allow a Decart
  // session longer than the user's wallet can cover.
  if (cached && cached.tokenWindowSec > currentRemainingSeconds) {
    tokenCache.delete(licenseKey);
  } else if (
    cached &&
    cached.expiresAt - now > 30_000 &&
    cached.sourceKeyId === sourceKeyId
  ) {
    // Reuse token if still valid AND was issued for the SAME API key.
    // FIX (Bug #3): invalidate cache when license is reassigned to a different
    // Decart API key so the old key's token is never used for the new key.
    return { apiKey: cached.apiKey, expiresAt: cached.expiresAt };
  }

  // Create new token
  const client = createDecartClient({ apiKey: apiKeyToUse });
  const tokenResponse = await client.tokens.create({
    expiresIn: tokenWindowSec,
    allowedModels: ["lucy-2.1"],
    constraints: { realtime: { maxSessionDuration: tokenWindowSec } },
  });

  if (!tokenResponse?.apiKey) {
    return null;
  }

  // Convert expiresAt string to ms timestamp
  const expiresAtMs = new Date(tokenResponse.expiresAt).getTime();
  const cached_token: CachedToken = {
    apiKey: tokenResponse.apiKey,
    expiresAt: expiresAtMs,
    sourceKeyId,
    tokenWindowSec, // store for wallet-window validation on next reuse
  };

  tokenCache.set(licenseKey, cached_token);
  return { apiKey: tokenResponse.apiKey, expiresAt: expiresAtMs };
}

// GET /api/decart/token -- returns a short-lived Decart streaming token for licensed users
router.get("/token", requireLicense, async (req, res) => {
  const license    = (req as any).license;
  const licenseKey = (req as any).licenseKey as string;

  const { allowed, retryAfterMs } = checkRateLimit(licenseKey);
  if (!allowed) {
    res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
    res.status(429).json({ error: "Too many token requests. Please wait before retrying." });
    return;
  }

  const allocatedSeconds = (license.minutesAllocated ?? 0) * 60;
  const usedSeconds      = license.usedSeconds ?? 0;
  const remainingSeconds = Math.max(0, allocatedSeconds - usedSeconds);

  // FINAL TCE EXHAUSTION MODEL (DISPLAY-BOUND):
  // Token issuance is gated on displayRemainingSeconds, NOT realRemainingSeconds.
  // Hidden real balance after display exhaustion is internal margin buffer only —
  // it MUST NOT grant a new streaming token. Billing/wallet remain unchanged.
  let displayRemainingSeconds = remainingSeconds;
  try {
    const billingRate = await getBillingRateForLicense(license.id);
    displayRemainingSeconds = computeDisplaySeconds(remainingSeconds, computeCompressionFactor(billingRate));
  } catch { /* non-fatal — fall back to real seconds */ }

  if (displayRemainingSeconds <= 0) {
    res.status(402).json({ error: "No streaming time remaining on this license.", code: "LICENSE_EXHAUSTED" });
    return;
  }

  // First try to use the Decart API key specifically assigned to this license
  let resolvedKey: { id: number; apiKey: string } | null = null;

  if (license.assignedDecartKeyId) {
    try {
      const [assignedKey] = await db.select()
        .from(decartApiKeysTable)
        .where(eq(decartApiKeysTable.id, license.assignedDecartKeyId))
        .limit(1);
      if (assignedKey?.isActive) {
        resolvedKey = { id: assignedKey.id, apiKey: assignedKey.apiKey };
      }
    } catch {
      // If assigned key lookup fails, fall through to pool
    }
  }

  // Fall back to shared pool if no assigned key is available
  if (!resolvedKey) {
    resolvedKey = await decartPool.getHealthyKey();
  }

  if (!resolvedKey) {
    res.status(503).json({ error: "No Decart API keys available. Please contact support." });
    return;
  }

  try {
    // Dynamic token window: resolve per-key > sub-admin > global > fallback (15 min).
    // Cap to remaining seconds so we never pre-reserve more than what's left.
    const resolvedWindowSec = await resolveTokenWindowSec(license);
    const tokenWindow = Math.min(remainingSeconds, resolvedWindowSec);
    const tokenResult = await getOrCreateToken(licenseKey, resolvedKey.apiKey, tokenWindow, resolvedKey.id, remainingSeconds);

    if (!tokenResult) {
      decartPool.reportFailure(resolvedKey.id);
      res.status(503).json({ error: "Decart API returned no token. Please verify your API key is active." });
      return;
    }

    decartPool.reportSuccess(resolvedKey.id);

    // Track which Decart key served this session (for credit tracking)
    try {
      const [activeLicense] = await db
        .select({ id: licenseKeysTable.id })
        .from(licenseKeysTable)
        .where(eq(licenseKeysTable.key, licenseKey))
        .limit(1);

      if (activeLicense) {
        await db
          .update(sessionsTable)
          .set({ decartKeyId: resolvedKey.id })
          .where(
            and(
              eq(sessionsTable.licenseKeyId, activeLicense.id),
              eq(sessionsTable.status, "active"),
              isNull(sessionsTable.decartKeyId)
            )
          );
      }
    } catch (trackErr) {
      // Non-fatal: don't block token response if tracking fails
    }

    res.json({ apiKey: tokenResult.apiKey, expiresAt: new Date(tokenResult.expiresAt).toISOString(), remainingSeconds });
  } catch (err: any) {
    const status        = err?.response?.status ?? 0;
    const isRateLimited = status === 429;
    const isServerError = status >= 500;
    if (isRateLimited || isServerError) decartPool.reportFailure(resolvedKey.id);
    const msg = isRateLimited ? "Decart API is rate limited. Please retry in a moment." : "Failed to obtain streaming token.";
    res.status(isRateLimited ? 429 : 500).json({ error: msg });
  }
});

/**
 * Returns the Decart API key ID currently cached for a given license key.
 * Used by the sessions heartbeat as a fallback to link sessions to their
 * Decart key for credit tracking when decartKeyId is still null on the row.
 */
export function getDecartKeyIdFromCache(licenseKey: string): number | null {
  return tokenCache.get(licenseKey)?.sourceKeyId ?? null;
}

/**
 * Evict the cached token for a license key immediately.
 * Call this after:
 *   - Admin reassigns a license key to a different Decart API key
 *   - Session wallet becomes exhausted (heartbeat no_time)
 *   - Session is stopped or settled by the orphan sweeper
 *   - Admin force-stops a session
 */
export function invalidateLicenseTokenCache(licenseKey: string): void {
  tokenCache.delete(licenseKey.trim().toUpperCase());
}

export default router;
