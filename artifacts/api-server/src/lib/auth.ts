import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { db, usersTable, licenseKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error(
    "FATAL: SESSION_SECRET env var is missing or too short (need 32+ chars). " +
    "Set a strong random secret in your environment secrets."
  );
}
const SESSION_SECRET = process.env.SESSION_SECRET;

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
    const sigBuf      = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
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
  // sendBeacon cannot set custom headers — accept key from POST body only (never query
  // params, which would expose the license key in server access logs permanently).
  if (!licenseKey && (req.body as any)?.licenseKey) {
    licenseKey = (req.body as any).licenseKey as string;
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

    // ── Device-binding enforcement ─────────────────────────────────────────
    // Each license key is allowed on exactly one device (browser profile).
    // The device ID is a UUID generated on first use and stored in localStorage.
    // If the key has no device bound yet → bind it now (first-use activation).
    // If the key is already bound → the requesting device must match.
    const deviceId = req.headers["x-device-id"] as string | undefined;
    if (deviceId && deviceId.trim()) {
      const trimmedDeviceId = deviceId.trim();
      if (!license.deviceId) {
        // First time this key is used — bind it to this device silently
        await db
          .update(licenseKeysTable)
          .set({ deviceId: trimmedDeviceId, activatedAt: license.activatedAt ?? new Date() })
          .where(eq(licenseKeysTable.key, normalizedKey));
        (license as any).deviceId = trimmedDeviceId;
      } else if (license.deviceId !== trimmedDeviceId) {
        res.status(403).json({
          error: "This license key is already bound to another device. Contact your admin to unbind it.",
        });
        return;
      }
    }

    (req as any).license = license;
    (req as any).licenseKey = normalizedKey;
    next();
  } catch (err) {
    console.error("[requireLicense] DB error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
