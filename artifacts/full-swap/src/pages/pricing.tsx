import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout";
import { Loader2, RefreshCw, Clock, Zap } from "lucide-react";

type Tier = {
  id: number;
  label: string;
  minutes: number;
  credits: number;
  priceUsd: number;
  priceGhs: number;
  priceUsdt: number;
  planType: string;
};

async function fetchLiveGhsRate(): Promise<number> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error("rate fetch failed");
    const data = await res.json();
    return typeof data.rates?.GHS === "number" ? data.rates.GHS : 15.5;
  } catch {
    return 15.5;
  }
}

function fmt(n: number, dp = 2) { return n.toFixed(dp); }

export default function SoftwarePricingPage() {
  const [tiers, setTiers]           = useState<Tier[]>([]);
  const [loading, setLoading]       = useState(true);
  const [ghsRate, setGhsRate]       = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadData = async () => {
    setLoading(true);
    setRateLoading(true);
    try {
      const [tiersData, rate] = await Promise.all([
        fetch("/api/pricing").then(r => r.json()).catch(() => []),
        fetchLiveGhsRate(),
      ]);
      setTiers(Array.isArray(tiersData) ? tiersData : []);
      setGhsRate(rate);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
      setRateLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const getGhsPrice = (tier: Tier) => {
    if (tier.priceGhs > 0) return tier.priceGhs;
    return ghsRate ? +(tier.priceUsd * ghsRate).toFixed(2) : 0;
  };

  const topup   = tiers.filter(t => t.planType !== "monthly");
  const monthly = tiers.filter(t => t.planType === "monthly");

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 max-w-3xl space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-wide">Software License Prices</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Prices in USD ($) with live GHS equivalent - credits included per package
            </p>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            style={{ background: "hsl(222 40% 9%)", border: "1px solid hsl(222 40% 12%)" }}
            title="Refresh prices"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Live rate badge */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs"
          style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 12%)" }}
        >
          {rateLoading ? (
            <><Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Loading live exchange rate...</span></>

          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" style={{ boxShadow: "0 0 6px hsl(142 72% 50%)" }} />
              <span className="text-muted-foreground">
                Live rate: <strong className="text-foreground">1 USD = GHS {ghsRate ? fmt(ghsRate) : "--"}</strong>
                {lastUpdated && (
                  <span className="ml-2 opacity-50">&#183; updated {lastUpdated.toLocaleTimeString()}</span>
                )}
              </span>
            </>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />

          </div>
        )}

        {!loading && tiers.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">No pricing packages available.</div>
        )}

        {!loading && topup.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-[0.15em] mb-4" style={{ color: "hsl(187 100% 52%)" }}>
              Top-Up Packages
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {topup.map(tier => <PricingCard key={tier.id} tier={tier} ghs={getGhsPrice(tier)} />)}
            </div>
          </section>
        )}

        {!loading && monthly.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-[0.15em] mb-4 mt-2" style={{ color: "hsl(187 100% 52%)" }}>
              Monthly Plans
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {monthly.map(tier => <PricingCard key={tier.id} tier={tier} ghs={getGhsPrice(tier)} />)}
            </div>
          </section>
        )}

        <p className="text-xs text-muted-foreground pb-4">
          GHS prices are live estimates based on current exchange rates. Final charge depends on your payment processor.
        </p>
      </div>
    </AppLayout>
  );
}

function PricingCard({ tier, ghs }: { tier: Tier; ghs: number }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl p-5 space-y-4 transition-transform hover:scale-[1.01]"
      style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 12%)" }}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px]"
           style={{ background: "linear-gradient(90deg, hsl(187 100% 52%) 0deg, hsl(200 100% 45%) 60deg, transparent 100%)" }} />

      <div className="flex items-start justify-between">
        <p className="text-sm font-semibold text-foreground">{tier.label}</p>
        {tier.planType === "monthly" && (
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{ background: "hsl(187 100% 52% / 0.1)", color: "hsl(187 100% 52%)", border: "1px solid hsl(187 100% 52% / 0.2)" }}
          >
            Monthly
          </span>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-foreground">${fmt(tier.priceUsd)}</span>
          <span className="text-sm text-muted-foreground">USD</span>
        </div>
        <div className="flex items-center gap-1 text-sm" style={{ color: "hsl(142 72% 55%)" }}>
          <span>&horn;</span>
          <span className="font-semibold">GHS {fmt(ghs)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1" style={{ borderTop: "1px solid hsl(222 40% 10%)" }}>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(187 100% 52%)" }} />
          <span className="text-sm text-muted-foreground">{tier.minutes} min</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 shrink-0 text-amber-400" />

          <span className="text-sm text-muted-foreground">{tier.credits.toLocaleString()} credits</span>
        </div>
      </div>
    </div>
  );
}
