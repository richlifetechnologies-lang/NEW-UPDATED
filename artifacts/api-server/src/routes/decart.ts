import { Router } from "express";
import { createDecartClient } from "@decartai/sdk";
import { requireLicense } from "../lib/auth";
import { decartPool } from "../lib/decart-pool";
import { db, decartApiKeysTable, sessionsTable, licenseKeysTable } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";

const router = Router();

// ---- In-process rate limiter (by license key) --------------------------------
const RATE_LIMIT_MAX    = 10;
const RATE_LIMIT_WINDOW = 60_000; // 1 minute

interface RateLimitEntry { count: number; resetAt: number }
const rateLimitStore = new Map<string, RateLimitEntry>();

// ---- Token cache (by license key) --------------------------------
interface CachedToken { apiKey: string; expiresAt: number; sourceKeyId: number }
const tokenCache = new Map<string, CachedToken>();

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
  sourceKeyId: number
): Promise<{ apiKey: string; expiresAt: number } | null> {
  const now = Date.now();
  const cached = tokenCache.get(licenseKey);

  // Reuse token if still valid AND was issued for the SAME API key.
  // FIX (Bug #3): invalidate cache when license is reassigned to a different
  // Decart API key so the old key's token is never used for the new key.
  if (cached && cached.expiresAt - now > 30000 && cached.sourceKeyId === sourceKeyId) {
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

  if (remainingSeconds <= 0) {
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
    // FIX (Quality): SESSION DURATION — was capped at 60s causing streams
    // to disconnect every minute. Now uses the user's full remaining license
    // time (up to 4 hours) so a session can run continuously without breaks.
    const TOKEN_CAP_SEC = Math.min(remainingSeconds, 4 * 3600); // up to 4h
    const tokenWindow = TOKEN_CAP_SEC;
    const tokenResult = await getOrCreateToken(licenseKey, resolvedKey.apiKey, tokenWindow, resolvedKey.id);

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
 * Call this after admin reassigns a license key to a different Decart API key
 * so the very next stream request fetches a fresh token from the new key
 * instead of reusing the old key's token for up to 30+ more seconds.
 */
export function invalidateLicenseTokenCache(licenseKey: string): void {
  tokenCache.delete(licenseKey.trim().toUpperCase());
}

export default router;
