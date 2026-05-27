import { Router } from "express";
import { db, sessionsTable, licenseKeysTable, decartApiKeysTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireLicense } from "../lib/auth";
import { randomUUID } from "crypto";
import { getDecartKeyIdFromCache, invalidateLicenseTokenCache } from "./decart";
import { notifySessionDead } from "../lib/notifications";
import { logger } from "../lib/logger";
import { emitSessionStarted, emitSessionSettled, emitWalletUpdated } from "../lib/billing-ws";
import { getBillingRateForLicense } from "../lib/billing-rate-cache";
import { logSessionBillingEvent } from "../lib/session-billing-logger";

// ── Per-license creation lock: prevents two simultaneous POST /sessions for
  // the same license key from both passing the active-session guard.
  const sessionCreationLocks = new Set<string>();

  // ── All billing/timing constants imported from single source of truth ──────
// Billing rate IS needed for heartbeat exhaustion check (DISPLAY-BOUND model):
//   displayRemainingSeconds controls exhaustion — wallet.used_seconds drives billing only.
import {
  HEARTBEAT_GRACE_MS,
  ORPHAN_GRACE_MS,
  INITIAL_CONNECT_GRACE_MS,
  SWEEP_INTERVAL_MS,
  SINGLE_SESSION_GRACE_MS,
  DEDUCTION_FREEZE_MS,
  MINIMUM_RESERVATION_SEC,
  DECART_ICE_BUFFER_SEC,
  HARD_KILL_SAFETY_RESERVE_SEC,
  calculateDebit,
  applyMinimumDuration,
  wallClockIncrement,
  licenseRemainingSeconds,
  computeCompressionFactor,
  computeDisplaySeconds,
} from "../lib/billing-math";

const router = Router();

// ── PATCH-03: Session creation rate limiter ──────────────────────────────────
// Max 3 session creates per 60s per license key — prevents reconnect storms
// from draining wallet time (each create debits MINIMUM_RESERVATION_SEC upfront).
const SESSION_RL_MAX    = 3;
const SESSION_RL_WINDOW = 60_000;
interface SrlEntry { count: number; resetAt: number }
const sessionRlStore = new Map<string, SrlEntry>();
function checkSessionRateLimit(key: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const e = sessionRlStore.get(key);
  if (!e || now >= e.resetAt) {
    sessionRlStore.set(key, { count: 1, resetAt: now + SESSION_RL_WINDOW });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (e.count >= SESSION_RL_MAX) return { allowed: false, retryAfterMs: e.resetAt - now };
  e.count++;
  return { allowed: true, retryAfterMs: 0 };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of sessionRlStore) if (now >= e.resetAt) sessionRlStore.delete(k);
}, 5 * 60_000).unref?.();

function formatSession(s: any) {
  return {
    id: s.id,
    licenseKeyId: s.licenseKeyId,
    status: s.status,
    startedAt: s.startedAt,
    stoppedAt: s.stoppedAt ?? null,
    durationSeconds: s.durationSeconds ?? null,
    style: s.style ?? null,
  };
}

