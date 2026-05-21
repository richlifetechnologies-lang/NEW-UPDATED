import app from "./app";
import { logger } from "./lib/logger";
import { assertValidEnvironment } from "./lib/startup-validator";
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
  logger.error({ err }, "Column fixes failed — aborting startup");
  process.exit(1);
}

logger.info("Running database migrations…");
try {
  await runMigrations();
  logger.info("Database migrations complete");
} catch (err) {
  logger.error({ err }, "Database migration failed — aborting startup");
  process.exit(1);
}

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
