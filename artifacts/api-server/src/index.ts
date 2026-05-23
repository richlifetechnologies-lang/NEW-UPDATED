import app from "./app";
import { logger } from "./lib/logger";
import { assertValidEnvironment, warnOnNullDecartKeySessions } from "./lib/startup-validator";
import { runMigrations, applyColumnFixes } from "@workspace/db";
import { attachBillingWebSocket } from "./lib/billing-ws";
import http from "http";

assertValidEnvironment();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

logger.info("Applying column fixes…");
try {
  await applyColumnFixes();
  logger.info("Column fixes applied ✓");
} catch (err) {
  console.error("[COLUMN FIX ERROR]", (err as Error)?.stack ?? String(err));
  logger.error({ err }, "Column fixes failed — aborting startup");
  process.exit(1);
}

// Schema management is handled by `pnpm --filter @workspace/db run push` (drizzle-kit push).
// Running the Drizzle migration system at startup would conflict with a DB that was
// already provisioned via push (types/tables already exist → "already exists" errors).
// applyColumnFixes() above handles any missing columns idempotently on every startup.
logger.info("Database schema managed via drizzle-kit push — skipping migration runner");

// LEAK-10: warn if any active sessions are missing decart_key_id attribution
warnOnNullDecartKeySessions().catch(() => {});

// Create an HTTP server so we can attach both Express and the billing WebSocket
const httpServer = http.createServer(app);

// Attach read-only billing observability WebSocket
// SAFETY: This is purely observational — it does NOT control billing or wallet logic.
// Path: /api/admin/billing-intelligence/ws
attachBillingWebSocket(httpServer);

httpServer.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});