// Settle billing for a single session. Pure function (no side-effects on res).
// Returns the number of seconds debited from the license.
async function settleSession(sessionId: string, opts?: { endAt?: Date; extraBillingSeconds?: number }) {
  // ── Atomic claim — only one concurrent caller can proceed ─────────────────
  // We set status to "stopped" + stoppedAt in a single UPDATE WHERE status='active'.
  // PostgreSQL guarantees this is atomic: exactly one concurrent caller will get
  // the row back via RETURNING; every other caller gets an empty result and exits.
  // This prevents the double-settle race between the orphan sweeper, the /stop
  // handler, startup cleanup, and heartbeat exhaustion from double-debiting the wallet.
  const endAt = opts?.endAt ?? new Date();
  const extraBillingSec = Math.max(0, opts?.extraBillingSeconds ?? 0);
  const [session] = await db
    .update(sessionsTable)
    .set({ status: "stopped", stoppedAt: endAt })
    .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.status, "active")))
    .returning();
  if (!session) return 0; // already claimed and settled by another concurrent caller

  // If decartKeyId is still null (race: stop beat the first heartbeat), link it now
  // so the credit tracker can count this session against the right API key.
  if (!session.decartKeyId && session.licenseKeyId) {
    const [lic] = await db.select().from(licenseKeysTable).where(eq(licenseKeysTable.id, session.licenseKeyId));
    if (lic?.assignedDecartKeyId) {
      await db.update(sessionsTable)
        .set({ decartKeyId: lic.assignedDecartKeyId })
        .where(eq(sessionsTable.id, sessionId));
      (session as any).decartKeyId = lic.assignedDecartKeyId;
    }
  }

  const billingStart = session.billingStartedAt ?? session.startedAt;
  const lastDebit    = session.lastDeductedAt ?? billingStart;

  // ── Wall-clock settlement ──────────────────────────────────────────────
  // Bills only the remaining delta since the last heartbeat deduction.
  // Formula: floor((endAt - lastDeductedAt) / 1000) × compressionFactor
  // Frame-rate independent — generationTick billing removed.
  let incrementSec: number;
  let totalDuration: number;

  ({ incrementSec, totalDuration } = wallClockIncrement(
    endAt.getTime(),
    lastDebit.getTime(),
    billingStart.getTime()
  ));
  // ── Billing-rate compression (settlement) ──────────────────────────────────
  // Apply the same compression factor used during heartbeat deductions so the
  // final settle is consistent with incremental billing.
  // compression_factor = billingRate / 2.3  (2.3 = Decart cost breakeven)
  // Higher billing rate → faster wallet drain → less real streaming time per minute.
  // compressionFactor is kept outside the try so the ICE buffer block can reuse it.
  let compressionFactor = 1.0;
  try {
    if (session.licenseKeyId) {
      const settleRate = await getBillingRateForLicense(session.licenseKeyId);
      compressionFactor = computeCompressionFactor(settleRate);
      incrementSec = Math.max(0, Math.round(incrementSec * compressionFactor));
    }
  } catch { /* non-fatal — use raw increment, compressionFactor stays 1.0 */ }

  // ── Decart ICE overage buffer ───────────────────────────────────────────────
  // When the orphan sweeper kills a session due to network failure, Decart keeps
  // billing for a further 30–60 s while WebRTC ICE tears down. extraBillingSeconds
  // (default 0; set to DECART_ICE_BUFFER_SEC on orphan/startup-orphan kills) covers
  // this window so the admin never absorbs network-failure Decart costs — they are
  // passed to the user's license wallet at the same compression rate as heartbeats.
  if (extraBillingSec > 0) {
    const compressedBuf = Math.round(extraBillingSec * compressionFactor);
    incrementSec  = Math.max(0, incrementSec + compressedBuf);
    totalDuration = Math.max(0, totalDuration + extraBillingSec);
  }

  // Every session has MINIMUM_RESERVATION_SEC debited at creation.
  // Guarantee duration_seconds reflects at least that so analytics never show 0.
  totalDuration = applyMinimumDuration(totalDuration);

  // Re-read license to get a fresh usedSeconds value
  const [license] = await db.select().from(licenseKeysTable).where(eq(licenseKeysTable.id, session.licenseKeyId!));
  let debited = 0;
  if (license && incrementSec > 0) {
    const remainingSec = licenseRemainingSeconds(license.minutesAllocated ?? 0, license.usedSeconds ?? 0);
    debited = calculateDebit(incrementSec, remainingSec);
    if (debited > 0) {
      await db.update(licenseKeysTable)
        .set({ usedSeconds: (license.usedSeconds ?? 0) + debited, lastUsedAt: endAt })
        .where(eq(licenseKeysTable.id, license.id));
    }
  }

  logger.info(
    {
      sessionId,
      totalDuration,
      debited,
    },
    "[Session] session_end"
  );

  // status and stoppedAt were already written atomically at the top of this function.
  // Only write the computed fields that were not known at claim time.
  await db.update(sessionsTable)
    .set({ durationSeconds: totalDuration, lastDeductedAt: endAt })
    .where(eq(sessionsTable.id, sessionId));

  // ── Observability: settle (fire-and-forget) — captures full lifecycle metrics ──
  logSessionBillingEvent({
    sessionId,
    decartSessionId: session.decartSessionId ?? undefined,
    eventType: "settle",
    walletRemainingSeconds: license
      ? Math.max(0, licenseRemainingSeconds(license.minutesAllocated ?? 0, (license.usedSeconds ?? 0) + debited))
      : null,
    metadata: {
      totalDuration,
      debited,
      stopAt: endAt.toISOString(),
      billingRateSnapshot: (session as any).billingRateSnapshot ?? null,
    },
  });

  // Observability push — does NOT affect billing (non-fatal)
  emitSessionSettled(sessionId, session.licenseKeyId ?? null, totalDuration, "client_stop");
  if (license) {
    const newUsed = (license.usedSeconds ?? 0) + debited;
    const remaining = Math.max(0, licenseRemainingSeconds(license.minutesAllocated ?? 0, newUsed));
    emitWalletUpdated(session.licenseKeyId!, newUsed, remaining);
  }

  return debited;
}

// ───────────────────────────────────────────────────────────────────
//  Helpers shared by sweeper and startup cleanup
// ───────────────────────────────────────────────────────────────────

/** Ensure a session has decart_key_id set before we settle it.
 *  Mirrors the 3-tier fallback in POST /sessions so credit tracking
 *  is never blind even for sessions created before the fix landed. */
async function ensureDecartKeyLinked(s: { id: string; decartKeyId: number | null; licenseKeyId: number | null }) {
  if (s.decartKeyId) return; // already set — nothing to do
  let keyId: number | null = null;

  // Tier 1: explicit assignment on the license key
  if (s.licenseKeyId) {
    const [lic] = await db.select({ assignedDecartKeyId: licenseKeysTable.assignedDecartKeyId })
      .from(licenseKeysTable).where(eq(licenseKeysTable.id, s.licenseKeyId)).limit(1);
    keyId = lic?.assignedDecartKeyId ?? null;
  }

  // Tier 2: any active key in the DB (last resort)
  if (!keyId) {
    const [fallback] = await db.select({ id: decartApiKeysTable.id })
      .from(decartApiKeysTable).where(eq(decartApiKeysTable.isActive, true)).limit(1);
    keyId = fallback?.id ?? null;
  }

  if (keyId) {
    await db.update(sessionsTable).set({ decartKeyId: keyId }).where(eq(sessionsTable.id, s.id));
    logger.info({ sessionId: s.id, decartKeyId: keyId }, "[Session] backfilled decart_key_id before settle");
  }
}

