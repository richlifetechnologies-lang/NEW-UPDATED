import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

// ─── Database connection pool configuration ────────────────────────────────
// The pool is created in @workspace/db; we tune it here at startup so the
// settings are applied before any request arrives.
pool.options.max = 10;  // maximum concurrent connections
pool.options.min = 2;   // keep at least 2 warm connections alive
pool.options.idleTimeoutMillis = 30_000;  // release idle connections after 30s
pool.options.connectionTimeoutMillis = 5_000;  // fail fast if pool is exhausted

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const productionOrigins = (process.env.REPLIT_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean)
  .flatMap((d) => [`https://${d}`, `https://www.${d}`]);

app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? (productionOrigins.length > 0 ? productionOrigins : true)
    : true,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve frontend static files in production
if (process.env.NODE_ENV === "production") {
  const frontendDist =
    process.env.FRONTEND_DIST_PATH ||
    path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../../full-swap/dist/public",
    );

  if (existsSync(frontendDist)) {
    logger.info({ frontendDist }, "Serving frontend static files");
    app.use(express.static(frontendDist));
    // Catch-all: serve index.html for any non-API route (SPA routing)
    app.use((_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  } else {
    logger.warn({ frontendDist }, "Frontend dist not found — skipping static serving");
  }
}

export default app;
