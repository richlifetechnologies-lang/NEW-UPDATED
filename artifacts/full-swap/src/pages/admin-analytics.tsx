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

type Section = "overview" | "profit" | "decart" | "ghost" | "streams" | "revenue" | "wallet";

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
    { id: "overview", label: "Overview" },
    { id: "profit",   label: "Profit" },
    { id: "decart",   label: "Decart Pool" },
    { id: "ghost",    label: `Ghost Sessions${ghosts.length > 0 ? ` (${ghosts.length})` : ""}` },
    { id: "streams",  label: `Live Streams${liveStreams.length > 0 ? ` (${liveStreams.length})` : ""}` },
    { id: "revenue",  label: "Revenue Intel" },
    { id: "wallet",   label: "Wallet Health" },
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

          </>
        )}
      </div>
    </AdminLayout>
  );
}