/**
 * Look up the license key string for a given licenseKeyId.
 * Returns null if not found or on DB error.
 * Used by the orphan sweeper to invalidate the token cache after settling.
 */
async function getLicenseKeyString(licenseKeyId: number | null): Promise<string | null> {
  if (!licenseKeyId) return null;
  try {
    const [lic] = await db.select({ key: licenseKeysTable.key })
      .from(licenseKeysTable)
      .where(eq(licenseKeysTable.id, licenseKeyId))
      .limit(1);
    return lic?.key ?? null;
  } catch { return null; }
}

// ───────────────────────────────────────────────────────────────────
//  Startup cleanup — settle sessions left open from before this
//  process started (server crash / restart). Runs once, immediately.
// ───────────────────────────────────────────────────────────────────
async function settleStartupOrphans() {
  try {
    // Any session that is still "active" but had no heartbeat in the last
    // ORPHAN_GRACE_MS (15 s) could not have had a heartbeat from this
    // process — settle it immediately rather than waiting for the sweeper.
    // Two-tier grace — mirrors the periodic sweeper.
    // Tier A (lastHeartbeatAt IS NULL, never heartbeated): INITIAL_CONNECT_GRACE_MS (45 s)
    // Tier B (lastHeartbeatAt IS NOT NULL): ORPHAN_GRACE_MS (15 s)
    const startupInitialCutoff = new Date(Date.now() - INITIAL_CONNECT_GRACE_MS);
    const startupOrphanCutoff  = new Date(Date.now() - ORPHAN_GRACE_MS);
    const stale = await db.select().from(sessionsTable)
      .where(and(
        eq(sessionsTable.status, "active"),
        sql`(
          (${sessionsTable.lastHeartbeatAt} IS NULL     AND ${sessionsTable.startedAt}       < ${startupInitialCutoff})
          OR
          (${sessionsTable.lastHeartbeatAt} IS NOT NULL AND ${sessionsTable.lastHeartbeatAt} < ${startupOrphanCutoff})
        )`
      ));

    for (const s of stale) {
      await ensureDecartKeyLinked(s);
      const endAt = new Date();
      const billingStart = s.billingStartedAt ?? s.startedAt;
      const durationSecs = Math.max(0, Math.floor((endAt.getTime() - billingStart.getTime()) / 1000));
      logger.info({ sessionId: s.id, durationSecs, iceBufferSec: DECART_ICE_BUFFER_SEC }, "[Session] startup_orphan_kill");
      await settleSession(s.id, { endAt, extraBillingSeconds: DECART_ICE_BUFFER_SEC });
      // Invalidate token cache so no stale token can be reused for this license
      const licKey = await getLicenseKeyString(s.licenseKeyId);
      if (licKey) invalidateLicenseTokenCache(licKey);
      notifySessionDead({ sessionId: s.id, licenseKey: s.licenseKeyId ? String(s.licenseKeyId) : null, durationSecs, reason: "orphan", killedAt: endAt }).catch(() => {});
      // ── Observability: startup_orphan_kill (fire-and-forget) ─────────────────
      logSessionBillingEvent({ sessionId: s.id, eventType: "startup_orphan_kill", walletRemainingSeconds: null, metadata: { durationSecs, iceBufferSec: DECART_ICE_BUFFER_SEC, reason: "startup_orphan", killedAt: endAt.toISOString() } });
    }
    if (stale.length > 0) {
      logger.info({ count: stale.length }, "[Session] startup_orphan_cleanup_done");
    }
  } catch (err) {
    logger.error({ err }, "[Session] startup_orphan_cleanup failed");
  }
}

