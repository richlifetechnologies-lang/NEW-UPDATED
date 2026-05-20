import { useState, useEffect, useCallback, useRef } from "react";
import { AdminLayout } from "@/components/admin-layout";
import {
  Timer, Activity, TrendingUp, Zap, RefreshCw,
  Search, X, AlertTriangle, Loader2, ShieldCheck,
} from "lucide-react";

const API_BASE = `/api/admin/billing-rate-per-key`;
const authH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token") ?? ""}`,
});

async function apiFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { headers: authH() });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

interface KeyRow {
  licenseKeyId: number;
  licenseKey: string;
  isActive: boolean;
  effectiveRate: number;
  compressionFactor: number;
  usedSeconds: number;
  displaySecondsUsed: number;
  remainingSeconds: number;
  displaySecondsRemaining: number;
  isLive: boolean;
  activeSessionCount: number;
  projectedProfitPct: number;
  profitPerSecond: number;
  rateSource: "custom" | "global";
  allocatedSeconds: number;
}

interface ListResponse {
  keys: KeyRow[];
  globalBillingRate: number;
  apiCostRate: number;
  total: number;
}

const TCE_BASE = 2.3;

function compressionFactor(rate: number): number {
  if (rate <= 0) return 1;
  return Math.round((rate / TCE_BASE) * 1000) / 1000;
}

function fmtSec(sec: number): string {
  if (sec <= 0) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0 && m === 0 && s === 0) return `${h}h`;
  if (h > 0) return s > 0 ? `${h}h ${m}m ${s}s` : `${h}h ${m}m`;
  return s > 0 && m === 0 ? `${s}s` : s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtKey(k: string): string {
  if (k.length <= 12) return k;
  return `${k.substring(0, 8)}…${k.slice(-4)}`;
}

function CompressionBadge({ factor }: { factor: number }) {
  const color = factor > 1.5 ? "#26de81" : factor > 1.0 ? "#fed330" : factor === 1.0 ? "#a0aec0" : "#fc5c65";
  const label = factor > 1.5 ? "HIGH" : factor > 1.0 ? "MED" : factor === 1.0 ? "NEUTRAL" : "LOSS";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold"
      style={{ background: color + "18", border: `1px solid ${color}40`, color }}
    >
      {label}
    </span>
  );
}

