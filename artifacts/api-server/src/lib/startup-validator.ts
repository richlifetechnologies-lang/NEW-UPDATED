/**
 * startup-validator.ts — Validates environment and billing config at server boot.
 *
 * Runs before the server starts listening. Throws hard if anything critical is
 * missing or misconfigured so the problem surfaces immediately on any platform
 * (Replit, Railway, Render, Fly.io, bare VPS, etc.) rather than causing silent
 * billing errors at runtime.
 */

import {
  DECART_CREDITS_PER_SEC,
  DECART_CREDITS_PER_MIN,
  MINIMUM_RESERVATION_SEC,
  HEARTBEAT_GRACE_MS,
  DEDUCTION_FREEZE_MS,
} from "./billing-math";
import { logger } from "./logger";

interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateEnvironment(): ValidationResult {
  const errors: string[]   = [];
  const warnings: string[] = [];

  // ── Required environment variables ──────────────────────────────────────
  const required = ["DATABASE_URL", "SESSION_SECRET", "PORT"] as const;
  for (const key of required) {
    if (!process.env[key]) {
      errors.push(`Missing required env var: ${key}`);
    }
  }

  // SESSION_SECRET minimum entropy
  const secret = process.env["SESSION_SECRET"] ?? "";
  if (secret.length > 0 && secret.length < 32) {
    errors.push(`SESSION_SECRET is too short (${secret.length} chars) — must be at least 32 characters for security`);
  }

  // ── Billing constant integrity ───────────────────────────────────────────
  // These match Decart's Lucy 2.1 billing contract.
  // If someone changes these values, the server refuses to start.
  if (DECART_CREDITS_PER_SEC !== 5) {
    errors.push(
      `BILLING INVARIANT VIOLATED: DECART_CREDITS_PER_SEC must be 5 (updated deduction rate). Got: ${DECART_CREDITS_PER_SEC}`
    );
  }

  if (DECART_CREDITS_PER_MIN !== 300) {
    errors.push(
      `BILLING INVARIANT VIOLATED: DECART_CREDITS_PER_MIN must be 300 (5 credits/sec × 60). Got: ${DECART_CREDITS_PER_MIN}`
    );
  }

  if (MINIMUM_RESERVATION_SEC < 1) {
    errors.push(
      `BILLING INVARIANT VIOLATED: MINIMUM_RESERVATION_SEC must be ≥ 1. Got: ${MINIMUM_RESERVATION_SEC}`
    );
  }

  if (HEARTBEAT_GRACE_MS < 30_000) {
    errors.push(
      `SAFETY INVARIANT VIOLATED: HEARTBEAT_GRACE_MS must be ≥ 30000ms (3 missed heartbeats). Got: ${HEARTBEAT_GRACE_MS}`
    );
  }

  if (DEDUCTION_FREEZE_MS <= HEARTBEAT_GRACE_MS) {
    errors.push(
      `SAFETY INVARIANT VIOLATED: DEDUCTION_FREEZE_MS (${DEDUCTION_FREEZE_MS}) must be > HEARTBEAT_GRACE_MS (${HEARTBEAT_GRACE_MS})`
    );
  }

  // ── Optional but recommended ─────────────────────────────────────────────
  if (!process.env["NODE_ENV"]) {
    warnings.push("NODE_ENV is not set — defaulting to production-safe behavior");
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Run startup validation and abort if any hard errors are found.
 * Call this before `app.listen()`.
 */
export function assertValidEnvironment(): void {
  const result = validateEnvironment();

  for (const warning of result.warnings) {
    logger.warn(`[Startup] ${warning}`);
  }

  if (!result.ok) {
    for (const error of result.errors) {
      logger.error(`[Startup] FATAL: ${error}`);
    }
    logger.error(
      "[Startup] Server refused to start due to configuration errors. " +
      "Fix the issues above and restart."
    );
    process.exit(1);
  }

  logger.info(
    {
      decartCreditsPerSec: DECART_CREDITS_PER_SEC,
      decartCreditsPerMin: DECART_CREDITS_PER_MIN,
      minimumReservationSec: MINIMUM_RESERVATION_SEC,
      heartbeatGraceMs: HEARTBEAT_GRACE_MS,
      deductionFreezeMs: DEDUCTION_FREEZE_MS,
    },
    "[Startup] Billing config validated ✓"
  );
}