// ───────────────────────────────────────────────────────────────────
//  Orphan sweeper — closes sessions whose client died without /stop
//  Runs once per process. Safe to no-op when no rows match.
// ───────────────────────────────────────────────────────────────────
let sweeperStarted = false;
function startOrphanSweeper() {
  if (sweeperStarted) return;
  sweeperStarted = true;

  // Immediately settle any sessions left from a previous server run
  settleStartupOrphans();

  setInterval(async () => {
    try {
      const now = Date.now();

      // ── Pass 1: Orphaned sessions — two-tier grace ─────────────────────────────
      // ROOT-CAUSE FIX: sessions were being killed before the client could send
      // its first heartbeat. A fresh session needs up to ~15 s just to connect
      // to Decart and send heartbeat #1. Under any network delay the sweeper
      // fired first and killed the session (confirmed in Railway logs: session
      // killed 16.5 s after creation with lastHeartbeatAt IS NULL).
      //
      // Tier A — lastHeartbeatAt IS NULL (never heartbeated):
      //   Grace = INITIAL_CONNECT_GRACE_MS (45 s)
      // Tier B — lastHeartbeatAt IS NOT NULL (active stream):
      //   Grace = ORPHAN_GRACE_MS (15 s) — normal disconnect path
      const initialConnectCutoff = new Date(now - INITIAL_CONNECT_GRACE_MS);
      const orphanCutoff          = new Date(now - ORPHAN_GRACE_MS);
      const orphans = await db.select().from(sessionsTable)
        .where(and(
          eq(sessionsTable.status, "active"),
          sql`(
            (${sessionsTable.lastHeartbeatAt} IS NULL     AND ${sessionsTable.startedAt}       < ${initialConnectCutoff})
            OR
            (${sessionsTable.lastHeartbeatAt} IS NOT NULL AND ${sessionsTable.lastHeartbeatAt} < ${orphanCutoff})
          )`
        ));
      for (const s of orphans) {
        await ensureDecartKeyLinked(s);
        const endAt = new Date(now);
        const billingStart = s.billingStartedAt ?? s.startedAt;
        const durationSecs = Math.max(0, Math.floor((endAt.getTime() - billingStart.getTime()) / 1000));
        logger.info({ sessionId: s.id, durationSecs, iceBufferSec: DECART_ICE_BUFFER_SEC }, "[Session] orphan_kill no_heartbeat");
        await settleSession(s.id, { endAt, extraBillingSeconds: DECART_ICE_BUFFER_SEC });
        // Invalidate token cache for this license key after orphan settle
        const licKey = await getLicenseKeyString(s.licenseKeyId);
        if (licKey) invalidateLicenseTokenCache(licKey);
        notifySessionDead({ sessionId: s.id, licenseKey: s.licenseKeyId ? String(s.licenseKeyId) : null, durationSecs, reason: "orphan", killedAt: endAt }).catch(() => {});
        // ── Observability: orphan_kill (fire-and-forget) ──────────────────────
        logSessionBillingEvent({ sessionId: s.id, eventType: "orphan_kill", metadata: { durationSecs, iceBufferSec: DECART_ICE_BUFFER_SEC, reason: "orphan" } });
      }

      // ── Pass 2: Deduction-freeze kill ───────────────────────────────────────
      const freezeCutoff = new Date(now - DEDUCTION_FREEZE_MS);
      const frozen = await db.select().from(sessionsTable)
        .where(and(
          eq(sessionsTable.status, "active"),
          sql`${sessionsTable.billingStartedAt} IS NOT NULL`,
          sql`coalesce(${sessionsTable.lastDeductedAt}, ${sessionsTable.billingStartedAt}) <= ${freezeCutoff}`
        ));
      for (const s of frozen) {
        if (orphans.some((o) => o.id === s.id)) continue;
        await ensureDecartKeyLinked(s);
        const endAt = new Date(now);
        const billingStart = s.billingStartedAt ?? s.startedAt;
        const durationSecs = Math.max(0, Math.floor((endAt.getTime() - billingStart.getTime()) / 1000));
        logger.info({ sessionId: s.id, durationSecs }, "[Session] freeze_kill deduction_frozen");
        await settleSession(s.id, { endAt });
        // Invalidate token cache for this license key after freeze kill
        const licKey = await getLicenseKeyString(s.licenseKeyId);
        if (licKey) invalidateLicenseTokenCache(licKey);
        notifySessionDead({ sessionId: s.id, licenseKey: s.licenseKeyId ? String(s.licenseKeyId) : null, durationSecs, reason: "freeze", killedAt: endAt }).catch(() => {});
        // ── Observability: freeze_kill (fire-and-forget) ──────────────────────
        logSessionBillingEvent({ sessionId: s.id, eventType: "freeze_kill", metadata: { durationSecs, reason: "freeze" } });
      }
    } catch (err) {
      logger.error({ err }, "[sessions] sweeper failed");
    }
  }, SWEEP_INTERVAL_MS).unref?.();
}
startOrphanSweeper();

// ───────────────────────────────────────────────────────────────────
//  Routes
// ───────────────────────────────────────────────────────────────────
router.get("/", requireLicense, async (req, res) => {
  const license = (req as any).license;
  const sessions = await db.select().from(sessionsTable)
    .where(eq(sessionsTable.licenseKeyId, license.id))
    .orderBy(desc(sessionsTable.startedAt))
    .limit(20);
  res.json(sessions.map(formatSession));
});

