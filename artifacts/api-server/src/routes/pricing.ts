import { Router } from "express";
import { db, pricingTable, settingsTable } from "@workspace/db";
import { asc } from "drizzle-orm";

const router = Router();

// GET /api/pricing -- returns all active tiers with full fields (USD, GHS, credits)
router.get("/", async (_req, res) => {
  try {
    const allSettings = await db.select().from(settingsTable);
    const userMonthlyEnabled = allSettings.find(s => s.key === "user_monthly_enabled")?.value ?? "true";
    const tiers = await db.select().from(pricingTable).orderBy(asc(pricingTable.minutes));
    res.json(
      tiers
        .filter(t => {
          if (!(t.isActive ?? true)) return false;
          if (t.planType === "monthly" && userMonthlyEnabled !== "true") return false;
          return true;
        })
        .map(t => ({
          id: t.id,
          label: t.label,
          minutes: t.minutes,
          credits: t.credits ?? 0,
          priceUsd: parseFloat(t.priceUsd ?? "0"),
          priceUsdt: parseFloat(t.priceUsdt ?? "0"),
          priceGhs: parseFloat(t.priceGhs ?? "0"),
          planType: t.planType ?? "topup",
        }))
    );
  } catch (err) {
    console.error("[pricing:list]", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
