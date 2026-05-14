// lib: artifacts/api-server/src/lib/credit-tracker.ts
// Decart Credit Tracker — calculates real-time credit usage per API key
// Formula: creditsUsed = SUM(session.durationSeconds * 2) for completed sessions
//          + FLOOR((NOW - session.startedAt) / 1000) * 2 for each live session
// Remaining = totalCreditsLoaded - (creditsUsed - creditsBaseline)

import { db, decartApiKeysTable, sessionsTable } from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { logger } from "./logger";

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

  // Sum completed session durations (status = 'stopped' or 'expired')
  const completedResult = await db
    .select({
      totalSeconds: sql<number>`COALESCE(SUM(duration_seconds), 0)`,
    })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.decartKeyId, keyId),
        sql`status IN ('stopped', 'expired')`,
        isNull(sessionsTable.stoppedAt) === false
          ? sql`stopped_at IS NOT NULL`
          : sql`TRUE`
      )
    );

  const completedSeconds = Number(completedResult[0]?.totalSeconds ?? 0);

  // Sum live session durations (status = 'active')
  const liveResult = await db
    .select({
      count: sql<number>`COUNT(*)`,
      liveSeconds: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER), 0)`,
    })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.decartKeyId, keyId),
        eq(sessionsTable.status, "active")
      )
    );

  const activeSessionCount = Number(liveResult[0]?.count ?? 0);
  const liveSeconds = Number(liveResult[0]?.liveSeconds ?? 0);

  const totalSeconds = completedSeconds + liveSeconds;
  const creditsUsedTotal = totalSeconds * 2;

  // Credits used since last top-up (subtract baseline)
  const creditsUsedSinceTopup = Math.max(
    0,
    creditsUsedTotal - (key.creditsBaseline ?? 0)
  );
  const creditsRemaining = Math.max(
    0,
    (key.totalCreditsLoaded ?? 0) - creditsUsedSinceTopup
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
    // Each session burns 2 credits/sec, so all sessions burn 2*count credits/sec
    const burnRatePerSec = 2 * activeSessionCount;
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
  const usageResult = await db
    .select({
      totalSeconds: sql<number>`
        COALESCE(
          (SELECT SUM(COALESCE(duration_seconds, 0)) FROM sessions WHERE decart_key_id = ${keyId} AND status IN ('stopped','expired')),
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
  const newBaseline = currentTotalSeconds * 2; // credits equivalent
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
    const dur =
      r.durationSeconds ??
      (r.stoppedAt
        ? Math.floor(
            (r.stoppedAt.getTime() - r.startedAt.getTime()) / 1000
          )
        : Math.floor((Date.now() - r.startedAt.getTime()) / 1000));
    return {
      sessionId: r.id,
      licenseKeyId: r.licenseKeyId,
      startedAt: r.startedAt.toISOString(),
      stoppedAt: r.stoppedAt?.toISOString() ?? null,
      durationSeconds: dur,
      creditsConsumed: dur * 2,
      status: r.status,
    };
  });
}