router.post("/", requireLicense, async (req, res) => {
  const license = (req as any).license;

  // ── PATCH-03: rate-limit check ────────────────────────────────────────────
  const { allowed: sessionAllowed, retryAfterMs } = checkSessionRateLimit(license.key as string);
  if (!sessionAllowed) {
    res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    res.status(429).json({ error: "Too many session creation attempts. Please wait.", code: "SESSION_RATE_LIMITED" });
    return;
  }

  const style = (req.body as any)?.style ?? null;
  const isTokenReconnect = (req.body as any)?.tokenReconnect === true;
  const allocatedSeconds = (license.minutesAllocated ?? 0) * 60;
  const usedSeconds      = license.usedSeconds ?? 0;
  const remainingSeconds = Math.max(0, allocatedSeconds - usedSeconds);

  if (remainingSeconds <= 0) {
    res.status(402).json({ error: "No streaming time remaining on this license." });
    return;
  }

  // ── Mutex: block concurrent session creation for the same license key ─────
    if (sessionCreationLocks.has(license.id)) {
      res.status(409).json({
        error: "A session is already being created for this license. Please try again in a moment.",
        code: "SESSION_CREATION_IN_PROGRESS",
      });
      return;
    }
    sessionCreationLocks.add(license.id);
    try {

    // FIX #3: Stricter single-active-session guard: refuse any active session within grace window
    const liveCutoff = new Date(Date.now() - SINGLE_SESSION_GRACE_MS);
  const activeOthers = await db.select().from(sessionsTable)
    .where(and(eq(sessionsTable.licenseKeyId, license.id), eq(sessionsTable.status, "active")))
    .orderBy(desc(sessionsTable.startedAt));

  for (const other of activeOthers) {
    const lastBeat = other.lastHeartbeatAt ?? other.startedAt;
    if (lastBeat > liveCutoff) {
      res.status(409).json({
        error: "Another stream is already active for this license. Stop it first or try again in a moment.",
        code: "SESSION_ALREADY_ACTIVE",
        existingSessionId: other.id,
      });
      return;
    }
    // Otherwise it's effectively orphaned --- settle it before continuing.
    logger.info({ sessionId: other.id }, "[Session] settling_orphaned_before_new");
    await settleSession(other.id, { endAt: lastBeat });
  }

  // Re-read the license balance after settling any orphaned sessions (C-3).
  // The settle may have consumed remaining seconds; confirm there is still time
  // before proceeding to create a new session.
  const [refreshedLicense] = await db.select().from(licenseKeysTable).where(eq(licenseKeysTable.id, license.id));
  const freshRemaining = Math.max(
    0,
    ((refreshedLicense?.minutesAllocated ?? 0) * 60) - (refreshedLicense?.usedSeconds ?? 0)
  );
  if (freshRemaining <= 0) {
    res.status(402).json({ error: "No streaming time remaining on this license." });
    return;
  }

  // Resolve the decart key for this session. Prefer the license's explicit assignment.
  // If unset, fall back to the cache (from the last token fetch), then to the only
  // active key in the DB. This ensures credit tracking always has a key to attribute
  // usage to, even for very short sessions that end before the first heartbeat.
  let resolvedDecartKeyId: number | null = license.assignedDecartKeyId ?? null;
  if (!resolvedDecartKeyId) {
    resolvedDecartKeyId = getDecartKeyIdFromCache(license.key) ?? null;
  }
  if (!resolvedDecartKeyId) {
    const [fallbackKey] = await db
      .select({ id: decartApiKeysTable.id })
      .from(decartApiKeysTable)
      .where(eq(decartApiKeysTable.isActive, true))
      .limit(1);
    resolvedDecartKeyId = fallbackKey?.id ?? null;
  }
  // Guard: refuse to create a session without a Decart key — credit tracking
  // cannot attribute usage to any key, which would cause billing drift.
  if (!resolvedDecartKeyId) {
    res.status(503).json({ error: "No active Decart API key available. Please contact the administrator." });
    return;
  }

  // Auto-assign the resolved key back to the license so future sessions always have it
  if (!license.assignedDecartKeyId) {
    await db.update(licenseKeysTable)
      .set({ assignedDecartKeyId: resolvedDecartKeyId })
      .where(eq(licenseKeysTable.id, license.id));
  }

  // H-02: capture billing rate snapshot at session creation (immutable)
  let sessionBillingRateSnapshot: number | null = null;
  try {
    sessionBillingRateSnapshot = await getBillingRateForLicense(license.id);
  } catch { /* non-fatal — snapshot null if DB unavailable */ }

  const sessionId = randomUUID();
  // LEAK-01: capture connect() time so billing anchors to when the user called
  // connect(), which is when Decart starts the clock — not the first video frame.
  const sessionNow = new Date();
  const [session] = await db.insert(sessionsTable).values({
    id: sessionId, licenseKeyId: license.id, status: "active", style,
    packageLabel: `${license.minutesAllocated ?? 0}min license`,
    decartKeyId: resolvedDecartKeyId,
    billingRateSnapshot: sessionBillingRateSnapshot,
    billingStartedAt: sessionNow,  // LEAK-01: billing anchors to connect() time
    lastDeductedAt: sessionNow,    // LEAK-01: first heartbeat delta starts here
  }).returning();

  // ── BILLING-FIX: Reserve MINIMUM_RESERVATION_SEC upfront ───────────────
  // Deduct 1 second immediately so that even a failed or very short Decart
  // connection registers usage, matching Decart's minimum billing charge.
  const nowReserve = sessionNow;
  await db.update(licenseKeysTable).set({
    lastSessionAt: nowReserve,
    usedSeconds: (license.usedSeconds ?? 0) + MINIMUM_RESERVATION_SEC,
  }).where(eq(licenseKeysTable.id, license.id));

  logger.info({ sessionId, licenseId: license.id, reservedSec: MINIMUM_RESERVATION_SEC, remainingSec: Math.max(0, remainingSeconds - MINIMUM_RESERVATION_SEC) }, "[Session] session_start");

  // ── Observability: connect event (fire-and-forget) ────────────────────────
  logSessionBillingEvent({
    sessionId,
    eventType: "connect",
    walletRemainingSeconds: Math.max(0, remainingSeconds - MINIMUM_RESERVATION_SEC),
    metadata: { licenseId: license.id, style },
  });

  // ── Observability: token_reconnect — marks sessions created by a silent
  // 15s token-window handoff (admin-only, no impact on billing or logic) ──────
  if (isTokenReconnect) {
    logSessionBillingEvent({
      sessionId,
      eventType: "token_reconnect",
      walletRemainingSeconds: Math.max(0, remainingSeconds - MINIMUM_RESERVATION_SEC),
      metadata: { reason: "token_window_15s" },
    });
  }

  // Observability push — does NOT affect billing (non-fatal)
  emitSessionStarted(sessionId, license.id);
  emitWalletUpdated(license.id, (license.usedSeconds ?? 0) + MINIMUM_RESERVATION_SEC, Math.max(0, remainingSeconds - MINIMUM_RESERVATION_SEC));

  res.status(201).json(formatSession(session));

    } finally {
      sessionCreationLocks.delete(license.id);
    }
  });

  router.post("/:sessionId/output-started", requireLicense, async (req, res) => {
  const license   = (req as any).license;
  const sessionId = req.params["sessionId"] as string;
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session || session.licenseKeyId !== license.id) { res.status(404).json({ error: "Session not found" }); return; }
  if (session.status !== "active") { res.status(409).json({ error: "Session is not active" }); return; }
  if (session.billingStartedAt) { res.json({ billingStartedAt: session.billingStartedAt }); return; }
  const now = new Date();
  // billingStartedAt and lastDeductedAt both anchor at the same moment so the
  // first heartbeat debit increment is measured from here, not from session.startedAt.
  await db.update(sessionsTable)
    .set({ billingStartedAt: now, lastDeductedAt: now, lastHeartbeatAt: now })
    .where(eq(sessionsTable.id, sessionId));

  // ── Observability: stream_start (fire-and-forget) ─────────────────────────
  logSessionBillingEvent({
    sessionId,
    decartSessionId: session.decartSessionId ?? undefined,
    eventType: "stream_start",
    metadata: { billingStartedAt: now.toISOString() },
  });

  res.json({ billingStartedAt: now });
});

