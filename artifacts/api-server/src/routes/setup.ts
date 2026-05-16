import { Router, type IRouter } from "express";
import { exec } from "child_process";
import crypto from "crypto";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.post("/setup", async (req, res) => {
  const token = req.headers["x-setup-token"] ?? req.body?.token;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";
  const SESSION_SECRET = process.env.SESSION_SECRET ?? "fullswap-secret-key";
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@fullswap.app";
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";

  if (!token || token !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Unauthorized — provide correct x-setup-token header" });
    return;
  }

  const log: string[] = [];

  // Step 1: run drizzle-kit push to create/sync tables
  await new Promise<void>((resolve) => {
    exec(
      "pnpm --filter @workspace/db run push-force",
      { cwd: process.cwd(), env: { ...process.env } },
      (err, stdout, stderr) => {
        if (err) {
          log.push(`[migrate] ERROR: ${stderr || err.message}`);
        } else {
          log.push(`[migrate] OK: ${stdout.trim().split("\n").slice(-3).join(" | ")}`);
        }
        resolve();
      }
    );
  });

  // Step 2: seed admin user
  try {
    const hash = crypto
      .createHmac("sha256", SESSION_SECRET)
      .update(ADMIN_PASSWORD)
      .digest("hex");

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [ADMIN_EMAIL]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        "UPDATE users SET password_hash = $1, is_admin = 1 WHERE email = $2",
        [hash, ADMIN_EMAIL]
      );
      log.push(`[seed] Admin password updated for ${ADMIN_EMAIL}`);
    } else {
      await pool.query(
        `INSERT INTO users (
          email, username, password_hash, membership,
          free_seconds_remaining, total_minutes_purchased, total_seconds_used,
          is_admin, is_sub_admin, sub_admin_minutes_balance, created_by_sub_admin,
          email_verified
        ) VALUES ($1, $2, $3, 'active', 0, 0, 0, 1, 0, 0, 0, true)`,
        [ADMIN_EMAIL, ADMIN_USERNAME, hash]
      );
      log.push(`[seed] Admin user created: ${ADMIN_EMAIL}`);
    }
  } catch (err: unknown) {
    log.push(`[seed] ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }

  res.json({ ok: true, log });
});

export default router;
