import { Router } from "express";
import { getUsdtRateUsd } from "../lib/rates";

const router = Router();

router.get("/usdt", async (req, res) => {
  const rate = await getUsdtRateUsd();
  res.json({ rate, updatedAt: new Date().toISOString() });
});

export default router;