router.use("/:sessionId/heartbeat", (req, _res, next) => {
  const hasKey      = !!(req.headers["x-license-key"] || (req.body as any)?.licenseKey);
  const hasDeviceId = !!(req.headers["x-device-id"]);
  logger.info(
    { sessionId: req.params["sessionId"], hasKey, hasDeviceId, method: req.method },
    "[Heartbeat] attempt",
  );
  next();
});

router.post("/:sessionId/heartbeat", requireLicense, async (req, res) => {
  const license   = (req as any).license;
  const sessionId = req.params["sessionId"] as string;
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session || session.licenseKeyId !== license.id) { res.status(404).json({ error: "Session not found" }); return; }
  if (session.status !== "active") { res.status(409).json({ error: "Session is not active" }); return; }

  const now = new Date();

  // ─── Incremental debit ────────────────────────────────────────────
  // FIX (Bug #2): Auto-anchor billingStartedAt on the FIRST heartbeat if
  // output-started was never signalled (e.g. first-ever stream on Electron,
  // or network glitch dropped the output-started call). Without this anchor,
  // billingStartedAt stays null and deductions never begin on the first stream.
  let billingAnchor = session.billingStartedAt;
  if (!billingAnchor) {
    // output-started was never called. Anchor to session.startedAt so short sessions
    // capture their real elapsed time (fixes duration_seconds = 0 on quick stop).
    // Cap loading-screen time at 30s to avoid over-charging slow connections.
    const MAX_LOADING_SECS = 30;
    const loadingCapAnchor = new Date(now.getTime() - MAX_LOADING_SECS * 1000);
    billingAnchor = session.startedAt > loadingCapAnchor ? session.startedAt : loadingCapAnchor;
    // Persist the anchor so subsequent heartbeats and settleSession use it
    await db.update(sessionsTable)
      .set({ billingStartedAt: billingAnchor, lastDeductedAt: billingAnchor })
      .where(eq(sessionsTable.id, sessionId));
  }
  // Bill from lastDeductedAt -> now (or from billingStartedAt if first beat).
  // This means even if the user kills power, at most HEARTBEAT_GRACE_MS of
  // streaming goes un-billed --- not the entire session.
  const billingStart = billingAnchor;
  const lastDebit    = session.lastDeductedAt ?? billingStart;
  // FIX: cap per-heartbeat deduction to prevent a delayed heartbeat from
  // consuming 35+ wallet-seconds in one shot, which would jump past the
  // HARD_KILL_SAFETY_RESERVE_SEC=3 threshold unexpectedly (bug: stream stops
  // at ~36-38s remaining when heartbeat fires after a 33-35 second gap).
  // Cap: 15 real-seconds max per heartbeat — any excess is accounted for
  // on the NEXT heartbeat instead of causing a cliff-edge kill.
  const MAX_SINGLE_HEARTBEAT_DEDUCTION_SEC = 15;
  const rawIncrementSec = Math.min(
    Math.max(0, Math.floor((now.getTime() - lastDebit.getTime()) / 1000)),
    MAX_SINGLE_HEARTBEAT_DEDUCTION_SEC
  );

  const [freshLicense] = await db.select().from(licenseKeysTable).where(eq(licenseKeysTable.id, license.id));
  if (!freshLicense) { res.status(404).json({ error: "License missing" }); return; }

  // ── Billing-rate compression ───────────────────────────────────────────────
  // The admin billing rate (global or per-key custom) controls how fast the
  // licence wallet drains relative to real clock time.
  // compression_factor = billingRate / 2.3  (2.3 = Decart API cost breakeven)
  // Example: billingRate = 3 → factor ≈ 1.304 → 60 min key expires in ~46 real min.
  // This saves Decart API credits because the stream ends sooner in real time.
  let heartbeatCompressionFactor = 1.0;
  try {
    const hbBillingRate = await getBillingRateForLicense(freshLicense.id);
    heartbeatCompressionFactor = computeCompressionFactor(hbBillingRate);
  } catch { /* non-fatal — fallback to 1:1 deduction */ }
  const incrementSec = Math.max(0, Math.round(rawIncrementSec * heartbeatCompressionFactor));

  const allocated = (freshLicense.minutesAllocated ?? 0) * 60;
  const used      = freshLicense.usedSeconds ?? 0;
  const remaining = Math.max(0, allocated - used);

  // ── FIX: atomic debit via SQL LEAST() — two concurrent heartbeats cannot
    // both read the same usedSeconds and apply duplicate debits. RETURNING gives
    // the real post-write value used in the exhaustion check below.
    let newUsedSeconds = used;
    if (incrementSec > 0 && remaining > 0) {
      const [debited] = await db.update(licenseKeysTable)
        .set({
          usedSeconds: sql`LEAST(${licenseKeysTable.minutesAllocated} * 60, ${licenseKeysTable.usedSeconds} + ${incrementSec})`,
          lastUsedAt: now,
        })
        .where(eq(licenseKeysTable.id, license.id))
        .returning({ usedSeconds: licenseKeysTable.usedSeconds });
      newUsedSeconds = debited?.usedSeconds ?? (used + Math.min(incrementSec, remaining));
    }

  // ── Compute live durationSeconds from billing anchor ───────────────────────
  // Writing this every heartbeat makes active sessions visible with real-time
  // durations in the Decart key usage history panel (not just at stop time).
  const currentDurationSec = Math.max(0, Math.floor((now.getTime() - billingStart.getTime()) / 1000));

  // ── Ensure decartKeyId is linked (fallback if token route missed it) ───────
  // If decartKeyId is null, try: 1) license's explicit assignment, 2) token cache.
  // This covers reconnects and edge cases where the token fetch didn't update the row.
  const licenseKey = (req as any).licenseKey as string;
  let decartKeyIdToSet: number | null = session.decartKeyId ?? null;
  if (!decartKeyIdToSet) {
    decartKeyIdToSet = freshLicense.assignedDecartKeyId
      ?? getDecartKeyIdFromCache(licenseKey)
      ?? null;
    if (decartKeyIdToSet) {
      logger.info({ sessionId, decartKeyId: decartKeyIdToSet }, "[Session] heartbeat_linked_decart_key");
    }
  }

  await db.update(sessionsTable)
    .set({
      lastHeartbeatAt: now,
      lastDeductedAt: now,
      durationSeconds: currentDurationSec,
      ...(decartKeyIdToSet && !session.decartKeyId ? { decartKeyId: decartKeyIdToSet } : {}),
    })
    .where(eq(sessionsTable.id, sessionId));

  // ── Exhaustion check ──────────────────────────────────────────────────────
  // incrementSec is already billing-rate-compressed so the wallet drains at the
  // right speed. Kill the stream the moment the compressed wallet hits zero.
  // newUsedSeconds = actual value written by the atomic LEAST() UPDATE above
    const newRealRemaining = Math.max(0, allocated - newUsedSeconds);

  // Hard-kill safety reserve (HARD_KILL_SAFETY_RESERVE_SEC = 3):
  // Kill the session when the compressed wallet remaining falls to/below the
  // reserve threshold instead of waiting for it to hit exactly zero.
  // The 3-second reserve absorbs WebRTC teardown delay (2-8 s) and heartbeat
  // lag (0-10 s) so Decart never bills meaningfully past the user's entitlement.
  if (newRealRemaining <= HARD_KILL_SAFETY_RESERVE_SEC) {
    // STARTUP GUARD: never send no_time for a session younger than 10 seconds.
    // A brand-new session cannot legitimately exhaust its wallet in under 10s
    // unless there's a billing edge case (e.g. a rounding error, a delayed
    // debit catchup, or a race condition at session creation). Suppressing here
    // gives the client time to complete its first heartbeat cycle and lets the
    // frontend display-exhaustion guard fire cleanly if the wallet is genuinely
    // empty. The next heartbeat (≥5s later) will re-evaluate and kill normally
    // if the session is still over-limit.
    const sessionAgeMs = now.getTime() - session.startedAt.getTime();
    if (sessionAgeMs < 10_000) {
      logger.warn(
        { sessionId, sessionAgeMs, newRealRemaining },
        "[Heartbeat] no_time suppressed — session age < 10s (startup guard)"
      );
      res.json({ ok: true });
      return;
    }
    // Commercial entitlement is exhausted — auto-stop immediately.
    const totalDuration = Math.floor((now.getTime() - billingStart.getTime()) / 1000);
    await db.update(sessionsTable)
      .set({ status: "stopped", stoppedAt: now, durationSeconds: totalDuration })
      .where(eq(sessionsTable.id, sessionId));
    // Invalidate token cache immediately so no stale token can start a new stream
    invalidateLicenseTokenCache(licenseKey);
    // Fire Telegram alert: display time ran out during active stream
    notifySessionDead({ sessionId, licenseKey: license?.key ?? null, durationSecs: totalDuration, reason: "out_of_time", killedAt: now }).catch(() => {});
    // ── Observability: hard_kill + heartbeat_exhausted (fire-and-forget) ──────
    const hbBillingRateSnap = (session as any).billingRateSnapshot ?? null;
    logSessionBillingEvent({
      sessionId,
      decartSessionId: session.decartSessionId ?? undefined,
      eventType: "hard_kill",
      walletRemainingSeconds: newRealRemaining,
      metadata: { totalDuration, safetyReserveSec: HARD_KILL_SAFETY_RESERVE_SEC, billingRateSnapshot: hbBillingRateSnap },
    });
    logSessionBillingEvent({
      sessionId,
      decartSessionId: session.decartSessionId ?? undefined,
      eventType: "heartbeat_exhausted",
      walletRemainingSeconds: newRealRemaining,
      metadata: { reason: "hard_kill", totalDuration, safetyReserveSec: HARD_KILL_SAFETY_RESERVE_SEC, billingRateSnapshot: hbBillingRateSnap },
    });
    res.json({ ok: false, reason: "no_time" });
    return;
  }

  // ── Observability: heartbeat_ok (fire-and-forget) ─────────────────────────
  logSessionBillingEvent({
    sessionId,
    eventType: "heartbeat_ok",
    walletRemainingSeconds: newRealRemaining,
  });

  logger.info({ sessionId, newRealRemaining, incrementSec }, "[Heartbeat] ok");
  res.json({ ok: true });
});

