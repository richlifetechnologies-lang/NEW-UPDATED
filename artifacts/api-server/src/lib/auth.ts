import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { db, usersTable, licenseKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SESSION_SECRET = process.env.SESSION_SECRET || "fullswap-secret-key";

if (!process.env.SESSION_SECRET) {
  console.warn("WARNING: SESSION_SECRET env var not set - using insecure default. Set it in Railway!");
}

export function hashPassword(password: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(password).digest("hex");
}

export function generateToken(userId: number, isAdmin = false, isSubAdmin = false): string {
  const payload = { userId, isAdmin, isSubAdmin, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
  return Buffer.from(data).toString("base64") + "." + sig;
}

export function verifyToken(token: string): { userId: number; isAdmin: boolean; isSubAdmin: boolean } | null {
  try {
    const [datab64, sig] = token.split(".");
    if (!datab64 || !sig) return null;
    const data = Buffer.from(datab64, "base64").toString();
    const expectedSig = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(data);
    if (payload.exp < Date.now()) return null;
    return { userId: payload.userId, isAdmin: payload.isAdmin, isSubAdmin: payload.isSubAdmin ?? false };
  } catch {
    return null;
  }
}

// Legacy user-based auth (internal use for admin routes only)
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  if (user.membership === "suspended") {
    res.status(403).json({ error: "Account suspended" });
    return;
  }
  (req as any).user = user;
  (req as any).userId = user.id;
  next();
}

// Main admins only (isAdmin = 1). Sub admins cannot pass this.
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload || !payload.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId));
  if (!user || !user.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  (req as any).user = user;
  next();
}

// Sub admins only (isSubAdmin = 1)
export async function requireSubAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload || !payload.isSubAdmin) {
    res.status(403).json({ error: "Sub-admin access required" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId));
  if (!user || !user.isSubAdmin) {
    res.status(403).json({ error: "Sub-admin access required" });
    return;
  }
  (req as any).user = user;
  next();
}

// ---- LICENSE-BASED MIDDLEWARE -----------------------------------------------
// Primary auth for all non-admin user-facing endpoints.
// Reads the license key from the X-License-Key header (preferred),
// or from Authorization: Bearer <key> when the key does not contain "."
// (distinguishing it from JWT-style admin tokens).

export async function requireLicense(req: Request, res: Response, next: NextFunction) {
  let licenseKey = req.headers["x-license-key"] as string | undefined;
  if (!licenseKey) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ") && !authHeader.slice(7).includes(".")) {
      licenseKey = authHeader.slice(7);
    }
  }

  if (!licenseKey) {
    res.status(401).json({ error: "License key required" });
    return;
  }

  const normalizedKey = licenseKey.trim().toUpperCase();

  try {
    const [license] = await db
      .select()
      .from(licenseKeysTable)
      .where(eq(licenseKeysTable.key, normalizedKey))
      .limit(1);

    if (!license) {
      res.status(401).json({ error: "Invalid license key" });
      return;
    }
    if (!license.isActive) {
      res.status(403).json({ error: "License key has been revoked" });
      return;
    }
    if (license.expiresAt && license.expiresAt < new Date()) {
      res.status(403).json({ error: "License key has expired" });
      return;
    }
    if (!license.streamingEnabled) {
      res.status(403).json({ error: "Streaming access is disabled for this license" });
      return;
    }

    (req as any).license = license;
    (req as any).licenseKey = normalizedKey;
    next();
  } catch (err) {
    console.error("[requireLicense] DB error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
