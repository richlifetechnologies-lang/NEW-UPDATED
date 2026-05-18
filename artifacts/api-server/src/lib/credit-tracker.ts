// lib: artifacts/api-server/src/lib/credit-tracker.ts
// Decart Credit Tracker — calculates real-time credit usage per API key
// Formula: creditsUsed = SUM(session.durationSeconds * 5) for completed sessions
//          + FLOOR((NOW - session.startedAt) / 1000) * 5 for each live session
// Remaining = totalCreditsLoaded - (creditsUsed - creditsBaseline)

import { db, decartApiKeysTable, sessionsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  DECART_CREDITS_PER_SEC,
  ORPHAN_GRACE_MS,
  calculateCreditsUsedSinceTopup,
  calculateCreditsRemaining,
} from "./billing-math";

export interface KeyCreditStatus {
  id: number;
  label: string;
  isActive: boolean;
  totalCreditsLoaded: number;
  creditsUsed: number;        // since last top-up baseline
  creditsRemaining: number;
  creditsBaseline: number;
  thresholdPct: number;
  lastTopupAt: string | null;
  activeSessionCount: number;
  estimatedRemainingSeconds: number | null; // null if no active sessions
  warningLevel: "ok" | "low" | "critical";
}

export interface SessionUsageRecord {
  sessionId: string;
  licenseKeyId: number | null;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number;
  creditsConsumed: number;
  status: string;
}

/** Calculate credits used by a Decart key since the last baseline reset */
export async function getKeyCreditStatus(
  keyId: number,
  globalThresholdPct: number = 15,
  useGlobalThreshold: boolean = false
): Promise<KeyCreditStatus | null> {
  const [key] = await db
    .select()
    .from(decartApiKeysTable)
    .where(eq(decartApiKeysTable.id, keyId))
    .limit(1);

  if (!key) return null;

  // Sum completed session durations using wall-clock time (started_at → stopped_at).
  // Decart bills from the moment connect() is called (started_at), not from
  // billing_started_at (first remote frame), so we must use the full connection
  // duration here to match what Decart actually charges.
  const completedResult = await db
    .select({
      totalSeconds: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (stopped_at - started_at))::INTEGER), 0)`,
    })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.decartKeyId, keyId),
        sql`status IN ('stopped', 'expired')`,
        sql`stopped_at IS NOT NULL`
      )
    );

  const completedSeconds = Number(completedResult[0]?.totalSeconds ?? 0);

  // Sum live session durations (status = 'active') — but only for sessions that are
  // genuinely still alive (heartbeat received within ORPHAN_GRACE_MS = 2 min).
  // Sessions that missed this window are "orphaned" and will be swept shortly;
  // excluding them prevents stale rows from inflating the admin credit display.
  const liveResult = await db
    .select({
      count: sql<number>`COUNT(*)`,
      liveSeconds: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER), 0)`,
    })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.decartKeyId, keyId),
        eq(sessionsTable.status, "active"),
        sql`COALESCE(${sessionsTable.lastHeartbeatAt}, ${sessionsTable.startedAt}) > NOW() - make_interval(secs => ${ORPHAN_GRACE_MS / 1000})`
      )
    );

  const activeSessionCount = Number(liveResult[0]?.count ?? 0);
  const liveSeconds = Number(liveResult[0]?.liveSeconds ?? 0);

  const creditsUsedSinceTopup = calculateCreditsUsedSinceTopup(
    completedSeconds,
    liveSeconds,
    key.creditsBaseline ?? 0
  );
  const creditsRemaining = calculateCreditsRemaining(
    key.totalCreditsLoaded ?? 0,
    creditsUsedSinceTopup
  );

  // Warning level
  const thresholdPct = useGlobalThreshold
    ? globalThresholdPct
    : (key.thresholdPct ?? 15);
  const total = key.totalCreditsLoaded ?? 0;
  const pctRemaining = total > 0 ? (creditsRemaining / total) * 100 : 100;

  let warningLevel: "ok" | "low" | "critical" = "ok";
  if (total > 0) {
    if (pctRemaining <= thresholdPct / 2) {
      warningLevel = "critical";
    } else if (pctRemaining <= thresholdPct) {
      warningLevel = "low";
    }
  }

  // Estimated remaining runtime based on current burn rate
  let estimatedRemainingSeconds: number | null = null;
  if (activeSessionCount > 0) {
    // Each session burns 5 credits/sec, so all sessions burn 5*count credits/sec
    const burnRatePerSec = DECART_CREDITS_PER_SEC * activeSessionCount;
    estimatedRemainingSeconds = Math.floor(creditsRemaining / burnRatePerSec);
  }

  return {
    id: key.id,
    label: key.label,
    isActive: key.isActive,
    totalCreditsLoaded: key.totalCreditsLoaded ?? 0,
    creditsUsed: creditsUsedSinceTopup,
    creditsRemaining,
    creditsBaseline: key.creditsBaseline ?? 0,
    thresholdPct,
    lastTopupAt: key.lastTopupAt?.toISOString() ?? null,
    activeSessionCount,
    estimatedRemainingSeconds,
    warningLevel,
  };
}