export default function AdminTimeCompressionPage() {
  const [data, setData]           = useState<ListResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [apiError, setApiError]   = useState<string | null>(null);
  const [search, setSearch]       = useState("");
  const [lastPoll, setLastPoll]   = useState<Date | null>(null);
  const intervalRef               = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (q?: string) => {
    const s = (q ?? search).trim();
    const url = `${API_BASE}?limit=500${s ? `&search=${encodeURIComponent(s)}` : ""}`;
    const result = await apiFetch<ListResponse>(url);
    if (result) {
      setData(result);
      setApiError(null);
    } else {
      setApiError("Failed to load — check connection");
    }
    setLastPoll(new Date());
    setLoading(false);
  }, [search]);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(() => fetchData(), 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const keys         = data?.keys ?? [];
  const globalRate   = data?.globalBillingRate ?? 0;
  const apiCostRate  = data?.apiCostRate ?? 2.3;
  const globalCF     = compressionFactor(globalRate);

  const totalRealSecs    = keys.reduce((a, k) => a + k.usedSeconds, 0);
  const totalDisplaySecs = keys.reduce((a, k) => a + (k.displaySecondsUsed ?? Math.round(k.usedSeconds * compressionFactor(k.effectiveRate))), 0);
  const liveKeys         = keys.filter(k => k.isLive).length;
  const customKeys       = keys.filter(k => k.rateSource === "custom").length;

  const filtered = search
    ? keys.filter(k => k.licenseKey.toLowerCase().includes(search.toLowerCase()))
    : keys;

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-wide flex items-center gap-2">
              <Timer className="w-6 h-6 text-primary" />
              Time Compression Dashboard
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Real vs display time per licence key · compression_factor = billing_rate ÷ {apiCostRate}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastPoll && (
              <span className="text-xs text-muted-foreground font-mono">{lastPoll.toLocaleTimeString()}</span>
            )}
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: "hsl(142 76% 36% / 0.12)", border: "1px solid hsl(142 76% 36% / 0.3)" }}
            >
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400 font-mono font-semibold">LIVE 2s</span>
            </div>
          </div>
        </div>

        {/* ── Error ── */}
        {apiError && (
          <div
            className="flex items-start gap-3 rounded-lg p-4"
            style={{ background: "hsl(0 84% 60% / 0.08)", border: "1px solid hsl(0 84% 60% / 0.3)" }}
          >
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-400 font-mono text-xs">{apiError}</p>
          </div>
        )}

        {/* ── TCE Explanation card ── */}
        <div
          className="rounded-xl p-4 space-y-2"
          style={{ background: "hsl(222 44% 5%)", border: "1px solid hsl(187 100% 52% / 0.15)" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span className="text-xs font-mono font-bold text-primary uppercase tracking-wider">TCE Layer — UX Only · Billing Unaffected</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
            <div className="rounded-lg p-3" style={{ background: "hsl(187 100% 52% / 0.05)", border: "1px solid hsl(187 100% 52% / 0.15)" }}>
              <p className="text-muted-foreground mb-1">compression_factor</p>
              <p className="text-foreground font-bold">= billing_rate ÷ {apiCostRate}</p>
              <p className="text-muted-foreground mt-1 text-[10px]">Global: {globalRate} ÷ {apiCostRate} = <span className="text-primary font-bold">{globalCF}×</span></p>
            </div>
            <div className="rounded-lg p-3" style={{ background: "hsl(142 76% 36% / 0.05)", border: "1px solid hsl(142 76% 36% / 0.15)" }}>
              <p className="text-muted-foreground mb-1">display_seconds</p>
              <p className="text-foreground font-bold">= real_seconds × factor</p>
              <p className="text-muted-foreground mt-1 text-[10px]">User sees compressed virtual time</p>
            </div>
            <div className="rounded-lg p-3" style={{ background: "hsl(0 84% 60% / 0.05)", border: "1px solid hsl(0 84% 60% / 0.15)" }}>
              <p className="text-muted-foreground mb-1">wallet truth</p>
              <p className="text-foreground font-bold">= real heartbeat seconds</p>
              <p className="text-muted-foreground mt-1 text-[10px]">Billing always uses real_seconds only</p>
            </div>
          </div>
        </div>

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Timer className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Total Real Time</p>
            </div>
            <p className="text-2xl font-bold text-foreground font-mono">{fmtSec(totalRealSecs)}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-1">wallet.used_seconds truth</p>
          </div>

          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.25)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-primary" />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Total Display Time</p>
            </div>
            <p className="text-2xl font-bold text-primary font-mono">{fmtSec(totalDisplaySecs)}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-1">compressed UX time shown to users</p>
          </div>

          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(142 76% 36% / 0.25)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-green-400" />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Live Streams</p>
            </div>
            <p className="text-2xl font-bold text-green-400 font-mono">{liveKeys}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-1">Active compression sessions</p>
          </div>

          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Global Factor</p>
            </div>
            <p className="text-2xl font-bold text-foreground font-mono">{globalCF}×</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-1">{customKeys} keys with custom rate</p>
          </div>
        </div>

        {/* ── Search ── */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 flex-1 max-w-sm rounded-lg px-3 py-2"
            style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 18%)" }}
          >
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search licence key…"
              className="bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none flex-1"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono">{filtered.length} key{filtered.length !== 1 ? "s" : ""}</p>
        </div>

        {/* ── Table ── */}
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "hsl(222 44% 6%)" }}>
                  {[
                    "Licence Key",
                    "Effective Rate",
                    "Compress×",
                    "Real Used",
                    "Display Used",
                    "Real Remaining",
                    "Display Remaining",
                    "Revenue",
                    "API Cost",
                    "Profit/s",
                    "Status",
                    "Health",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-right first:text-left"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  <tr>
                    <td colSpan={12} className="text-center py-16">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
                      <p className="text-muted-foreground text-xs font-mono mt-2">Loading compression data…</p>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="text-center py-16">
                      <Timer className="w-8 h-8 mx-auto mb-3 opacity-20 text-foreground" />
                      <p className="text-muted-foreground font-mono text-sm">
                        {search ? "No keys match your search" : "No licence keys found"}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filtered.map(row => {
                    const cf           = row.compressionFactor ?? compressionFactor(row.effectiveRate);
                    const realUsed     = row.usedSeconds;
                    const dispUsed     = row.displaySecondsUsed ?? Math.round(realUsed * cf);
                    const realRem      = row.remainingSeconds;
                    const dispRem      = row.displaySecondsRemaining ?? Math.round(realRem * cf);
                    const revenue      = Math.round(realUsed * row.effectiveRate * 100) / 100;
                    const apiCost      = Math.round(realUsed * apiCostRate * 100) / 100;
                    const profitPs     = row.profitPerSecond;
                    const profitable   = profitPs >= 0;

                    return (
                      <tr
                        key={row.licenseKeyId}
                        style={{ borderTop: "1px solid hsl(222 40% 11%)" }}
                        className={row.isLive ? "bg-green-400/[0.02]" : ""}
                      >
                        {/* Licence Key */}
                        <td className="px-3 py-2.5 font-mono text-foreground whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.isActive ? "bg-green-400" : "bg-muted"}`} />
                            <span title={row.licenseKey}>{fmtKey(row.licenseKey)}</span>
                            {row.rateSource === "custom" && (
                              <span className="text-[9px] font-mono px-1 rounded" style={{ background: "hsl(187 100% 52% / 0.15)", color: "hsl(187 100% 52%)", border: "1px solid hsl(187 100% 52% / 0.3)" }}>C</span>
                            )}
                          </div>
                        </td>

                        {/* Effective Rate */}
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground whitespace-nowrap">
                          {row.effectiveRate} cr/s
                        </td>

                        {/* Compression Factor */}
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className={`font-bold font-mono text-sm ${cf > 1 ? "text-primary" : cf < 1 ? "text-red-400" : "text-muted-foreground"}`}>
                              {cf}×
                            </span>
                            <CompressionBadge factor={cf} />
                          </div>
                        </td>

                        {/* Real Used */}
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground whitespace-nowrap">
                          {fmtSec(realUsed)}
                        </td>

                        {/* Display Used */}
                        <td className="px-3 py-2.5 text-right font-mono text-primary whitespace-nowrap">
                          {fmtSec(dispUsed)}
                        </td>

                        {/* Real Remaining */}
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground whitespace-nowrap">
                          {fmtSec(realRem)}
                        </td>

                        {/* Display Remaining */}
                        <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                          <span className={realRem <= 0 ? "text-red-400" : "text-green-400"}>
                            {fmtSec(dispRem)}
                          </span>
                        </td>

                        {/* Revenue */}
                        <td className="px-3 py-2.5 text-right font-mono text-foreground whitespace-nowrap">
                          {revenue > 0 ? `${revenue} cr` : <span className="text-muted-foreground">—</span>}
                        </td>

                        {/* API Cost */}
                        <td className="px-3 py-2.5 text-right font-mono text-red-400/70 whitespace-nowrap">
                          {apiCost > 0 ? `${apiCost} cr` : <span className="text-muted-foreground">—</span>}
                        </td>

                        {/* Profit/s */}
                        <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                          <span className={profitable ? "text-green-400" : "text-red-400"}>
                            {profitPs >= 0 ? "+" : ""}{profitPs} cr/s
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {row.isLive ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-green-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> LIVE
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono text-muted-foreground">idle</span>
                          )}
                        </td>

                        {/* Health */}
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {!row.isActive ? (
                            <span className="text-[10px] font-mono text-red-400/70">inactive</span>
                          ) : realRem <= 0 ? (
                            <span className="text-[10px] font-mono text-red-400">depleted</span>
                          ) : realRem < 300 ? (
                            <span className="text-[10px] font-mono text-amber-400">low</span>
                          ) : (
                            <span className="text-[10px] font-mono text-green-400/70">healthy</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Legend ── */}
        <div
          className="rounded-xl p-4 text-xs font-mono space-y-1.5"
          style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 11%)" }}
        >
          <p className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px] mb-2">Legend</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
            <p><span className="text-primary">Compress×</span> = effective_billing_rate ÷ {apiCostRate} (TCE factor)</p>
            <p><span className="text-foreground">Real Used</span> = wallet.used_seconds (billing truth)</p>
            <p><span className="text-primary">Display Used</span> = real_used × compress× (user UX only)</p>
            <p><span className="text-green-400">Display Remaining</span> = real_remaining × compress× (shown to user)</p>
            <p><span className="text-foreground">Revenue</span> = real_seconds × billing_rate</p>
            <p><span className="text-red-400/70">API Cost</span> = real_seconds × {apiCostRate} (fixed Decart rate)</p>
            <p><span className="text-green-400">Profit/s</span> = billing_rate − {apiCostRate} (per real second)</p>
            <p><span className="text-[#a0aec0]">C badge</span> = key has custom billing rate override</p>
          </div>
        </div>

      </div>
    </AdminLayout>
  );
}
