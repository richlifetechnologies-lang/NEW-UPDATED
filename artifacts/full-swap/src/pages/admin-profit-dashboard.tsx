import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { TrendingUp, Activity, DollarSign, Zap, AlertCircle } from "lucide-react";

const API = (p: string) => `/api${p}`;
const token = () =>
  localStorage.getItem("fullswap_admin_token") ??
  localStorage.getItem("fullswap_token") ??
  "";
const authH = () => ({ Authorization: `Bearer ${token()}` });

type BillingRateInfo = {
  rate: number;
  baseRate: number;
  burnMultiplier: number;
  liveBurnSpeed: number;
  realStreamMinutesPerLicenseHour: number;
  burnPreview: string;
};

type StreamEntry = {
  streamGroupId: string;
  licenseKey: string;
  isActive: boolean;
  totalBillableSeconds: number;
  totalApiCreditsUsed: number;
  totalRetailCreditsCharged: number;
  profitInCredits: number;
  lastBillingRateUsed: number;
  burnMultiplier: number;
  liveBurnSpeed: number;
  secondsConsumedPerRealSecond: number;
};

type LedgerResponse = {
  streams: StreamEntry[];
  currentBillingRate: number;
  totalStreams: number;
  activeStreams: number;
  computedAt: string;
};

