import { Router } from "express";
import { createDecartClient } from "@decartai/sdk";
import { requireLicense } from "../lib/auth";
import { decartPool } from "../lib/decart-pool";
import { db, decartApiKeysTable, sessionsTable, licenseKeysTable, settingsTable, usersTable } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { getBillingRateForLicense } from "../lib/billing-rate-cache";
import { computeCompressionFactor, computeDisplaySeconds, licenseRemainingSeconds } from "../lib/billing-math";
import { logSessionBillingEvent } from "../lib/session-billing-logger";

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

// FIX (BUG-017): Periodically evict expired entries so the cache doesn't grow
// unboundedly when many unique license keys authenticate but never stream again.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of tokenCache) {
    if (entry.expiresAt <= now) tokenCache.delete(key);
  }
}, 10 * 60 * 1000); // every 10 minutes

// TOKEN_WINDOW_SEC — fallback default when no per-key/sub-admin/global window is set.
// RC#1 FIX: was 15 * 60 (15 min) which caused Decart to reserve/pre-charge up to
// 15 minutes of credits at realtime.connect() time. Hard-capped to 90 seconds so
// the worst-case Decart reservation is 90 × 2.3 = 207 credits per session start.
// OPTION-B FIX: Further reduced from 90s → 30s. Combined with the client-side
// 25-second token refresh loop, this caps worst-case freeze credit drain to
// 30 × 2 = 60 credits (was 180) while seamlessly extending healthy sessions
// by pre-warming a fresh token before the window expires.
const TOKEN_WINDOW_SEC_DEFAULT = 30; // 30s cap — limits freeze drain to 60 credits max
// RC#1: Absolute hard cap applied AFTER any per-key/sub-admin/global override.
// Ensures no configuration path can accidentally restore a large reservation window.
const TOKEN_WINDOW_HARD_CAP_SEC = 30;

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
    // NOTE: In this system the admin always sets tokenWindowMinutes per key (priority 1 above).
    // This path is a safety fallback for keys created before per-key windows were enforced.
    const subAdminId = (license as any).createdBySubAdminId;
    if (subAdminId) {
      try {
        // FIX (BUG-003): replaced raw SQL string interpolation with parameterized ORM query
        const [saRow] = await db
          .select({ defaultTokenWindowMinutes: usersTable.defaultTokenWindowMinutes })
          .from(usersTable)
          .where(and(eq(usersTable.id, subAdminId), eq(usersTable.isSubAdmin, 1)))
          .limit(1);
        if (saRow?.defaultTokenWindowMinutes != null && saRow.defaultTokenWindowMinutes > 0) {
          return Math.round(saRow.defaultTokenWindowMinutes * 60);
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
): Promise<{ apiKey: string; expiresAt: number; _cacheHit: boolean } | null> {
  // FIX (BUG-002): normalize to uppercase so cache set/get/delete all use the same key.
  // Previously tokenCache.set used raw case but invalidateLicenseTokenCache used
  // .toUpperCase(), causing silent cache-miss on deletion and stale tokens persisting.
  const normalizedKey = licenseKey.trim().toUpperCase();
  const now = Date.now();
  const cached = tokenCache.get(normalizedKey);

  // Wallet-window validation: discard cached token if wallet shrank below its window.
  // A stale token with tokenWindowSec > currentRemainingSeconds would allow a Decart
  // session longer than the user's wallet can cover.
  if (cached && cached.tokenWindowSec > currentRemainingSeconds) {
    tokenCache.delete(normalizedKey);
  } else if (
    cached &&
    cached.expiresAt - now > 30_000 &&
    cached.sourceKeyId === sourceKeyId
  ) {
    // Reuse token if still valid AND was issued for the SAME API key.
    // FIX (Bug #3): invalidate cache when license is reassigned to a different
    // Decart API key so the old key's token is never used for the new key.
    return { apiKey: cached.apiKey, expiresAt: cached.expiresAt, _cacheHit: true };
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

  tokenCache.set(normalizedKey, cached_token);
  return { apiKey: tokenResponse.apiKey, expiresAt: expiresAtMs, _cacheHit: false };
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
    // Dynamic token window: resolve per-key > sub-admin > global > fallback.
    // RC#1: Hard-cap to TOKEN_WINDOW_HARD_CAP_SEC (90s) AFTER all overrides.
    // This ensures no admin config can accidentally restore a large reservation
    // window that causes Decart to pre-charge minutes of credits at connect time.
    const resolvedWindowSec = await resolveTokenWindowSec(license);
    const tokenWindow = Math.min(remainingSeconds, Math.min(resolvedWindowSec, TOKEN_WINDOW_HARD_CAP_SEC));
    const tokenResult = await getOrCreateToken(licenseKey, resolvedKey.apiKey, tokenWindow, resolvedKey.id, remainingSeconds);

    if (!tokenResult) {
      decartPool.reportFailure(resolvedKey.id);
      res.status(503).json({ error: "Decart API returned no token. Please verify your API key is active." });
      return;
    }

    decartPool.reportSuccess(resolvedKey.id);

    // ── Observability: log token_issued / token_cache_hit ──────────────────────
    // True fire-and-forget via setImmediate — NEVER blocks the response pipeline.
    // Capture all closure variables by value before the async boundary.
    const _cacheHit = tokenResult._cacheHit === true;
    const _licenseKey = licenseKey;
    const _remainingSeconds = remainingSeconds;
    const _tokenWindow = tokenWindow;
    const _resolvedKeyId = resolvedKey.id;
    setImmediate(() => {
      (async () => {
        try {
          const [activeLic] = await db.select({ id: licenseKeysTable.id })
            .from(licenseKeysTable).where(eq(licenseKeysTable.key, _licenseKey)).limit(1);
          if (!activeLic) return;
          const [activeS] = await db.select({ id: sessionsTable.id })
            .from(sessionsTable)
            .where(and(eq(sessionsTable.licenseKeyId, activeLic.id), eq(sessionsTable.status, "active")))
            .limit(1);
          if (!activeS) return;
          logSessionBillingEvent({
            sessionId: activeS.id,
            eventType: _cacheHit ? "token_cache_hit" : "token_issued",
            walletRemainingSeconds: _remainingSeconds,
            tokenWindowSeconds: _tokenWindow,
            metadata: { cacheHit: _cacheHit, resolvedKeyId: _resolvedKeyId },
          });
        } catch { /* non-fatal */ }
      })();
    });

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
  return tokenCache.get(licenseKey.trim().toUpperCase())?.sourceKeyId ?? null;
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
