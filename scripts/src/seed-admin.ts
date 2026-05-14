import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET || "fullswap-secret-key";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@fullswap.app";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";

if (!process.env.SESSION_SECRET) {
  console.warn("WARNING: SESSION_SECRET not set — using insecure default! Set SESSION_SECRET in Railway.");
}
if (!process.env.ADMIN_PASSWORD) {
  console.warn("WARNING: ADMIN_PASSWORD not set — using default 'admin123'. Set ADMIN_PASSWORD in Railway for security.");
}

function hashPassword(password: string): string {
  return crypto.createHmac("sha256", SECRET).update(password).digest("hex");
}

const hash = hashPassword(ADMIN_PASSWORD);
console.log("SECRET used:", SECRET.slice(0, 8) + "...");
console.log("Admin email:", ADMIN_EMAIL);
console.log("HASH:", hash);

const { Pool } = await import("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const existing = await pool.query(
  "SELECT id FROM users WHERE email = $1",
  [ADMIN_EMAIL]
);

if (existing.rows.length > 0) {
  await pool.query(
    "UPDATE users SET password_hash = $1, is_admin = 1 WHERE email = $2",
    [hash, ADMIN_EMAIL]
  );
  console.log("Admin password hash updated successfully");
} else {
  // Insert admin user if they don't exist yet
  await pool.query(
    `INSERT INTO users (
      email, username, password_hash, membership,
      free_seconds_remaining, total_minutes_purchased, total_seconds_used,
      is_admin, is_sub_admin, sub_admin_minutes_balance, created_by_sub_admin,
      email_verified
    ) VALUES ($1, $2, $3, 'active', 0, 0, 0, 1, 0, 0, 0, true)`,
    [ADMIN_EMAIL, ADMIN_USERNAME, hash]
  );
  console.log("Admin user created successfully");
}

await pool.end();
console.log("Done. Log in with:", ADMIN_EMAIL);
