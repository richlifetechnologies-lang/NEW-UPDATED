import { Router } from "express";
import { db, sessionsTable, licenseKeysTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireLicense } from "../lib/auth";
import { randomUUID } from "crypto";
import { getDecartKeyIdFromCache } from "./decart";
import { notifySessionDead } from "../lib/notifications";
import { logger } from "../lib/logger";

// ── All billing/timing constants imported from single source of truth ──────
import {
  HEARTBEAT_GRACE_MS,
  SWEEP_INTERVAL_MS,
  SINGLE_SESSION_GRACE_MS,
  DEDUCTION_FREEZE_MS,
  DECART_CREDITS_PER_SEC,
  MINIMUM_RESERVATION_SEC,
  calculateDebit,
  applyMinimumDuration,
  creditBasedIncrement,
  wallClockIncrement,
  licenseRemainingSeconds,
} from "../lib/billing-math";

const router = Router();

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
async function settleSession(sessionId: string, opts?: { endAt?: Date; creditsConsumed?: number }) {
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session || session.status !== "active") return 0;

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

  const endAt = opts?.endAt ?? new Date();
  const billingStart = session.billingStartedAt ?? session.startedAt;
  const lastDebit    = session.lastDeductedAt ?? billingStart;

  // ── BILLING-FIX: Credit-based duration reconciliation ──────────────────
  // If creditsConsumed is provided, use Decart's actual generationTick count
  // (2 credits/sec) instead of frontend timestamps. Pure billing-math functions
  // handle all the arithmetic — any formula change must go through billing-math.ts
  // so tests catch it immediately.
  let incrementSec: number;
  let totalDuration: number;

  if (opts?.creditsConsumed && opts.creditsConsumed > 0) {
    const alreadyBilledSec = Math.max(
      0,
      Math.floor((lastDebit.getTime() - billingStart.getTime()) / 1000)
    );
    ({ incrementSec, totalDuration } = creditBasedIncrement(opts.creditsConsumed, alreadyBilledSec));
  } else {
    ({ incrementSec, totalDuration } = wallClockIncrement(
      endAt.getTime(),
      lastDebit.getTime(),
      billingStart.getTime()
    ));
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
      creditsBased: opts?.creditsConsumed ? opts.creditsConsumed : false,
    },
    "[Session] session_end"
  );

  await db.update(sessionsTable)
    .set({ status: "stopped", stoppedAt: endAt, durationSeconds: totalDuration, lastDeductedAt: endAt })
    .where(eq(sessionsTable.id, sessionId));

  return debited;
}