export default function AdminProfitDashboardPage() {
  const [billingInfo, setBillingInfo] = useState<BillingRateInfo | null>(null);
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = async () => {
    try {
      const [rateRes, ledgerRes] = await Promise.all([
        fetch(API("/admin/billing-rate"), { headers: authH() }),
        fetch(API("/admin/billing-intelligence/stream-ledger/live?active=true&limit=200"), { headers: authH() }),
      ]);
      if (rateRes.ok) setBillingInfo(await rateRes.json());
      if (ledgerRes.ok) setLedger(await ledgerRes.json());
      setLastUpdated(new Date());
      setError(null);
    } catch {
      setError("Live fetch failed — showing last known data");
    }
  };

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const activeStreams = (ledger?.streams ?? []).filter(s => s.isActive);
  const totalProfit   = activeStreams.reduce((s, r) => s + r.profitInCredits, 0);
  const totalRevenue  = activeStreams.reduce((s, r) => s + r.totalRetailCreditsCharged, 0);
  const totalApiCost  = activeStreams.reduce((s, r) => s + r.totalApiCreditsUsed, 0);
  const API_COST_RATE = 2.3;

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-wide flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-green-400" />
              Live Profit Dashboard
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Real-time per-stream profit analytics. Billing rate always from database. Updates every 1s.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground font-mono">
                {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "hsl(142 76% 36% / 0.12)", border: "1px solid hsl(142 76% 36% / 0.3)" }}>
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400 font-mono font-semibold">LIVE</span>
            </div>
          </div>
        </div>

        {/* Error banner (non-fatal) */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg p-3 text-sm text-yellow-400" style={{ background: "hsl(45 100% 50% / 0.08)", border: "1px solid hsl(45 100% 50% / 0.25)" }}>
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Billing rate info bar — DB value only, never hardcoded */}
        {billingInfo && (
          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
            <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-3">
              Current Billing Config (source: database)
            </p>
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground font-mono">Rate</span>
                <span className="text-sm font-bold text-primary font-mono">{billingInfo.rate} cr/s</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">Burn ×</span>
                <span className={`text-sm font-bold font-mono ${billingInfo.burnMultiplier > 1 ? "text-orange-400" : billingInfo.burnMultiplier < 1 ? "text-blue-400" : "text-green-400"}`}>
                  {billingInfo.burnMultiplier}×
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">Depletion</span>
                <span className="text-sm font-bold text-foreground font-mono">{billingInfo.liveBurnSpeed} sec/real-sec</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">Profit/sec</span>
                <span className={`text-sm font-bold font-mono ${billingInfo.rate - API_COST_RATE > 0 ? "text-green-400" : "text-red-400"}`}>
                  {(billingInfo.rate - API_COST_RATE).toFixed(1)} cr/s
                </span>
              </div>
              <p className="text-xs text-muted-foreground font-mono flex-1 min-w-0 truncate">
                {billingInfo.burnPreview}
              </p>
            </div>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-blue-400" />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Active Streams</p>
            </div>
            <p className="text-2xl font-bold text-foreground font-mono">{activeStreams.length}</p>
          </div>

          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-primary" />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Live Revenue</p>
            </div>
            <p className="text-2xl font-bold text-primary font-mono">{totalRevenue.toFixed(1)} cr</p>
            <p className="text-xs text-muted-foreground font-mono">${(totalRevenue * 0.01).toFixed(2)} USD</p>
          </div>

          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(0 84% 60% / 0.2)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-red-400" />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">API Cost (2.3 cr/s)</p>
            </div>
            <p className="text-2xl font-bold text-red-400 font-mono">{totalApiCost.toFixed(1)} cr</p>
            <p className="text-xs text-muted-foreground font-mono">${(totalApiCost * 0.01).toFixed(2)} USD</p>
          </div>

          <div
            className="rounded-xl p-4"
            style={{
              background: "hsl(222 44% 6%)",
              border: `1px solid ${totalProfit > 0 ? "hsl(142 76% 36% / 0.35)" : totalProfit < 0 ? "hsl(0 84% 60% / 0.25)" : "hsl(222 40% 14%)"}`,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className={`w-4 h-4 ${totalProfit > 0 ? "text-green-400" : totalProfit < 0 ? "text-red-400" : "text-muted-foreground"}`} />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Net Profit</p>
            </div>
            <p className={`text-2xl font-bold font-mono ${totalProfit > 0 ? "text-green-400" : totalProfit < 0 ? "text-red-400" : "text-muted-foreground"}`}>
              {totalProfit >= 0 ? "+" : ""}{totalProfit.toFixed(1)} cr
            </p>
            <p className="text-xs text-muted-foreground font-mono">${(totalProfit * 0.01).toFixed(2)} USD</p>
          </div>
        </div>

        {/* Per-stream breakdown table */}
        <div>
          <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-3">
            Per-Stream Breakdown — {activeStreams.length} active
          </p>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "hsl(222 44% 6%)" }}>
                    <th className="text-left px-4 py-3 text-muted-foreground font-mono text-xs font-medium">License Key</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-mono text-xs font-medium">Used Secs</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-mono text-xs font-medium">Billing Rate</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-mono text-xs font-medium">Rev/sec</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-mono text-xs font-medium">Cost/sec</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-mono text-xs font-medium">Profit/sec</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-mono text-xs font-medium">Total Profit</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-mono text-xs font-medium">Burn ×</th>
                  </tr>
                </thead>
                <tbody>
                  {activeStreams.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-14 text-muted-foreground text-sm font-mono">
                        No active streams — dashboard updates automatically when streams go live
                      </td>
                    </tr>
                  ) : activeStreams.map(s => {
                    const profitPerSec = (s.lastBillingRateUsed ?? billingInfo?.rate ?? 0) - API_COST_RATE;
                    const isProfit     = profitPerSec > 0.005;
                    const isLoss       = profitPerSec < -0.005;

                    return (
                      <tr key={s.streamGroupId} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}>
                        <td className="px-4 py-3 font-mono text-xs text-foreground">
                          {s.licenseKey
                            ? `${s.licenseKey.substring(0, 8)}…${s.licenseKey.slice(-4)}`
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-foreground">
                          {s.totalBillableSeconds.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-primary">
                          {s.lastBillingRateUsed} cr/s
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-primary">
                          {s.lastBillingRateUsed}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-red-400">
                          {API_COST_RATE}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-xs font-semibold ${isProfit ? "text-green-400" : isLoss ? "text-red-400" : "text-yellow-400"}`}>
                          {profitPerSec >= 0 ? "+" : ""}{profitPerSec.toFixed(1)}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-xs font-bold ${s.profitInCredits > 0 ? "text-green-400" : s.profitInCredits < 0 ? "text-red-400" : "text-yellow-400"}`}>
                          {s.profitInCredits >= 0 ? "+" : ""}{s.profitInCredits.toFixed(1)} cr
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-orange-400">
                          {s.burnMultiplier}×
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Formula reference — read-only */}
        <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
          <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-3">
            Billing Formula (read-only observability)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
            <div className="p-2.5 rounded" style={{ background: "hsl(222 47% 4%)" }}>
              <span className="text-muted-foreground">revenue = </span>
              <span className="text-primary">used_secs × billing_rate</span>
            </div>
            <div className="p-2.5 rounded" style={{ background: "hsl(222 47% 4%)" }}>
              <span className="text-muted-foreground">api_cost = </span>
              <span className="text-red-400">used_secs × 2.3</span>
            </div>
            <div className="p-2.5 rounded" style={{ background: "hsl(222 47% 4%)" }}>
              <span className="text-muted-foreground">profit = </span>
              <span className="text-green-400">revenue − api_cost</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono mt-2">
            billing_rate is always read from the database. api_cost_rate is a fixed constant (2.3 cr/s). No values are hardcoded.
          </p>
        </div>

      </div>
    </AdminLayout>
  );
}