// ───────────────────────────────────────────────────────────────────
//  Client Disconnect Signal (LEAK-04)
//  Called via navigator.sendBeacon() from the frontend on pagehide /
//  beforeunload so abnormal disconnects are settled immediately rather
//  than waiting for the next orphan sweep cycle (up to SWEEP_INTERVAL_MS).
//  Returns 200 immediately; settlement runs asynchronously.
//  Safe: settleSession() is idempotent (atomic UPDATE WHERE status='active').
//
//  NOTE: No requireLicense middleware — sendBeacon() cannot set custom headers.
//  Security is provided by the session ID itself: V4 UUID = 122 bits of entropy,
//  cryptographically unguessable. Worst-case abuse: a session settles slightly
//  early — the same outcome the orphan sweeper would produce anyway.
// ───────────────────────────────────────────────────────────────────
router.post("/:sessionId/client-disconnect", async (req, res) => {
  const sessionId = req.params["sessionId"] as string;
  res.status(200).json({ ok: true }); // respond immediately — sendBeacon won't read the body
  setImmediate(() => {
    settleSession(sessionId, { endAt: new Date() })
      .then(() => logger.info({ sessionId }, "[Session] client_disconnect_settled"))
      .catch((err: unknown) => logger.warn({ err, sessionId }, "[Session] client_disconnect_settle_failed (non-fatal)"));
  });
});

