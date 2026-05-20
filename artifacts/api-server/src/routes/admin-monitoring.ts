import { Router } from "express";
import { db, licenseKeysTable, sessionsTable, decartApiKeysTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";

const router = Router();

router.get("/", requireAdmin, async (_req, res) => {
  try {
    const keys = await db.select().from(decartApiKeysTable);
    const licenses = await db.select({
      id: licenseKeysTable.id,
      key: licenseKeysTable.key,
      assignedDecartKeyId: licenseKeysTable.assignedDecartKeyId,
      usedSeconds: licenseKeysTable.usedSeconds
    }).from(licenseKeysTable);

    const licenseCounts = licenses.reduce((acc, lic) => {
      const keyId = lic.assignedDecartKeyId;
      if (keyId) {
        if (!acc[keyId]) acc[keyId] = [];
        acc[keyId].push(lic);
      }
      return acc;
    }, {} as Record<number, typeof licenses>);

    const unassignedLicenses = licenses.filter(l => !l.assignedDecartKeyId);

    const buildLicense = (lic: typeof licenses[number]) => ({
      id: lic.id,
      key: lic.key,
      totalSecondsUsed: lic.usedSeconds ?? 0,
      totalMinutesUsed: Math.round(((lic.usedSeconds ?? 0) / 60) * 10) / 10,
    });

    const keyData = keys.map((key) => {
      const kl = licenseCounts[key.id] ?? [];
      const ts = kl.reduce((s, l) => s + (l.usedSeconds ?? 0), 0);
      return {
        id: key.id,
        label: key.label,
        isActive: key.isActive,
        maxLicenseKeys: key.maxUsers,
        createdAt: key.createdAt,
        stats: {
          assignedLicenseKeys: kl.length,
          totalSecondsUsed: ts,
          totalMinutesUsed: Math.round((ts / 60) * 10) / 10,
        },
        licenses: kl.map(buildLicense).sort((a, b) => b.totalSecondsUsed - a.totalSecondsUsed),
      };
    });

    const unAssignedSec = unassignedLicenses.reduce((s, l) => s + (l.usedSeconds ?? 0), 0);
    res.json({
      keys: keyData,
      unassigned: {
        stats: {
          licenseKeyCount: unassignedLicenses.length,
          totalSecondsUsed: unAssignedSec,
          totalMinutesUsed: Math.round((unAssignedSec / 60) * 10) / 10,
        },
        licenses: unassignedLicenses.map(buildLicense).sort((a, b) => b.totalSecondsUsed - a.totalSecondsUsed),
      },
      totals: {
        totalKeys: keys.length,
        activeKeys: keys.filter((k) => k.isActive).length,
        totalLicenseKeys: licenses.length,
        totalSecondsUsed: licenses.reduce((s, l) => s + (l.usedSeconds ?? 0), 0),
        totalMinutesUsed: Math.round((licenses.reduce((s, l) => s + (l.usedSeconds ?? 0), 0) / 60) * 10) / 10,
      },
    });
  } catch (err) {
    logger.error({ err }, "[AdminMonitoring] monitoring data load failed");
    res.status(500).json({ error: "Failed to load monitoring data" });
  }
});

export default router;