/** Get credit status for ALL Decart API keys */
export async function getAllKeysCreditStatus(
  globalThresholdPct: number = 15,
  useGlobalThreshold: boolean = false
): Promise<KeyCreditStatus[]> {
  const keys = await db.select().from(decartApiKeysTable);
  const statuses = await Promise.all(
    keys.map((k) =>
      getKeyCreditStatus(k.id, globalThresholdPct, useGlobalThreshold)
    )
  );
  return statuses.filter(Boolean) as KeyCreditStatus[];
}

/** Record a credit top-up for a key and reset the usage baseline */
export async function recordTopup(
  keyId: number,
  creditsToAdd: number
): Promise<{ newTotal: number; newBaseline: number }> {
  const [key] = await db
    .select()
    .from(decartApiKeysTable)
    .where(eq(decartApiKeysTable.id, keyId))
    .limit(1);

  if (!key) throw new Error(`Decart API key ${keyId} not found`);

  // Calculate current total credits used in sessions (to set as new baseline)
  // Use wall-clock time to match Decart's actual billing (started_at → stopped_at)
  const usageResult = await db
    .select({
      totalSeconds: sql<number>`
        COALESCE(
          (SELECT SUM(EXTRACT(EPOCH FROM (stopped_at - started_at))::INTEGER) FROM sessions WHERE decart_key_id = ${keyId} AND status IN ('stopped','expired') AND stopped_at IS NOT NULL),
          0
        ) + 
        COALESCE(
          (SELECT SUM(EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER) FROM sessions WHERE decart_key_id = ${keyId} AND status = 'active'),
          0
        )
      `,
    })
    .from(decartApiKeysTable)
    .where(eq(decartApiKeysTable.id, keyId))
    .limit(1);

  const currentTotalSeconds = Number(usageResult[0]?.totalSeconds ?? 0);
  // Baseline in credits = totalSeconds × DECART_CREDITS_PER_SEC (5)
  const newBaseline = currentTotalSeconds * DECART_CREDITS_PER_SEC;
  // FIX (Bug #1): SET the exact value entered - do NOT accumulate with prior balance
  // Old: newTotal = (key.totalCreditsLoaded ?? 0) + creditsToAdd  <- accumulates
  // New: newTotal = creditsToAdd                                   <- exact SET
  const newTotal = creditsToAdd;

  await db
    .update(decartApiKeysTable)
    .set({
      totalCreditsLoaded: newTotal,
      creditsBaseline: newBaseline,
      lastTopupAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(decartApiKeysTable.id, keyId));

  logger.info(
    { keyId, creditsAdded: creditsToAdd, newTotal, newBaseline },
    "[CreditTracker] Top-up recorded, baseline reset"
  );

  return { newTotal, newBaseline };
}

/**
 * Record a delta top-up for a key: computes current remaining balance and adds
 * deltaCredits on top of it, then resets the usage baseline — all within a
 * single DB transaction to minimise the timing window between the balance read
 * and the update write.
 */
export async function recordTopupDelta(
  keyId: number,
  deltaCredits: number
): Promise<{ newTotal: number; newBaseline: number; deltaCredits: number; previousRemaining: number }> {
  let newTotal = 0;
  let newBaseline = 0;
  let previousRemaining = 0;

  await db.transaction(async (tx) => {
    // 1. Fetch key within the transaction (row-level read)
    const [key] = await tx
      .select()
      .from(decartApiKeysTable)
      .where(eq(decartApiKeysTable.id, keyId))
      .limit(1);

    if (!key) throw new Error(`Decart API key ${keyId} not found`);

    // 2. Compute total seconds consumed by sessions for this key (NOW() is
    //    evaluated at transaction start, so all reads share one consistent clock)
    const usageResult = await tx
      .select({
        totalSeconds: sql<number>`
          COALESCE(
            (SELECT SUM(EXTRACT(EPOCH FROM (stopped_at - started_at))::INTEGER)
             FROM sessions
             WHERE decart_key_id = ${keyId}
               AND status IN ('stopped','expired')
               AND stopped_at IS NOT NULL),
            0
          ) +
          COALESCE(
            (SELECT SUM(EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER)
             FROM sessions
             WHERE decart_key_id = ${keyId}
               AND status = 'active'),
            0
          )
        `,
      })
      .from(decartApiKeysTable)
      .where(eq(decartApiKeysTable.id, keyId))
      .limit(1);

    const currentTotalSeconds = Number(usageResult[0]?.totalSeconds ?? 0);
    newBaseline = currentTotalSeconds * DECART_CREDITS_PER_SEC;

    // creditsUsedSinceTopup = credits burned since last baseline reset
    const creditsUsedSinceTopup = calculateCreditsUsedSinceTopup(
      0,
      0,
      key.creditsBaseline ?? 0
    );
    // remaining = totalLoaded - usedSinceTopup (clamped to 0)
    previousRemaining = calculateCreditsRemaining(
      key.totalCreditsLoaded ?? 0,
      calculateCreditsUsedSinceTopup(currentTotalSeconds, 0, key.creditsBaseline ?? 0)
    );

    // 3. New absolute total = what's left now + what was just purchased
    newTotal = previousRemaining + deltaCredits;

    // 4. Persist the new total and baseline in the same transaction
    await tx
      .update(decartApiKeysTable)
      .set({
        totalCreditsLoaded: newTotal,
        creditsBaseline: newBaseline,
        lastTopupAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(decartApiKeysTable.id, keyId));
  });

  logger.info(
    { keyId, deltaCredits, previousRemaining, newTotal, newBaseline },
    "[CreditTracker] Delta top-up recorded, baseline reset"
  );

  return { newTotal, newBaseline, deltaCredits, previousRemaining };
}

/** Get session usage history for a specific Decart key */
export async function getKeyUsageHistory(
  keyId: number,
  limit: number = 50
): Promise<SessionUsageRecord[]> {
  const rows = await db
    .select({
      id: sessionsTable.id,
      licenseKeyId: sessionsTable.licenseKeyId,
      startedAt: sessionsTable.startedAt,
      stoppedAt: sessionsTable.stoppedAt,
      durationSeconds: sessionsTable.durationSeconds,
      status: sessionsTable.status,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.decartKeyId, keyId))
    .orderBy(sql`started_at DESC`)
    .limit(limit);

  return rows.map((r) => {
    // Wall-clock time matches Decart's actual billing (connect → disconnect)
    const wallClockSec = r.stoppedAt
      ? Math.floor((r.stoppedAt.getTime() - r.startedAt.getTime()) / 1000)
      : Math.floor((Date.now() - r.startedAt.getTime()) / 1000);
    return {
      sessionId: r.id,
      licenseKeyId: r.licenseKeyId,
      startedAt: r.startedAt.toISOString(),
      stoppedAt: r.stoppedAt?.toISOString() ?? null,
      durationSeconds: wallClockSec,
      creditsConsumed: wallClockSec * DECART_CREDITS_PER_SEC,
      status: r.status,
    };
  });
}