router.post("/:sessionId/stop", requireLicense, async (req, res) => {
  const license    = (req as any).license;
  const licenseKey = (req as any).licenseKey as string;
  const sessionId  = req.params["sessionId"] as string;

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session || session.licenseKeyId !== license.id) { res.status(404).json({ error: "Session not found" }); return; }

  // If session already stopped (sweeper or heartbeat closed it), return current state idempotently.
  if (session.status !== "active") {
    res.json(formatSession(session));
    return;
  }

  logger.info({ sessionId, trigger: "client_stop" }, "[Session] stop_session");
  await settleSession(sessionId);
  // Invalidate token cache so no stale token can be immediately reused
  invalidateLicenseTokenCache(licenseKey);
  // ── Observability: stop + disconnect (fire-and-forget) ───────────────────
  logSessionBillingEvent({ sessionId, eventType: "stop", metadata: { trigger: "client_stop" } });
  logSessionBillingEvent({ sessionId, eventType: "disconnect", metadata: { trigger: "client_stop" } });
  const [updated] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  res.json(formatSession(updated));
});

// ───────────────────────────────────────────────────────────────────
//  Attach Decart Session ID
//  Called by the frontend immediately after realtime.connect() resolves
//  if the SDK exposes a sessionId or connectionId on the client object.
//  Stores the cross-reference for potential future SDK terminate() support.
// ───────────────────────────────────────────────────────────────────
router.post("/:sessionId/attach-decart-session", requireLicense, async (req, res) => {
  const license   = (req as any).license;
  const sessionId = req.params["sessionId"] as string;
  const { decartSessionId } = (req.body as any) ?? {};

  if (!decartSessionId || typeof decartSessionId !== "string") {
    res.status(400).json({ error: "decartSessionId is required" });
    return;
  }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session || session.licenseKeyId !== license.id) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await db.update(sessionsTable)
    .set({ decartSessionId: decartSessionId.trim() })
    .where(eq(sessionsTable.id, sessionId));

  logger.info({ sessionId, decartSessionId }, "[Session] decart_session_id_attached");
  res.json({ ok: true });
});

export default router;