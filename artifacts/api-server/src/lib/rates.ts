let cachedUsdtRate: number | null = null;
let usdtCacheTime = 0;
let cachedGhsRate: number | null = null;
let ghsCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── USDT Rate ────────────────────────────────────────────────────────────────

export async function getUsdtRateUsd(): Promise<number> {
  const now = Date.now();
  if (cachedUsdtRate !== null && now - usdtCacheTime < CACHE_TTL_MS) {
    return cachedUsdtRate;
  }
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!resp.ok) throw new Error(`CoinGecko ${resp.status}`);
    const json = await resp.json() as { tether?: { usd?: number } };
    const rate = json?.tether?.usd;
    if (typeof rate === "number" && rate > 0) {
      cachedUsdtRate = rate;
      usdtCacheTime = now;
      return rate;
    }
  } catch {
    // fall through to fallback
  }
  return cachedUsdtRate ?? 1.0;
}

export async function usdToUsdt(usdAmount: number): Promise<number> {
  const rate = await getUsdtRateUsd();
  return usdAmount / rate;
}

// ── GHS Rate ─────────────────────────────────────────────────────────────────

/**
 * Returns the current USD → GHS exchange rate.
 * Uses the free ExchangeRate API with 5-minute cache.
 * Falls back to a reasonable default (15.3) if API fails.
 */
export async function getGhsRateUsd(): Promise<number> {
  const now = Date.now();
  if (cachedGhsRate !== null && now - ghsCacheTime < CACHE_TTL_MS) {
    return cachedGhsRate;
  }
  try {
    const resp = await fetch(
      "https://open.er-api.com/v6/latest/USD",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!resp.ok) throw new Error(`ExchangeRate API ${resp.status}`);
    const json = await resp.json() as { rates?: { GHS?: number } };
    const rate = json?.rates?.GHS;
    if (typeof rate === "number" && rate > 0) {
      cachedGhsRate = rate;
      ghsCacheTime = now;
      return rate;
    }
  } catch {
    // fall through
  }
  return cachedGhsRate ?? 15.3; // reasonable fallback
}

/**
 * Convert USD to GHS using live exchange rate.
 */
export async function usdToGhs(usdAmount: number): Promise<number> {
  const rate = await getGhsRateUsd();
  return usdAmount * rate;
}

// ── Conversion helpers ───────────────────────────────────────────────────────

/**
 * Get all exchange rates at once (for the admin pricing UI).
 */
export async function getAllRates(): Promise<{
  usdtPerUsd: number;
  ghsPerUsd: number;
  creditsPerMinute: number;
}> {
  const [usdtRate, ghsRate] = await Promise.all([
    getUsdtRateUsd(),
    getGhsRateUsd(),
  ]);
  return {
    usdtPerUsd: 1 / usdtRate,    // how many USDT per 1 USD
    ghsPerUsd: ghsRate,           // how many GHS per 1 USD
    creditsPerMinute: 1,          // Decart Lucy 2.1: 1 minute = 1 credit (configurable)
  };
}
