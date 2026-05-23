/**
 * admin-analytics.tsx — Billing Analytics · Production Control Center
 * Data source: /api/admin/billing-rate-per-key (existing, tested endpoint)
 * READ ONLY — no billing mutations. All derived from wallet.used_seconds.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { AdminLayout } from "@/components/admin-layout";
import {
  Activity, AlertTriangle, BarChart3, Clock, DollarSign,
  Key, Loader2, RefreshCw, Search, TrendingUp, Zap,
  Timer, X, CheckCircle2, Eye, Wifi, Database, Flame,
} from "lucide-react";

const COST_RATE = 2.3; // Decart API cost — fixed infrastructure constant

const authH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token") ?? ""}`,
});

async function apiFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: authH() });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface BrkKey {
  licenseKeyId: number; licenseKey: string; isActive: boolean; streamingEnabled: boolean;
  globalBillingRate: number; customBillingRate: number | null; useCustomBillingRate: boolean;
  effectiveRate: number; rateSource: string; compressionFactor: number;
  displaySecondsUsed: number; displaySecondsRemaining: number;
  projectedProfitPct: number; profitPerSecond: number; isLive: boolean;
  activeSessionCount: number; allocatedSeconds: number; usedSeconds: number;
  remainingSeconds: number; minutesAllocated: number;
}
interface BrkResponse {
  keys: BrkKey[]; globalBillingRate: number; apiCostRate: number; total: number; computedAt: string;
}
interface DecartKey {
  id: number; label: string; isActive: boolean; maxUsers: number | null;
  usageLoad: number | null; healthStatus: string | null;
  totalCreditsLoaded: number; creditsBaseline: number;
  assignedLicenseKey: string | null; thresholdPct: number;
}
interface GhostSession {
  sessionId?: string; id?: string; licenseKey?: string;
  lastHeartbeat?: string | null; lastHeartbeatAt?: string | null;
  startedAt?: string; orphanAgeSeconds?: number; status?: string;
}
interface RevenueData {
  dailyRevenue: { day: string; total: string }[];
  topKeysByUsage: { id: number; key: string; usedSeconds: number; minutesAllocated: number; efficiencyPercent: number; profitCredits: number }[];
  billingRate: number;
  checkedAt: string;
}
interface WalletKey {
  id: number; key: string; remainingSeconds: number; realStreamRemainingSeconds: number;
  effectiveBillingRate: number; burnRateSecPerHour: number | null;
  hoursUntilExhausted: number | null; risk: string;
}
interface WalletData { keys: WalletKey[]; globalBillingRate: number; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtSec(s: number): string {
  if (!s || s <= 0) return "0s";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  return `${sec}s`;
}
function fmtKey(k: string): string {
  return k && k.length > 14 ? `${k.slice(0, 8)}…${k.slice(-4)}` : (k ?? "—");
}
function fmtTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return "—"; }
}
function marginPct(rate: number, cost: number): number {
  // profit-on-cost ratio: (rate - cost) / cost × 100
  return cost > 0 ? Math.round(((rate - cost) / cost) * 1000) / 10 : 0;
}
function driftBg(h: string): string {
  if (h === "good")    return "rgba(38,222,129,0.12)";
  if (h === "warning") return "rgba(254,211,48,0.12)";
  return "rgba(252,92,101,0.12)";
}
function driftFg(h: string): string {
  if (h === "good")    return "#26de81";
  if (h === "warning") return "#fed330";
  return "#fc5c65";
}
function driftBdr(h: string): string {
  if (h === "good")    return "rgba(38,222,129,0.3)";
  if (h === "warning") return "rgba(254,211,48,0.3)";
  return "rgba(252,92,101,0.3)";
}
function riskColor(risk: string): string {
  if (risk === "healthy")  return "#26de81";
  if (risk === "low")      return "#fed330";
  return "#fc5c65";
}

function SCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub?: string; color?: string; icon: any;
}) {
  return (
    <div className="rounded-xl p-4"
      style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color: color ?? "hsl(215 20% 55%)" }} />
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className="text-xl font-bold font-mono" style={{ color: color ?? "hsl(var(--foreground))" }}>{value}</p>
      {sub && <p className="text-[10px] font-mono text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

const TH = ({ children, left }: { children: string; left?: boolean }) => (
  <th className={`px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap ${left ? "text-left" : "text-right"}`}>
    {children}
  </th>
);

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">{children}</table>
      </div>
    </div>
  );
}

// ── Credit Usage types ────────────────────────────────────────────────────────
interface CreditUsageKey {
  keyLabel: string; sessionCount: number; decartCredits: number;
  retailCredits: number; marginCredits: number; decartCredits24h: number; decartCredits7d: number;
}
interface CreditUsageBucket { hour?: string; day?: string; decartCredits: number; marginCredits: number; sessions: number; }
interface CreditUsageData {
  billingRate: number; decartCostRate: number; compressionFactor: number;
  keys: CreditUsageKey[]; hourly: CreditUsageBucket[]; daily: CreditUsageBucket[];
  totals: { totalDecartCredits: number; totalMarginCredits: number; marginPct: number };
  computedAt: string;
}

const BI_API = (path: string) => `/api/admin/billing-intelligence${path}`;

async function biApiFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(BI_API(path), {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token") ?? ""}`,
      },
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch { return null; }
}

function CreditUsagePanel({ liveKeys, apiCostRate }: { liveKeys: BrkKey[]; apiCostRate: number }) {
  const [data, setData]       = useState<CreditUsageData | null>(null);
  const [cuLoading, setCuLoading] = useState(true);
  const [cuError, setCuError]   = useState(false);
  const [view, setView]         = useState<"keys" | "hourly" | "daily" | "scenario" | "live-burn">("keys");

  const load = useCallback(async () => {
    setCuLoading(true); setCuError(false);
    const res = await biApiFetch<CreditUsageData>("/credit-usage");
    if (res) setData(res); else setCuError(true);
    setCuLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const fmtC = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000   ? `${(n / 1_000).toFixed(1)}k`
    : n.toFixed(0);

  const maxBar = (arr: number[]) => Math.max(...arr, 1);

  const scenarios = data ? [1, 30, 60].map(mins => {
    const walletSec  = mins * 60;
    const realSec    = walletSec / data.compressionFactor;
    const decartCost = realSec * data.decartCostRate;
    const margin     = realSec * (data.billingRate - data.decartCostRate);
    return { mins, walletSec, realSec: Math.round(realSec), decartCost: Math.round(decartCost), margin: Math.round(margin) };
  }) : [];

  const subTabs = [
    { id: "live-burn" as const, label: "🔥 Live Burn" },
    { id: "keys"      as const, label: "Per-Key Totals" },
    { id: "hourly"    as const, label: "Last 24 h (hourly)" },
    { id: "daily"     as const, label: "Last 7 d (daily)" },
    { id: "scenario"  as const, label: "Real-World Scenarios" },
  ];

  return (
    <div className="space-y-5">
      {/* Banner */}
      <div className="flex items-start gap-2.5 rounded-xl p-4 text-xs"
        style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.25)", color: "#67e8f9" }}>
        <Zap className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#22d3ee" }} />
        <div>
          <span className="font-semibold">Credit Usage Monitor — </span>
          Read-only. Shows Decart credits consumed per API key and over time. Refreshes every 30 s.
          {data && (
            <span className="ml-1">
              Billing rate: <strong style={{ color: "#a5f3fc" }}>{data.billingRate} cr/s</strong>
              {" · "}Decart cost: <strong style={{ color: "#a5f3fc" }}>{data.decartCostRate} cr/s</strong>
              {" · "}Compression: <strong style={{ color: "#a5f3fc" }}>{data.compressionFactor}×</strong>
            </span>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Decart Credits", value: fmtC(data.totals.totalDecartCredits),  color: "#fc5c65" },
            { label: "Total Margin Credits", value: fmtC(data.totals.totalMarginCredits),  color: "#26de81" },
            { label: "Gross Margin",         value: `${data.totals.marginPct}%`,           color: "#fed330" },
            { label: "Decart Keys",          value: String(data.keys.length),              color: "hsl(215 20% 55%)" },
          ].map(c => (
            <div key={c.label} className="rounded-xl p-3" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{c.label}</p>
              <p className="text-xl font-bold mt-1 font-mono" style={{ color: c.color }}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={load} disabled={cuLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors"
          style={{ border: "1px solid hsl(222 40% 18%)", color: "hsl(215 20% 55%)" }}>
          <RefreshCw className={`w-3 h-3 ${cuLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ border: "1px solid hsl(222 40% 18%)", background: "hsl(222 44% 6%)" }}>
          {subTabs.map(st => (
            <button key={st.id} onClick={() => setView(st.id)}
              className="px-3 py-1 rounded-md text-xs transition-colors font-mono"
              style={view === st.id
                ? { background: "hsl(222 40% 18%)", color: "hsl(var(--foreground))" }
                : { color: "hsl(215 20% 55%)" }}>
              {st.label}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-[10px] font-mono text-muted-foreground ml-auto">
            computed {new Date(data.computedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {cuError && (
        <div className="rounded-xl p-6 text-center text-sm" style={{ background: "rgba(252,92,101,0.08)", border: "1px solid rgba(252,92,101,0.25)", color: "#fc5c65" }}>
          Failed to load credit usage data.
        </div>
      )}
      {cuLoading && !data && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Per-Key Totals */}
      {data && view === "keys" && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
          <div className="px-5 py-4" style={{ background: "hsl(222 44% 6%)", borderBottom: "1px solid hsl(222 40% 11%)" }}>
            <p className="text-sm font-semibold">Decart Credits per API Key — all time</p>
            <p className="text-xs text-muted-foreground mt-0.5">Each bar = total Decart credits consumed by sessions routed through that key.</p>
          </div>
          <div className="p-5 space-y-4" style={{ background: "hsl(222 44% 5%)" }}>
            {data.keys.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No session data yet.</p>}
            {data.keys.map(k => {
              const pct = Math.round((k.decartCredits / maxBar(data.keys.map(x => x.decartCredits))) * 100);
              const mPct = k.decartCredits + k.marginCredits > 0
                ? Math.round((k.marginCredits / (k.decartCredits + k.marginCredits)) * 100) : 0;
              return (
                <div key={k.keyLabel} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium truncate max-w-[200px]">{k.keyLabel}</span>
                    <div className="flex items-center gap-4 text-muted-foreground shrink-0 ml-2">
                      <span className="font-mono" style={{ color: "#fc5c65" }}>{fmtC(k.decartCredits)} cr</span>
                      <span className="font-mono" style={{ color: "#26de81" }}>+{fmtC(k.marginCredits)} margin</span>
                      <span>{k.sessionCount} sessions</span>
                    </div>
                  </div>
                  <div className="h-5 rounded overflow-hidden flex" style={{ background: "hsl(222 40% 11%)" }}>
                    <div className="h-full transition-all" style={{ width: `${pct * (100 - mPct) / 100}%`, background: "rgba(252,92,101,0.7)" }} />
                    <div className="h-full transition-all" style={{ width: `${pct * mPct / 100}%`, background: "rgba(38,222,129,0.6)" }} />
                  </div>
                  <div className="flex gap-4 text-[10px] text-muted-foreground">
                    <span>24 h: {fmtC(k.decartCredits24h)} cr</span>
                    <span>7 d: {fmtC(k.decartCredits7d)} cr</span>
                    <span>{mPct}% margin</span>
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-4 pt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2.5 rounded-sm" style={{ background: "rgba(252,92,101,0.7)" }} />Decart cost</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2.5 rounded-sm" style={{ background: "rgba(38,222,129,0.6)" }} />Your margin</span>
            </div>
          </div>
        </div>
      )}

      {/* Hourly chart */}
      {data && view === "hourly" && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
          <div className="px-5 py-4" style={{ background: "hsl(222 44% 6%)", borderBottom: "1px solid hsl(222 40% 11%)" }}>
            <p className="text-sm font-semibold">Decart Credits — last 24 hours (per hour)</p>
            <p className="text-xs text-muted-foreground mt-0.5">Hourly Decart credit burn rate across all keys.</p>
          </div>
          <div className="p-5" style={{ background: "hsl(222 44% 5%)" }}>
            {data.hourly.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No sessions in the last 24 hours.</p>}
            {data.hourly.length > 0 && (
              <div className="flex items-end gap-1 h-36 overflow-x-auto">
                {data.hourly.map((h, i) => {
                  const maxV = maxBar(data.hourly.map(x => x.decartCredits + x.marginCredits));
                  const totalH = h.decartCredits + h.marginCredits;
                  const pct = Math.round((totalH / maxV) * 100);
                  const dPct = totalH > 0 ? Math.round((h.decartCredits / totalH) * pct) : 0;
                  const mPctH = pct - dPct;
                  const label = h.hour ? new Date(h.hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                  return (
                    <div key={i} className="flex flex-col items-center gap-0.5 min-w-[28px] group cursor-default"
                      title={`${label}\nDecart: ${fmtC(h.decartCredits)} cr\nMargin: ${fmtC(h.marginCredits)} cr\nSessions: ${h.sessions}`}>
                      <div className="flex flex-col-reverse items-stretch w-full" style={{ height: "120px" }}>
                        <div className="w-full rounded-t-sm transition-all" style={{ height: `${dPct}%`, background: "rgba(252,92,101,0.7)" }} />
                        <div className="w-full transition-all" style={{ height: `${mPctH}%`, background: "rgba(38,222,129,0.6)" }} />
                      </div>
                      <span className="text-[9px] text-muted-foreground rotate-[-45deg] origin-center mt-1 w-5 truncate">{label.slice(0, 5)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Daily chart */}
      {data && view === "daily" && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
          <div className="px-5 py-4" style={{ background: "hsl(222 44% 6%)", borderBottom: "1px solid hsl(222 40% 11%)" }}>
            <p className="text-sm font-semibold">Decart Credits — last 7 days (per day)</p>
            <p className="text-xs text-muted-foreground mt-0.5">Daily Decart credit burn. Red = Decart cost, green = your margin on top.</p>
          </div>
          <div className="p-5" style={{ background: "hsl(222 44% 5%)" }}>
            {data.daily.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No sessions in the last 7 days.</p>}
            {data.daily.length > 0 && (
              <div className="flex items-end gap-2 h-36">
                {data.daily.map((d, i) => {
                  const maxV = maxBar(data.daily.map(x => x.decartCredits + x.marginCredits));
                  const totalD = d.decartCredits + d.marginCredits;
                  const pct = Math.round((totalD / maxV) * 100);
                  const dPct = totalD > 0 ? Math.round((d.decartCredits / totalD) * pct) : 0;
                  const mPctD = pct - dPct;
                  const label = d.day ? new Date(d.day).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group cursor-default"
                      title={`${label}\nDecart: ${fmtC(d.decartCredits)} cr\nMargin: ${fmtC(d.marginCredits)} cr\nSessions: ${d.sessions}`}>
                      <div className="flex flex-col-reverse items-stretch w-full" style={{ height: "112px" }}>
                        <div className="w-full rounded-t-sm" style={{ height: `${dPct}%`, background: "rgba(252,92,101,0.7)" }} />
                        <div className="w-full" style={{ height: `${mPctD}%`, background: "rgba(38,222,129,0.6)" }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground mt-1">{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── LIVE BURN (always rendered regardless of data load state) ── */}
      {view === "live-burn" && (
        <LiveCreditBurnPanel liveKeys={liveKeys} apiCostRate={apiCostRate} />
      )}

      {data && view === "scenario" && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
          <div className="px-5 py-4" style={{ background: "hsl(222 44% 6%)", borderBottom: "1px solid hsl(222 40% 11%)" }}>
            <p className="text-sm font-semibold">Real-World Key Scenarios</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              At billing rate <strong>{data.billingRate} cr/s</strong> vs Decart's{" "}
              <strong>{data.decartCostRate} cr/s</strong> (compression <strong>{data.compressionFactor}×</strong>).
            </p>
          </div>
          <div className="overflow-x-auto" style={{ background: "hsl(222 44% 5%)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "hsl(222 44% 6%)", borderBottom: "1px solid hsl(222 40% 11%)" }}>
                  {["Key Sold", "Wallet Time", "Real Stream Time", "Decart Costs You", "Your Margin", "Margin %"].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-mono font-medium whitespace-nowrap text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scenarios.map((sc, i) => {
                  const mins = Math.floor(sc.realSec / 60);
                  const secs = sc.realSec % 60;
                  const display = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                  const mPct = Math.round((sc.margin / (sc.decartCost + sc.margin)) * 100);
                  return (
                    <tr key={sc.mins} style={{ background: i % 2 === 0 ? ROW_A : ROW_B, borderTop: BORDER }}>
                      <td className="px-4 py-3 font-semibold font-mono">{sc.mins} min key</td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">{sc.mins}:00</td>
                      <td className="px-4 py-3 font-mono" style={{ color: "#67e8f9" }}>{display}</td>
                      <td className="px-4 py-3 font-mono" style={{ color: "#fc5c65" }}>{sc.decartCost.toLocaleString()} cr</td>
                      <td className="px-4 py-3 font-mono" style={{ color: "#26de81" }}>+{sc.margin.toLocaleString()} cr</td>
                      <td className="px-4 py-3 font-mono" style={{ color: "#fed330" }}>{mPct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-4 text-xs text-muted-foreground space-y-1" style={{ background: "hsl(222 44% 6%)", borderTop: "1px solid hsl(222 40% 11%)" }}>
            <p><strong className="text-foreground">Compression factor {data.compressionFactor}×</strong> — for every 1 wallet-second, only {(1/data.compressionFactor).toFixed(3)}s is actually streamed.</p>
            <p><strong className="text-foreground">Hard-kill buffer:</strong> 3 wallet-seconds reserved — stream ends ~{(3 / data.compressionFactor).toFixed(1)}s before wallet hits zero.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Live Credit Burn Panel ────────────────────────────────────────────────────
interface BurnEntry {
  licenseKeyId: number;
  licenseKey: string;
  inputBalance: string;       // raw text the admin types
  committedBalance: number;   // confirmed credit balance (set on Enter / blur)
  burnedSinceCommit: number;  // credits burned since last commit (ticks every second)
  committedAt: number;        // timestamp of last commit (ms)
  activeSessionCount: number;
  effectiveRate: number;
  isLive: boolean;
}

function LiveCreditBurnPanel({ liveKeys, apiCostRate }: { liveKeys: BrkKey[]; apiCostRate: number }) {
  // Map keyed by licenseKeyId — persists across parent re-renders
  const [entries, setEntries] = useState<Record<number, BurnEntry>>({});
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync live session counts from parent (every 3 s) without resetting committed balances
  useEffect(() => {
    setEntries(prev => {
      const next = { ...prev };
      liveKeys.forEach(k => {
        if (next[k.licenseKeyId]) {
          // update live fields only
          next[k.licenseKeyId] = {
            ...next[k.licenseKeyId],
            activeSessionCount: k.activeSessionCount,
            effectiveRate: k.effectiveRate,
            isLive: k.isLive,
          };
        } else {
          // first time we see this key
          next[k.licenseKeyId] = {
            licenseKeyId: k.licenseKeyId,
            licenseKey: k.licenseKey,
            inputBalance: "",
            committedBalance: 0,
            burnedSinceCommit: 0,
            committedAt: 0,
            activeSessionCount: k.activeSessionCount,
            effectiveRate: k.effectiveRate,
            isLive: k.isLive,
          };
        }
      });
      return next;
    });
  }, [liveKeys]);

  // Tick every second — burn credits on live keys
  useEffect(() => {
    tickRef.current = setInterval(() => {
      setEntries(prev => {
        const next = { ...prev };
        Object.values(next).forEach(e => {
          if (e.isLive && e.committedBalance > 0 && e.activeSessionCount > 0) {
            const burnPerSec = apiCostRate * e.activeSessionCount;
            next[e.licenseKeyId] = {
              ...e,
              burnedSinceCommit: Math.min(
                e.burnedSinceCommit + burnPerSec,
                e.committedBalance
              ),
            };
          }
        });
        return next;
      });
    }, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [apiCostRate]);

  const commit = (id: number) => {
    setEntries(prev => {
      const e = prev[id];
      if (!e) return prev;
      const val = parseFloat(e.inputBalance.replace(/,/g, ""));
      if (isNaN(val) || val <= 0) return prev;
      return {
        ...prev,
        [id]: { ...e, committedBalance: val, burnedSinceCommit: 0, committedAt: Date.now() },
      };
    });
  };

  const handleInput = (id: number, raw: string) => {
    setEntries(prev => ({ ...prev, [id]: { ...prev[id], inputBalance: raw } }));
  };

  const handleKey = (id: number, ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "Enter") commit(id);
  };

  const fmtCr = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(3)}M`
    : n >= 1_000   ? `${(n / 1_000).toFixed(2)}k`
    : n.toFixed(1);

  const fmtEta = (remaining: number, burnPerSec: number): string => {
    if (burnPerSec <= 0) return "∞";
    const secs = remaining / burnPerSec;
    if (secs >= 3600) return `~${(secs / 3600).toFixed(1)}h`;
    if (secs >= 60)   return `~${Math.round(secs / 60)}m`;
    return `~${Math.round(secs)}s`;
  };

  const sortedKeys = liveKeys.slice().sort((a, b) => {
    // live keys first, then by licenseKeyId
    if (a.isLive && !b.isLive) return -1;
    if (!a.isLive && b.isLive) return 1;
    return a.licenseKeyId - b.licenseKeyId;
  });

  return (
    <div className="space-y-4">
      {/* Header banner */}
      <div className="flex items-start gap-2.5 rounded-xl p-4 text-xs"
        style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24" }}>
        <Flame className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Live Credit Burn — </span>
          Enter your Decart credit balance for each licence key. It burns in real-time at{" "}
          <strong>{apiCostRate} cr/s × active sessions</strong>. Type a number and press Enter (or click Set) to start the countdown.
          Balance resets to your new input any time you re-enter it.
        </div>
      </div>

      {/* Per-key burn cards */}
      {sortedKeys.length === 0 && (
        <div className="rounded-xl p-10 text-center font-mono text-sm text-muted-foreground"
          style={{ border: "1px solid hsl(222 40% 11%)" }}>
          No licence keys found. Wait for data to load.
        </div>
      )}

      <div className="space-y-3">
        {sortedKeys.map(k => {
          const e = entries[k.licenseKeyId];
          if (!e) return null;

          const burnPerSec  = apiCostRate * e.activeSessionCount;
          const remaining   = Math.max(0, e.committedBalance - e.burnedSinceCommit);
          const hasBalance  = e.committedBalance > 0;
          const pct         = hasBalance ? Math.max(0, Math.min(1, remaining / e.committedBalance)) : 0;
          const isStreaming  = e.isLive && e.activeSessionCount > 0;

          const barColor =
            !hasBalance      ? "hsl(222 40% 18%)" :
            pct <= 0.10      ? "#fc5c65" :
            pct <= 0.25      ? "#fed330" :
                               "#26de81";

          const remainColor =
            !hasBalance      ? "hsl(215 20% 40%)" :
            pct <= 0.10      ? "#fc5c65" :
            pct <= 0.25      ? "#fed330" :
                               "#26de81";

          return (
            <div key={k.licenseKeyId} className="rounded-xl p-4 space-y-3"
              style={{
                background: "hsl(222 44% 6%)",
                border: `1px solid ${isStreaming ? "rgba(251,191,36,0.35)" : "hsl(222 40% 12%)"}`,
                transition: "border-color 0.3s",
              }}>

              {/* Row 1: key label + live badge + sessions */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{fmtKey(k.licenseKey)}</span>
                  {isStreaming ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" }}>
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#fbbf24" }} />
                      BURNING · {e.activeSessionCount} session{e.activeSessionCount !== 1 ? "s" : ""}
                    </span>
                  ) : e.isLive ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{ background: "rgba(38,222,129,0.1)", color: "#26de81", border: "1px solid rgba(38,222,129,0.25)" }}>
                      LIVE · 0 sessions
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px]"
                      style={{ color: "hsl(215 20% 40%)", border: "1px solid hsl(222 40% 14%)" }}>
                      IDLE
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {apiCostRate} cr/s × {e.activeSessionCount} = <strong style={{ color: isStreaming ? "#fbbf24" : "hsl(215 20% 40%)" }}>{burnPerSec.toFixed(1)} cr/s</strong>
                </span>
              </div>

              {/* Row 2: manual credit input */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 flex-1 max-w-xs"
                  style={{ background: "hsl(222 44% 5%)", border: "1px solid hsl(222 40% 18%)" }}>
                  <Zap className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={e.inputBalance}
                    onChange={ev => handleInput(k.licenseKeyId, ev.target.value)}
                    onKeyDown={ev => handleKey(k.licenseKeyId, ev)}
                    onBlur={() => commit(k.licenseKeyId)}
                    placeholder="Enter credit balance…"
                    className="bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none flex-1 min-w-0"
                  />
                </div>
                <button
                  onClick={() => commit(k.licenseKeyId)}
                  className="px-3 py-2 rounded-lg text-xs font-mono font-semibold transition-colors"
                  style={{ background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.3)" }}>
                  Set
                </button>
                {hasBalance && (
                  <button
                    onClick={() => setEntries(prev => ({
                      ...prev,
                      [k.licenseKeyId]: { ...prev[k.licenseKeyId], committedBalance: 0, burnedSinceCommit: 0, inputBalance: "" },
                    }))}
                    className="px-3 py-2 rounded-lg text-xs font-mono transition-colors"
                    style={{ color: "hsl(215 20% 45%)", border: "1px solid hsl(222 40% 14%)" }}>
                    Reset
                  </button>
                )}
              </div>

              {/* Row 3: burn bar + stats (only shown once balance is set) */}
              {hasBalance && (
                <div className="space-y-2">
                  {/* Progress bar */}
                  <div className="relative h-4 rounded-full overflow-hidden" style={{ background: "hsl(222 40% 10%)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{ width: `${pct * 100}%`, background: barColor }}
                    />
                    {/* Pulse overlay when burning */}
                    {isStreaming && pct > 0 && (
                      <div className="absolute inset-0 rounded-full animate-pulse opacity-20"
                        style={{ background: barColor }} />
                    )}
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center justify-between flex-wrap gap-x-6 gap-y-1 text-xs font-mono">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Remaining:</span>
                      <span className="font-bold" style={{ color: remainColor }}>{fmtCr(remaining)} cr</span>
                      <span className="text-muted-foreground">/ {fmtCr(e.committedBalance)} cr</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Burned:</span>
                      <span style={{ color: "#fc5c65" }}>{fmtCr(e.burnedSinceCommit)} cr</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Timer className="w-3 h-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Empty in:</span>
                      <span style={{ color: isStreaming ? remainColor : "hsl(215 20% 40%)" }}>
                        {isStreaming ? fmtEta(remaining, burnPerSec) : "paused"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">{(pct * 100).toFixed(1)}% remaining</span>
                    </div>
                  </div>

                  {/* Alert banners */}
                  {pct <= 0 && (
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold"
                      style={{ background: "rgba(252,92,101,0.12)", color: "#fc5c65", border: "1px solid rgba(252,92,101,0.3)" }}>
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Credits exhausted — enter a new balance to continue tracking
                    </div>
                  )}
                  {pct > 0 && pct <= 0.10 && (
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold"
                      style={{ background: "rgba(252,92,101,0.08)", color: "#fc5c65", border: "1px solid rgba(252,92,101,0.25)" }}>
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                      Critical — less than 10% remaining
                    </div>
                  )}
                  {pct > 0.10 && pct <= 0.25 && (
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                      style={{ background: "rgba(254,211,48,0.07)", color: "#fed330", border: "1px solid rgba(254,211,48,0.2)" }}>
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Low — less than 25% remaining
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Section = "overview" | "profit" | "decart" | "ghost" | "streams" | "revenue" | "wallet" | "credit-usage";

export default function AdminAnalyticsPage() {
  const [brkData, setBrkData]         = useState<BrkResponse | null>(null);
  const [decartKeys, setDecartKeys]   = useState<DecartKey[]>([]);
  const [ghosts, setGhosts]           = useState<GhostSession[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState("");
  const [liveOnly, setLiveOnly]       = useState(false);
  const [lastPoll, setLastPoll]       = useState<string>("");
  const [section, setSection]         = useState<Section>("overview");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueData | null>(null);
  const [walletData, setWalletData]   = useState<WalletData | null>(null);

  const fetchAll = useCallback(async () => {
    const [brk, dkeys, ghostRes, revRes, walRes] = await Promise.all([
      apiFetch<BrkResponse>("/api/admin/billing-rate-per-key?limit=500"),
      apiFetch<{ keys: DecartKey[] }>("/api/admin/decart-keys"),
      apiFetch<Record<string, any>>("/api/admin/billing-intelligence/ghost-sessions"),
      apiFetch<RevenueData>("/api/admin/unified/revenue-intelligence"),
      apiFetch<WalletData>("/api/admin/unified/wallet-health"),
    ]);
    if (brk) setBrkData(brk);
    if (dkeys && Array.isArray(dkeys.keys)) setDecartKeys(dkeys.keys);
    if (ghostRes) {
      const list = ghostRes.sessions ?? ghostRes.ghosts ?? [];
      setGhosts(Array.isArray(list) ? list : []);
    }
    if (revRes) setRevenueData(revRes);
    if (walRes) setWalletData(walRes);
    setLastPoll(new Date().toLocaleTimeString());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchAll]);

  const keys        = Array.isArray(brkData?.keys) ? brkData!.keys : [];
  const globalRate  = brkData?.globalBillingRate ?? 0;
  const apiCostRate = brkData?.apiCostRate ?? COST_RATE;

  // Compute enriched rows using the backend apiCostRate
  const enriched = keys.map(k => {
    const revenue = Math.round(k.usedSeconds * k.effectiveRate * 100) / 100;
    const cost    = Math.round(k.usedSeconds * apiCostRate * 100) / 100;
    const profit  = Math.round((revenue - cost) * 100) / 100;
    const mPct    = marginPct(k.effectiveRate, apiCostRate);
    return { ...k, revenue, cost, profit, mPct };
  });

  // Summary aggregates
  const totalUsed   = enriched.reduce((a, k) => a + k.usedSeconds, 0);
  const totalRev    = Math.round(enriched.reduce((a, k) => a + k.revenue, 0) * 100) / 100;
  const totalCost   = Math.round(enriched.reduce((a, k) => a + k.cost, 0) * 100) / 100;
  const totalProfit = Math.round((totalRev - totalCost) * 100) / 100;
  const activeCount = enriched.filter(k => k.isLive).length;
  const ghostCount  = ghosts.length;
  const totalBurn   = Math.round(totalUsed * apiCostRate * 100) / 100;

  const liveStreams = enriched.filter(k => k.isLive);

  const filtered = enriched.filter(k => {
    if (liveOnly && !k.isLive) return false;
    if (search && !k.licenseKey.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const sections: { id: Section; label: string }[] = [
    { id: "overview",      label: "Overview" },
    { id: "profit",        label: "Profit" },
    { id: "decart",        label: "Decart Pool" },
    { id: "ghost",         label: `Ghost Sessions${ghosts.length > 0 ? ` (${ghosts.length})` : ""}` },
    { id: "streams",       label: `Live Streams${liveStreams.length > 0 ? ` (${liveStreams.length})` : ""}` },
    { id: "revenue",       label: "Revenue Intel" },
    { id: "wallet",        label: "Wallet Health" },
    { id: "credit-usage",  label: "Credit Usage" },
  ];

  const ROW_A = "hsl(222 44% 5%)";
  const ROW_B = "hsl(222 44% 6%)";
  const BORDER = "1px solid hsl(222 40% 10%)";

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 lg:p-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-primary" />
              Billing Analytics
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Production control center · wallet.used_seconds truth · READ ONLY
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastPoll && <span className="text-xs text-muted-foreground font-mono">{lastPoll}</span>}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: "rgba(38,222,129,0.1)", border: "1px solid rgba(38,222,129,0.3)" }}>
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400 font-mono font-semibold">LIVE 3s</span>
            </div>
            <button onClick={fetchAll} className="text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Summary Cards — Row 1 */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <SCard label="Real Seconds Used"    value={fmtSec(totalUsed)}    sub="wallet.used_seconds"        color="hsl(var(--foreground))"  icon={Clock} />
              <SCard label="Total Revenue"         value={`${totalRev} cr`}     sub={`${globalRate} cr/s rate`}  color="hsl(142 76% 36%)"         icon={TrendingUp} />
              <SCard label="Decart API Cost"       value={`${totalCost} cr`}    sub={`${apiCostRate} cr/s fixed`} color="hsl(0 84% 60%)"          icon={DollarSign} />
              <SCard label="Total Profit"          value={`${totalProfit} cr`}  sub={totalProfit >= 0 ? "profitable" : "loss"} color={totalProfit >= 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"} icon={Zap} />
              <SCard label="Profit Margin"         value={`${marginPct(globalRate, apiCostRate)}%`} sub="(rate − cost) / cost" color={globalRate > apiCostRate ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"} icon={Activity} />
            </div>
            {/* Summary Cards — Row 2 */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <SCard label="Active Streams"        value={String(activeCount)}  sub="live right now"             color="hsl(142 76% 36%)"         icon={Wifi} />
              <SCard label="Ghost Sessions"        value={String(ghostCount)}   sub="no heartbeat detected"      color={ghostCount > 0 ? "hsl(0 84% 60%)" : "hsl(215 20% 55%)"} icon={AlertTriangle} />
              <SCard label="Decart Credits Burned" value={`${totalBurn} cr`}   sub={`real seconds × ${apiCostRate}`} color="hsl(215 20% 55%)"    icon={Key} />
              <SCard label="Total Keys"            value={String(keys.length)}  sub="all licence keys"           color="hsl(215 20% 55%)"         icon={Database} />
              <SCard label="Decart Pool"           value={String(decartKeys.length)} sub="API keys in pool"      color="hsl(215 20% 55%)"         icon={Flame} />
            </div>

            {/* Section Nav */}
            <div className="flex gap-1 overflow-x-auto pb-1">
              {sections.map(s => (
                <button key={s.id} onClick={() => setSection(s.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium whitespace-nowrap transition-colors"
                  style={section === s.id
                    ? { background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.3)" }
                    : { color: "hsl(215 20% 55%)", border: "1px solid transparent" }}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Filters — shown for overview and profit */}
            {(section === "overview" || section === "profit") && (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 flex-1 max-w-xs"
                  style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 18%)" }}>
                  <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search licence key…"
                    className="bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none flex-1 min-w-0" />
                  {search && (
                    <button onClick={() => setSearch("")}>
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
                <button onClick={() => setLiveOnly(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono border transition-colors"
                  style={liveOnly ? { background: "rgba(38,222,129,0.12)", color: "#26de81", border: "1px solid rgba(38,222,129,0.3)" } : { color: "hsl(215 20% 55%)", border: "1px solid hsl(222 40% 18%)" }}>
                  <Eye className="w-3.5 h-3.5" /> LIVE ONLY
                </button>
                <p className="text-xs text-muted-foreground font-mono">{filtered.length} keys</p>
              </div>
            )}

            {/* ── OVERVIEW ── */}
            {section === "overview" && (
              <TableWrap>
                <thead>
                  <tr style={{ background: "hsl(222 44% 6%)" }}>
                    <TH left>Licence Key</TH>
                    <TH>Rate</TH>
                    <TH>Source</TH>
                    <TH>Real Used</TH>
                    <TH>Remaining</TH>
                    <TH>Revenue</TH>
                    <TH>Cost</TH>
                    <TH>Profit</TH>
                    <TH>Status</TH>
                    <TH>Live</TH>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground font-mono text-xs">No keys match filters</td></tr>
                  ) : filtered.map((k, i) => (
                    <tr key={k.licenseKeyId} style={{ background: i % 2 === 0 ? ROW_A : ROW_B, borderTop: BORDER }}>
                      <td className="px-3 py-2 font-mono text-xs text-left">{fmtKey(k.licenseKey)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-right">{k.effectiveRate} cr/s</td>
                      <td className="px-3 py-2 font-mono text-xs text-right text-muted-foreground">{k.rateSource}</td>
                      <td className="px-3 py-2 font-mono text-xs text-right">{fmtSec(k.usedSeconds)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-right">{fmtSec(k.remainingSeconds)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: "#26de81" }}>{k.revenue} cr</td>
                      <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: "#fc5c65" }}>{k.cost} cr</td>
                      <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: k.profit >= 0 ? "#26de81" : "#fc5c65" }}>{k.profit} cr</td>
                      <td className="px-3 py-2 font-mono text-xs text-right">
                        <span className="px-1.5 py-0.5 rounded text-[10px]"
                          style={{
                            background: driftBg(k.profit >= 0 ? "good" : "bad"),
                            color: driftFg(k.profit >= 0 ? "good" : "bad"),
                            border: `1px solid ${driftBdr(k.profit >= 0 ? "good" : "bad")}`,
                          }}>
                          {k.profit >= 0 ? "OK" : "LOSS"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-right">
                        {k.isLive ? (
                          <span className="flex items-center justify-end gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                            <span style={{ color: "#26de81" }}>LIVE</span>
                          </span>
                        ) : <span style={{ color: "hsl(215 20% 40%)" }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}

            {/* ── PROFIT ── */}
            {section === "profit" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <SCard label="Global Margin"    value={`${marginPct(globalRate, apiCostRate)}%`} sub={`${globalRate} cr/s rate`} color={globalRate > apiCostRate ? "#26de81" : "#fc5c65"} icon={TrendingUp} />
                  <SCard label="Profit / Second"  value={`${Math.round((globalRate - apiCostRate) * 100) / 100} cr/s`} sub="billing − api cost" color="#26de81" icon={Zap} />
                  <SCard label="Profit / Hour"    value={`${Math.round((globalRate - apiCostRate) * 3600)} cr`} sub="per hr streamed" color="#26de81" icon={Timer} />
                  <SCard label="Total Profit"     value={`${totalProfit} cr`} sub={`${totalRev} rev − ${totalCost} cost`} color={totalProfit >= 0 ? "#26de81" : "#fc5c65"} icon={DollarSign} />
                </div>
                <TableWrap>
                  <thead>
                    <tr style={{ background: "hsl(222 44% 6%)" }}>
                      <TH left>Licence Key</TH>
                      <TH>Rate</TH>
                      <TH>Margin %</TH>
                      <TH>Profit/sec</TH>
                      <TH>Used</TH>
                      <TH>Revenue</TH>
                      <TH>API Cost</TH>
                      <TH>Profit</TH>
                      <TH>Source</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground font-mono text-xs">No keys</td></tr>
                    ) : [...filtered].sort((a, b) => b.profit - a.profit).map((k, i) => (
                      <tr key={k.licenseKeyId} style={{ background: i % 2 === 0 ? ROW_A : ROW_B, borderTop: BORDER }}>
                        <td className="px-3 py-2 font-mono text-xs text-left">{fmtKey(k.licenseKey)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-right">{k.effectiveRate} cr/s</td>
                        <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: k.mPct >= 0 ? "#26de81" : "#fc5c65" }}>{k.mPct}%</td>
                        <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: k.profitPerSecond >= 0 ? "#26de81" : "#fc5c65" }}>{k.profitPerSecond} cr/s</td>
                        <td className="px-3 py-2 font-mono text-xs text-right">{fmtSec(k.usedSeconds)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: "#26de81" }}>{k.revenue} cr</td>
                        <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: "#fc5c65" }}>{k.cost} cr</td>
                        <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: k.profit >= 0 ? "#26de81" : "#fc5c65" }}>{k.profit} cr</td>
                        <td className="px-3 py-2 font-mono text-xs text-right text-muted-foreground">{k.rateSource}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>
            )}

            {/* ── DECART POOL ── */}
            {section === "decart" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <SCard label="Total Keys"   value={String(decartKeys.length)}                                sub="in pool"    color="hsl(215 20% 55%)" icon={Key} />
                  <SCard label="Active Keys"  value={String(decartKeys.filter(k => k.isActive).length)}       sub="enabled"    color="#26de81"            icon={CheckCircle2} />
                  <SCard label="Inactive"     value={String(decartKeys.filter(k => !k.isActive).length)}      sub="disabled"   color="#fc5c65"            icon={AlertTriangle} />
                  <SCard label="Assigned"     value={String(decartKeys.filter(k => k.assignedLicenseKey).length)} sub="with licence" color="#fed330"       icon={Database} />
                </div>
                {decartKeys.length === 0 ? (
                  <div className="rounded-xl p-8 text-center text-muted-foreground font-mono text-sm"
                    style={{ border: "1px solid hsl(222 40% 11%)" }}>No Decart API keys found</div>
                ) : (
                  <TableWrap>
                    <thead>
                      <tr style={{ background: "hsl(222 44% 6%)" }}>
                        <TH left>Label</TH>
                        <TH>Active</TH>
                        <TH>Health</TH>
                        <TH>Load</TH>
                        <TH>Max Users</TH>
                        <TH>Credits Loaded</TH>
                        <TH>Baseline</TH>
                        <TH>Threshold</TH>
                        <TH left>Assigned Key</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {decartKeys.map((k, i) => {
                        const health = k.healthStatus ?? "unknown";
                        return (
                          <tr key={k.id} style={{ background: i % 2 === 0 ? ROW_A : ROW_B, borderTop: BORDER }}>
                            <td className="px-3 py-2 font-mono text-xs text-left font-medium">{k.label}</td>
                            <td className="px-3 py-2 font-mono text-xs text-right">
                              <span style={{ color: k.isActive ? "#26de81" : "#fc5c65" }}>{k.isActive ? "YES" : "NO"}</span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-right">
                              <span className="px-1.5 py-0.5 rounded text-[10px]"
                                style={{
                                  background: driftBg(health === "healthy" ? "good" : health === "warning" ? "warning" : "bad"),
                                  color: driftFg(health === "healthy" ? "good" : health === "warning" ? "warning" : "bad"),
                                  border: `1px solid ${driftBdr(health === "healthy" ? "good" : health === "warning" ? "warning" : "bad")}`,
                                }}>
                                {health.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-right">
                              {k.usageLoad != null ? `${Math.round(k.usageLoad * 100)}%` : "—"}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-right">{k.maxUsers ?? "∞"}</td>
                            <td className="px-3 py-2 font-mono text-xs text-right">{k.totalCreditsLoaded.toLocaleString()} cr</td>
                            <td className="px-3 py-2 font-mono text-xs text-right">{k.creditsBaseline.toLocaleString()} cr</td>
                            <td className="px-3 py-2 font-mono text-xs text-right">{k.thresholdPct}%</td>
                            <td className="px-3 py-2 font-mono text-xs text-left text-muted-foreground">
                              {k.assignedLicenseKey ? fmtKey(k.assignedLicenseKey) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </TableWrap>
                )}
              </div>
            )}

            {/* ── GHOST SESSIONS ── */}
            {section === "ghost" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <SCard label="Ghost Count" value={String(ghostCount)} sub="no heartbeat / orphan" color={ghostCount > 0 ? "#fc5c65" : "hsl(215 20% 55%)"} icon={AlertTriangle} />
                  <SCard label="Live Streams" value={String(activeCount)} sub="active right now" color="#26de81" icon={Wifi} />
                  <SCard label="Status" value={ghostCount === 0 ? "CLEAN" : "ALERTS"} sub={ghostCount === 0 ? "no orphans detected" : `${ghostCount} need attention`} color={ghostCount === 0 ? "#26de81" : "#fc5c65"} icon={CheckCircle2} />
                </div>
                {ghosts.length === 0 ? (
                  <div className="rounded-xl p-10 text-center space-y-2" style={{ border: "1px solid rgba(38,222,129,0.2)", background: "rgba(38,222,129,0.04)" }}>
                    <CheckCircle2 className="w-8 h-8 mx-auto" style={{ color: "#26de81" }} />
                    <p className="font-mono text-sm" style={{ color: "#26de81" }}>No ghost sessions detected</p>
                    <p className="font-mono text-xs text-muted-foreground">All sessions have active heartbeats</p>
                  </div>
                ) : (
                  <TableWrap>
                    <thead>
                      <tr style={{ background: "hsl(222 44% 6%)" }}>
                        <TH left>Session ID</TH>
                        <TH left>Licence Key</TH>
                        <TH>Status</TH>
                        <TH>Started</TH>
                        <TH>Last Heartbeat</TH>
                        <TH>Age (sec)</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {ghosts.map((g, i) => {
                        const sid = g.sessionId ?? g.id ?? "—";
                        const key = g.licenseKey ?? "—";
                        const lastBeat = g.lastHeartbeatAt ?? g.lastHeartbeat;
                        return (
                          <tr key={sid} style={{ background: i % 2 === 0 ? ROW_A : ROW_B, borderTop: BORDER }}>
                            <td className="px-3 py-2 font-mono text-xs text-left" style={{ color: "#fc5c65" }}>{String(sid).slice(0, 16)}</td>
                            <td className="px-3 py-2 font-mono text-xs text-left">{fmtKey(key)}</td>
                            <td className="px-3 py-2 font-mono text-xs text-right">
                              <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "rgba(252,92,101,0.12)", color: "#fc5c65", border: "1px solid rgba(252,92,101,0.3)" }}>
                                {g.status ?? "orphan"}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-right">{fmtTs(g.startedAt)}</td>
                            <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: "#fed330" }}>{fmtTs(lastBeat)}</td>
                            <td className="px-3 py-2 font-mono text-xs text-right">{g.orphanAgeSeconds ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </TableWrap>
                )}
              </div>
            )}

            {/* ── LIVE STREAMS ── */}
            {section === "streams" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <SCard label="Live Now"       value={String(liveStreams.length)}  sub="active sessions"   color="#26de81"           icon={Wifi} />
                  <SCard label="Live Revenue"   value={`${Math.round(liveStreams.reduce((a, k) => a + k.revenue, 0) * 100) / 100} cr`} sub="accrued so far" color="#26de81" icon={TrendingUp} />
                  <SCard label="Live Profit"    value={`${Math.round(liveStreams.reduce((a, k) => a + k.profit, 0) * 100) / 100} cr`} sub="net after api cost" color="#26de81" icon={Zap} />
                  <SCard label="Avg Rate"       value={liveStreams.length > 0 ? `${Math.round(liveStreams.reduce((a, k) => a + k.effectiveRate, 0) / liveStreams.length * 10) / 10} cr/s` : "—"} sub="effective billing rate" color="hsl(215 20% 55%)" icon={Activity} />
                </div>
                {liveStreams.length === 0 ? (
                  <div className="rounded-xl p-10 text-center space-y-2" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                    <Wifi className="w-8 h-8 mx-auto text-muted-foreground" />
                    <p className="font-mono text-sm text-muted-foreground">No active streams right now</p>
                    <p className="font-mono text-xs text-muted-foreground">Refreshes every 3 seconds</p>
                  </div>
                ) : (
                  <TableWrap>
                    <thead>
                      <tr style={{ background: "hsl(222 44% 6%)" }}>
                        <TH left>Licence Key</TH>
                        <TH>Rate</TH>
                        <TH>Margin %</TH>
                        <TH>Profit/sec</TH>
                        <TH>Used</TH>
                        <TH>Remaining</TH>
                        <TH>Revenue</TH>
                        <TH>Profit</TH>
                        <TH>Sessions</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {liveStreams.map((k, i) => (
                        <tr key={k.licenseKeyId} style={{ background: i % 2 === 0 ? ROW_A : ROW_B, borderTop: BORDER }}>
                          <td className="px-3 py-2 font-mono text-xs text-left">
                            <span className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                              {fmtKey(k.licenseKey)}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-right">{k.effectiveRate} cr/s</td>
                          <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: "#26de81" }}>{k.mPct}%</td>
                          <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: "#26de81" }}>{k.profitPerSecond} cr/s</td>
                          <td className="px-3 py-2 font-mono text-xs text-right">{fmtSec(k.usedSeconds)}</td>
                          <td className="px-3 py-2 font-mono text-xs text-right">{fmtSec(k.remainingSeconds)}</td>
                          <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: "#26de81" }}>{k.revenue} cr</td>
                          <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: k.profit >= 0 ? "#26de81" : "#fc5c65" }}>{k.profit} cr</td>
                          <td className="px-3 py-2 font-mono text-xs text-right">{k.activeSessionCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                )}
              </div>
            )}

            {/* ── REVENUE INTEL ── */}
            {section === "revenue" && (
              <div className="space-y-6">
                {!revenueData ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <SCard label="Billing Rate"   value={`${revenueData.billingRate} cr/s`}  sub="current global rate"     color="hsl(var(--foreground))" icon={Activity} />
                      <SCard label="Margin %"       value={`${marginPct(revenueData.billingRate, apiCostRate)}%`} sub="profit-on-cost ratio"   color={revenueData.billingRate > apiCostRate ? "#26de81" : "#fc5c65"} icon={TrendingUp} />
                      <SCard label="Top Keys"       value={String(revenueData.topKeysByUsage.length)} sub="by usage (last read)" color="hsl(215 20% 55%)" icon={Key} />
                    </div>

                    {/* Daily Revenue */}
                    <div className="rounded-xl p-4 space-y-3" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Daily Revenue — Last 7 Days</p>
                      {revenueData.dailyRevenue.length === 0 ? (
                        <p className="text-sm font-mono text-muted-foreground py-4 text-center">No invoice revenue in the last 7 days</p>
                      ) : (
                        <div className="space-y-2">
                          {revenueData.dailyRevenue.map((d, i) => {
                            const val = parseFloat(d.total);
                            const max = Math.max(...revenueData.dailyRevenue.map(x => parseFloat(x.total)));
                            const pct = max > 0 ? (val / max) * 100 : 0;
                            return (
                              <div key={i} className="flex items-center gap-3">
                                <span className="font-mono text-[10px] text-muted-foreground w-20 shrink-0">{d.day}</span>
                                <div className="flex-1 h-2 rounded-full" style={{ background: "hsl(222 40% 11%)" }}>
                                  <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: "#26de81", transition: "width 0.4s" }} />
                                </div>
                                <span className="font-mono text-xs text-foreground w-24 text-right">{val.toFixed(2)} USDT</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Top Keys by Usage */}
                    <div className="space-y-2">
                      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Top Keys by Usage</p>
                      <TableWrap>
                        <thead>
                          <tr style={{ background: "hsl(222 44% 6%)" }}>
                            <TH left>Licence Key</TH>
                            <TH>Used</TH>
                            <TH>Allocated</TH>
                            <TH>Efficiency</TH>
                            <TH>Profit Credits</TH>
                          </tr>
                        </thead>
                        <tbody>
                          {revenueData.topKeysByUsage.map((k, i) => (
                            <tr key={k.id} style={{ background: i % 2 === 0 ? ROW_A : ROW_B, borderTop: BORDER }}>
                              <td className="px-3 py-2 font-mono text-xs text-left">{fmtKey(k.key)}</td>
                              <td className="px-3 py-2 font-mono text-xs text-right">{fmtSec(k.usedSeconds)}</td>
                              <td className="px-3 py-2 font-mono text-xs text-right">{k.minutesAllocated}m</td>
                              <td className="px-3 py-2 font-mono text-xs text-right">
                                <span style={{ color: k.efficiencyPercent >= 80 ? "#26de81" : k.efficiencyPercent >= 50 ? "#fed330" : "#fc5c65" }}>
                                  {k.efficiencyPercent}%
                                </span>
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: k.profitCredits >= 0 ? "#26de81" : "#fc5c65" }}>
                                {Math.round(k.profitCredits * 100) / 100} cr
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </TableWrap>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── WALLET HEALTH ── */}
            {section === "wallet" && (
              <div className="space-y-4">
                {!walletData ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <SCard label="Total Keys"   value={String(walletData.keys.length)}                                    sub="active keys"      color="hsl(215 20% 55%)" icon={Key} />
                      <SCard label="Critical"     value={String(walletData.keys.filter(k => k.risk === "critical").length)} sub="< 5 min remaining" color="#fc5c65"           icon={AlertTriangle} />
                      <SCard label="Low"          value={String(walletData.keys.filter(k => k.risk === "low").length)}      sub="< 30 min remaining" color="#fed330"          icon={Timer} />
                      <SCard label="Healthy"      value={String(walletData.keys.filter(k => k.risk === "healthy").length)}  sub="> 30 min remaining" color="#26de81"          icon={CheckCircle2} />
                    </div>
                    {walletData.keys.length === 0 ? (
                      <div className="rounded-xl p-8 text-center text-muted-foreground font-mono text-sm"
                        style={{ border: "1px solid hsl(222 40% 11%)" }}>No active keys to analyse</div>
                    ) : (
                      <TableWrap>
                        <thead>
                          <tr style={{ background: "hsl(222 44% 6%)" }}>
                            <TH left>Licence Key</TH>
                            <TH>Risk</TH>
                            <TH>Remaining</TH>
                            <TH>Real Stream Rem.</TH>
                            <TH>Burn Rate/hr</TH>
                            <TH>Hrs Until Empty</TH>
                            <TH>Eff. Rate</TH>
                          </tr>
                        </thead>
                        <tbody>
                          {[...walletData.keys].sort((a, b) => {
                            const order = { critical: 0, low: 1, healthy: 2 };
                            return (order[a.risk as keyof typeof order] ?? 3) - (order[b.risk as keyof typeof order] ?? 3);
                          }).map((k, i) => (
                            <tr key={k.id} style={{ background: i % 2 === 0 ? ROW_A : ROW_B, borderTop: BORDER }}>
                              <td className="px-3 py-2 font-mono text-xs text-left">{fmtKey(k.key)}</td>
                              <td className="px-3 py-2 font-mono text-xs text-right">
                                <span className="px-1.5 py-0.5 rounded text-[10px]"
                                  style={{
                                    background: driftBg(k.risk === "healthy" ? "good" : k.risk === "low" ? "warning" : "bad"),
                                    color: riskColor(k.risk),
                                    border: `1px solid ${driftBdr(k.risk === "healthy" ? "good" : k.risk === "low" ? "warning" : "bad")}`,
                                  }}>
                                  {k.risk.toUpperCase()}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: riskColor(k.risk) }}>
                                {fmtSec(k.remainingSeconds)}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-right">
                                {fmtSec(k.realStreamRemainingSeconds)}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-right">
                                {k.burnRateSecPerHour != null ? `${k.burnRateSecPerHour}s/hr` : "—"}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-right">
                                {k.hoursUntilExhausted != null ? `${k.hoursUntilExhausted}h` : "∞"}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-right">{k.effectiveBillingRate} cr/s</td>
                            </tr>
                          ))}
                        </tbody>
                      </TableWrap>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── CREDIT USAGE ── */}
            {section === "credit-usage" && (
              <CreditUsagePanel
                liveKeys={brkData?.keys ?? []}
                apiCostRate={apiCostRate}
              />
            )}

          </>
        )}
      </div>
    </AdminLayout>
  );
}
