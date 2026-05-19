import app from "./app";
import { logger } from "./lib/logger";
import { assertValidEnvironment } from "./lib/startup-validator";
import { runMigrations } from "@workspace/db";

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

logger.info("Running database migrations…");
try {
  await runMigrations();
  logger.info("Database migrations complete");
} catch (err) {
  logger.error({ err }, "Database migration failed — aborting startup");
  process.exit(1);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
