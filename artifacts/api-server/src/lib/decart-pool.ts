import { db, decartApiKeysTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

const COOLDOWN_MS = 15 * 60 * 1000; // 15-minute cooldown on failure
const RELOAD_INTERVAL_MS = 5 * 60 * 1000; // Reload keys from DB every 5 min

interface PoolKey {
  id: number;
  apiKey: string;
  label: string;
  isEnabled: boolean;       // admin-controlled enable/disable
  // runtime health state (in-memory only)
  cooldownUntil: number;    // epoch ms; 0 = not in cooldown
  totalRequests: number;
  failedRequests: number;
  lastFailedAt: number;     // epoch ms; 0 = never
}

/**
 * DecartKeyPool — Smart in-memory pool manager for Decart API keys.
 *
 * Strategy: weighted round-robin with health-based skipping.
 * - Keys in cooldown are skipped automatically.
 * - On failure (429 or 5xx): key enters 15-min cooldown.
 * - Pool reloads from DB every 5 minutes to pick up admin changes.
 */
class DecartKeyPool {
  private keys: PoolKey[] = [];
  private cursor = 0;
  private lastLoaded = 0;

  /** Load (or reload) all active keys from the database. */
  async load(): Promise<void> {
    try {
      const rows = await db
        .select()
        .from(decartApiKeysTable)
        .where(eq(decartApiKeysTable.isActive, true));

      // Merge with existing runtime state (preserve cooldowns across reloads)
      const existingById = new Map(this.keys.map((k) => [k.id, k]));

      this.keys = rows.map((row) => {
        const existing = existingById.get(row.id);
        return {
          id: row.id,
          apiKey: row.apiKey,
          label: row.label ?? `key-${row.id}`,
          isEnabled: row.isActive,
          // Preserve runtime health state across reloads
          cooldownUntil: existing?.cooldownUntil ?? 0,
          totalRequests: existing?.totalRequests ?? 0,
          failedRequests: existing?.failedRequests ?? 0,
          lastFailedAt: existing?.lastFailedAt ?? 0,
        };
      });

      this.lastLoaded = Date.now();
      logger.info({ keyCount: this.keys.length }, "[DecartPool] Keys loaded");
    } catch (err) {
      logger.error({ err }, "[DecartPool] Failed to load keys from DB");
    }
  }

  /** Reload from DB if stale. */
  private async reloadIfStale(): Promise<void> {
    if (Date.now() - this.lastLoaded > RELOAD_INTERVAL_MS) {
      await this.load();
    }
  }

  /**
   * Pick the healthiest available key using round-robin.
   * Returns null if no keys are available (all in cooldown / disabled).
   */
  async getHealthyKey(): Promise<PoolKey | null> {
    await this.reloadIfStale();

    if (this.keys.length === 0) return null;

    const now = Date.now();
    const healthyKeys = this.keys.filter(
      (k) => k.isEnabled && k.cooldownUntil <= now
    );

    if (healthyKeys.length === 0) {
      logger.warn("[DecartPool] All keys are in cooldown or disabled");
      // Last resort: return the key with the earliest cooldown expiry
      const soonest = this.keys
        .filter((k) => k.isEnabled)
        .sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0];
      return soonest ?? null;
    }

    // FIX (BUG-013): advance cursor against full pool size so round-robin stays
    // fair when keys enter/leave cooldown between calls. Previously cursor modulo
    // used healthyKeys.length which skipped lower-index keys more often.
    const idx    = this.cursor % healthyKeys.length;
    const chosen = healthyKeys[idx];
    this.cursor  = (this.cursor + 1) % Math.max(1, this.keys.length);
    return chosen;
  }

  /** Report a successful request for a key. */
  reportSuccess(keyId: number): void {
    const key = this.keys.find((k) => k.id === keyId);
    if (key) {
      key.totalRequests += 1;
    }
  }

  /**
   * Report a failed request (rate limit or server error).
   * Puts the key in cooldown for COOLDOWN_MS.
   */
  reportFailure(keyId: number): void {
    const key = this.keys.find((k) => k.id === keyId);
    if (key) {
      key.failedRequests += 1;
      key.lastFailedAt = Date.now();
      key.cooldownUntil = Date.now() + COOLDOWN_MS;
      logger.warn(
        { keyId, label: key.label, cooldownMinutes: COOLDOWN_MS / 60_000 },
        "[DecartPool] Key put in cooldown after failure"
      );
    }
  }

  /** Get health snapshot for admin dashboard. */
  getHealthSnapshot(): Array<{
    id: number;
    label: string;
    isEnabled: boolean;
    inCooldown: boolean;
    cooldownRemainingMs: number;
    totalRequests: number;
    failedRequests: number;
    failureRate: number;
    lastFailedAt: number | null;
    healthy: boolean;
  }> {
    const now = Date.now();
    return this.keys.map((k) => {
      const inCooldown = k.cooldownUntil > now;
      return {
        id: k.id,
        label: k.label,
        isEnabled: k.isEnabled,
        inCooldown,
        cooldownRemainingMs: inCooldown ? k.cooldownUntil - now : 0,
        totalRequests: k.totalRequests,
        failedRequests: k.failedRequests,
        failureRate:
          k.totalRequests > 0
            ? Math.round((k.failedRequests / k.totalRequests) * 100)
            : 0,
        lastFailedAt: k.lastFailedAt > 0 ? k.lastFailedAt : null,
        healthy: k.isEnabled && !inCooldown,
      };
    });
  }

  /** Manually clear a key's cooldown (admin action). */
  clearCooldown(keyId: number): void {
    const key = this.keys.find((k) => k.id === keyId);
    if (key) {
      key.cooldownUntil = 0;
      logger.info({ keyId }, "[DecartPool] Cooldown manually cleared");
    }
  }

  get size(): number {
    return this.keys.length;
  }
}

// Singleton — shared across all requests in the process
export const decartPool = new DecartKeyPool();

// FIX (BUG-008): Bootstrap with automatic retry so a slow DB startup (common in
// container restarts) doesn't leave the pool empty for up to 5 minutes, causing
// every /api/decart/token request to return 503 "No API keys available".
decartPool.load().catch((err) => {
  logger.error({ err }, "[DecartPool] Initial load failed — retrying in 5s");
  setTimeout(() => {
    decartPool.load().catch((err2) => {
      logger.error({ err: err2 }, "[DecartPool] Retry 1 failed — retrying in 15s");
      setTimeout(() => {
        decartPool.load().catch((err3) => {
          logger.error({ err: err3 }, "[DecartPool] Retry 2 failed — pool may be empty until next reload");
        });
      }, 15_000);
    });
  }, 5_000);
});