// ───────────────────────────────────────────────────────────────────
//  Orphan sweeper — closes sessions whose client died without /stop
//  Runs once per process. Safe to no-op when no rows match.
// ───────────────────────────────────────────────────────────────────
let sweeperStarted = false;
function startOrphanSweeper() {
  if (sweeperStarted) return;
  sweeperStarted = true;
  setInterval(async () => {
    try {
      const now = Date.now();

      // ── Pass 1: Orphaned sessions (no heartbeat for HEARTBEAT_GRACE_MS) ────
      // Client died or disconnected without calling /stop.
      const heartbeatCutoff = new Date(now - HEARTBEAT_GRACE_MS);
      const orphans = await db.select().from(sessionsTable)
        .where(and(
          eq(sessionsTable.status, "active"),
          sql`coalesce(${sessionsTable.lastHeartbeatAt}, ${sessionsTable.startedAt}) < ${heartbeatCutoff}`
        ));
      for (const s of orphans) {
        // Use NOW (not lastHeartbeatAt) so sessions with missing heartbeats are
        // still billed for the time they actually ran. lastHeartbeatAt equals
        // billingStartedAt when no heartbeat ever fired, giving 0 duration.
        const endAt = new Date(now);
        const billingStart = s.billingStartedAt ?? s.startedAt;
        const durationSecs = Math.max(0, Math.floor((endAt.getTime() - billingStart.getTime()) / 1000));
        console.log(`[SESSION] orphan_kill sessionId=${s.id} reason=no_heartbeat endAt=${endAt.toISOString()} durationSecs=${durationSecs}`);
        await settleSession(s.id, { endAt });
        notifySessionDead({ sessionId: s.id, licenseKey: s.licenseKeyId ? String(s.licenseKeyId) : null, durationSecs, reason: "orphan", killedAt: endAt }).catch(() => {});
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
        const endAt = new Date(now);
        const billingStart = s.billingStartedAt ?? s.startedAt;
        const durationSecs = Math.max(0, Math.floor((endAt.getTime() - billingStart.getTime()) / 1000));
        console.log(`[SESSION] freeze_kill sessionId=${s.id} reason=deduction_frozen billingStartedAt=${s.billingStartedAt?.toISOString()} lastDeductedAt=${s.lastDeductedAt?.toISOString()} durationSecs=${durationSecs}`);
        await settleSession(s.id, { endAt });
        notifySessionDead({ sessionId: s.id, licenseKey: s.licenseKeyId ? String(s.licenseKeyId) : null, durationSecs, reason: "freeze", killedAt: endAt }).catch(() => {});
      }
    } catch (err) {
      console.error("[sessions] sweeper failed:", err);
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
  const style = (req.body as any)?.style ?? null;
  const allocatedSeconds = (license.minutesAllocated ?? 0) * 60;
  const usedSeconds      = license.usedSeconds ?? 0;
  const remainingSeconds = Math.max(0, allocatedSeconds - usedSeconds);
  if (remainingSeconds <= 0) {
    res.status(402).json({ error: "No streaming time remaining on this license." });
    return;
  }

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
    console.log(`[SESSION] settling_orphaned_before_new sessionId=${other.id}`);
    await settleSession(other.id, { endAt: lastBeat });
  }

  const sessionId = randomUUID();
  const [session] = await db.insert(sessionsTable).values({
    id: sessionId, licenseKeyId: license.id, status: "active", style,
    packageLabel: `${license.minutesAllocated ?? 0}min license`,
    // Link Decart key at creation so credit tracking works even for short sessions
    // that end before the first heartbeat fires (race condition fix).
    decartKeyId: license.assignedDecartKeyId ?? null,
  }).returning();

  // ── BILLING-FIX: Reserve MINIMUM_RESERVATION_SEC upfront ───────────────
  // Deduct 1 second immediately so that even a failed or very short Decart
  // connection registers usage, matching Decart's minimum billing charge.
  const nowReserve = new Date();
  await db.update(licenseKeysTable).set({
    lastSessionAt: nowReserve,
    usedSeconds: (license.usedSeconds ?? 0) + MINIMUM_RESERVATION_SEC,
  }).where(eq(licenseKeysTable.id, license.id));

  console.log(`[SESSION] session_start sessionId=${sessionId} licenseId=${license.id} reserved=${MINIMUM_RESERVATION_SEC}s remaining=${Math.max(0, remainingSeconds - MINIMUM_RESERVATION_SEC)}s`);

  res.status(201).json(formatSession(session));
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
  res.json({ billingStartedAt: now });
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
  const incrementSec = Math.max(0, Math.floor((now.getTime() - lastDebit.getTime()) / 1000));

  const [freshLicense] = await db.select().from(licenseKeysTable).where(eq(licenseKeysTable.id, license.id));
  if (!freshLicense) { res.status(404).json({ error: "License missing" }); return; }

  const allocated = (freshLicense.minutesAllocated ?? 0) * 60;
  const used      = freshLicense.usedSeconds ?? 0;
  const remaining = Math.max(0, allocated - used);

  if (incrementSec > 0 && remaining > 0) {
    const debit = Math.min(incrementSec, remaining);
    await db.update(licenseKeysTable)
      .set({ usedSeconds: used + debit, lastUsedAt: now })
      .where(eq(licenseKeysTable.id, license.id));
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
      console.log(`[SESSION] heartbeat_linked_decart_key sessionId=${sessionId} decartKeyId=${decartKeyIdToSet}`);
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

  // After this debit, is the license exhausted?
  const newUsed = used + Math.min(incrementSec, remaining);
  if (newUsed >= allocated) {
    // Auto-stop the session server-side too, so the next /heartbeat or
    // /token call can't sneak through before the client gets the 'no_time'.
    const totalDuration = Math.floor((now.getTime() - billingStart.getTime()) / 1000);
    await db.update(sessionsTable)
      .set({ status: "stopped", stoppedAt: now, durationSeconds: totalDuration })
      .where(eq(sessionsTable.id, sessionId));
    // Fire Telegram alert: license ran out during active stream
    notifySessionDead({ sessionId, licenseKey: license?.key ?? null, durationSecs: totalDuration, reason: "out_of_time", killedAt: now }).catch(() => {});
    res.json({ ok: false, reason: "no_time" });
    return;
  }

  res.json({ ok: true });
});

router.post("/:sessionId/stop", requireLicense, async (req, res) => {
  const license   = (req as any).license;
  const sessionId = req.params["sessionId"] as string;

  // ── BILLING-FIX: Accept creditsConsumed for credit-based billing sync ──
  // creditsConsumed = actual Decart credits used (2 credits/sec, Lucy 2.1)
  // actualDurationSec = creditsConsumed / 2 → syncs with real Decart billing
  const creditsConsumed: number | undefined =
    typeof (req.body as any)?.creditsConsumed === "number" && (req.body as any).creditsConsumed >= 0
      ? Math.max(0, (req.body as any).creditsConsumed) : undefined;

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session || session.licenseKeyId !== license.id) { res.status(404).json({ error: "Session not found" }); return; }

  // If session already stopped (sweeper or heartbeat closed it), return current state idempotently.
  if (session.status !== "active") {
    res.json(formatSession(session));
    return;
  }

  console.log(`[SESSION] stop_session sessionId=${sessionId} creditsConsumed=${creditsConsumed ?? 'none'} trigger=client_stop`);
  await settleSession(sessionId, { creditsConsumed });
  const [updated] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  res.json(formatSession(updated));
});

export default router;
