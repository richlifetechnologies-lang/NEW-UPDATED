import { Router } from "express";
import crypto from "crypto";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

let used = false;

router.post("/reset-admin-once", async (req, res) => {
  if (used) {
    res.status(410).json({ error: "Already used" });
    return;
  }

  const token = req.headers["x-reset-token"] as string | undefined;
  const adminPass = process.env.ADMIN_PASSWORD || "admin123";
  const sessionSecret = process.env.SESSION_SECRET || "fullswap-secret-key";

  if (!token || token !== adminPass) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  used = true;

  const hash = crypto
    .createHmac("sha256", sessionSecret)
    .update(adminPass)
    .digest("hex");

  const adminEmail = "admin@fullswap.app";

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, adminEmail));

  if (existing) {
    await db
      .update(usersTable)
      .set({ passwordHash: hash, isAdmin: 1, membership: "active" })
      .where(eq(usersTable.email, adminEmail));
  } else {
    await db.insert(usersTable).values({
      email: adminEmail,
      username: "admin",
      passwordHash: hash,
      membership: "active",
      isAdmin: 1,
      isSubAdmin: 0,
      freeSecondsRemaining: 0,
      totalMinutesPurchased: 0,
      totalSecondsUsed: 0,
      subAdminMinutesBalance: 0,
      createdBySubAdmin: 0,
      emailVerified: true,
    });
  }

  res.json({
    ok: true,
    secretPrefix: sessionSecret.slice(0, 8),
    hashPrefix: hash.slice(0, 16),
    action: existing ? "updated" : "created",
  });
});

export default router;
