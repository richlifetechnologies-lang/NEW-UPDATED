// ============================================================
// PATCH FOR: artifacts/api-server/src/routes/decart.ts
// After the line: decartPool.reportSuccess(resolvedKey.id);
// Add session decart_key_id tracking:
// ============================================================

// ─── Inside the router.get("/token", ...) handler ───────────
// After: decartPool.reportSuccess(resolvedKey.id);
// Add the following block to link the active session to this Decart key:

// Track which Decart key is serving this license's active session
try {
  // Find the most recent active session for this license key
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
  logger.warn({ trackErr }, "[Decart] Failed to update session decart_key_id");
}

// ─── Also add these imports at the top of decart.ts if not present ───────────
// import { sessionsTable, licenseKeysTable } from "@workspace/db";
// import { isNull } from "drizzle-orm";
