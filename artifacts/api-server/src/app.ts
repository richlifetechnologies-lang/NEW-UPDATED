import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

// ─── Database connection pool configuration ────────────────────────────────
pool.options.max = 10;
pool.options.min = 2;
pool.options.idleTimeoutMillis = 30_000;
pool.options.connectionTimeoutMillis = 5_000;

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

// REPLIT_DOMAINS: comma-separated bare domains (added as https:// + https://www.)
// ALLOWED_ORIGINS: comma-separated full origin URLs (for Railway, Render, etc.)
const productionOrigins = [
  ...(process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .flatMap((d) => [`https://${d}`, `https://www.${d}`]),
  ...(process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
];

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
    app.use((_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  } else {
    logger.warn({ frontendDist }, "Frontend dist not found — skipping static serving");
  }
}

// Global JSON error handler — must be registered AFTER all routes
// Ensures unhandled route errors always return JSON, never an HTML error page
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled server error");
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default app;
