/**
 * admin-analytics.tsx — Full Billing Analytics Rebuild
 * Production monitoring dashboard: wallet truth, TCE, Decart, profit, ghost sessions, drift.
 * READ ONLY — no billing mutations. All data derived from DB truth (wallet.used_seconds).
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { AdminLayout } from "@/components/admin-layout";
import {
  Activity, AlertTriangle, BarChart3, Clock, DollarSign, Ghost,
  Key, Loader2, RefreshCw, Search, Shield, TrendingUp, Zap,
  Timer, X, CheckCircle2, XCircle, Eye, EyeOff, Wifi,
} from "lucide-react";

// ── API ───────────────────────────────────────────────────────────────────────
const authH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token") ?? ""}`,
});

async function apiFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: authH() });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface KeyRow {
  licenseKeyId: number;
  licenseKey: string;
  isActive: boolean;
  deviceId: string | null;
  decartLabel: string | null;
  allocatedSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  displaySecondsUsed: number;
  displaySecondsRemaining: number;
  effectiveRate: number;
  rateSource: "custom" | "global";
  compressionFactor: number;
  revenue: number;
  cost: number;
  profit: number;
  profitPerSecond: number;
  marginPct: number;
  isLive: boolean;
  activeSessionCount: number;
  sessionCount: number;
  ghostCount: number;
  reconnectCount: number;
  lastHeartbeat: string | null;
  lastUsedAt: string | null;
  driftPct: number;
  tceHealth: "good" | "warning" | "drift";
}

interface Summary {
  totalUsedSeconds: number;
  totalDisplaySeconds: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  avgCompressionFactor: number;
  activeStreams: number;
  ghostSessionCount: number;
  driftAlertCount: number;
  totalDecartCreditsBurned: number;
  globalBillingRate: number;
  apiCostRate: number;
  keyCount: number;
}

interface PerKeyResponse { keys: KeyRow[]; summary: Summary; computedAt: string; }

interface DecartKey {
  id: number; label: string; isActive: boolean; maxUsers: number | null;
  usageLoad: number | null; healthStatus: string | null;
  totalCreditsLoaded: number; creditsBaseline: number;
  assignedLicenseKey: string | null; thresholdPct: number;
}

interface GhostSession {
  sessionId?: string; id?: string;
  licenseKey?: string; lastHeartbeat?: string | null;
  lastHeartbeatAt?: string | null; startedAt?: string;
  orphanAgeSeconds?: number; status?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const COST_RATE = 2.3;

function fmtSec(s: number): string {
  if (s <= 0) return "0s";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return sec > 0 ? `${h}h ${m}m ${sec}s` : `${h}h ${m}m`;
  return sec > 0 && m === 0 ? `${sec}s` : sec > 0 ? `${m}m ${sec}s` : `${m}m`;
}
function fmtKey(k: string): string {
  return k.length > 14 ? `${k.slice(0, 8)}…${k.slice(-4)}` : k;
}
function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function driftColor(pct: number): string {
  return pct < 2 ? "#26de81" : pct < 5 ? "#fed330" : "#fc5c65";
}
function healthLabel(h: "good" | "warning" | "drift"): string {
  return h === "good" ? "GOOD" : h === "warning" ? "WARNING" : "DRIFT";
}

function SummaryCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub?: string; color?: string; icon: any;
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color: color ?? "hsl(215 20% 65%)" }} />
        <p className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-2xl font-bold font-mono" style={{ color: color ?? "hsl(var(--foreground))" }}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground font-mono mt-1">{sub}</p>}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AdminAnalyticsPage() {
  const [data, setData]             = useState<PerKeyResponse | null>(null);
  const [decartKeys, setDecartKeys] = useState<DecartKey[]>([]);
  const [ghosts, setGhosts]         = useState<GhostSession[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const [liveOnly, setLiveOnly]     = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [lastPoll, setLastPoll]     = useState<Date | null>(null);
  const [activeSection, setActiveSection] = useState<"overview" | "tce" | "profit" | "decart" | "ghost" | "streams">("overview");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    const [perKey, dKeys, ghostData] = await Promise.all([
      apiFetch<PerKeyResponse>("/api/admin/analytics/per-key"),
      apiFetch<{ keys: DecartKey[] }>("/api/admin/decart-keys"),
      apiFetch<{ sessions?: GhostSession[]; ghosts?: GhostSession[] }>("/api/admin/billing-intelligence/ghost-sessions"),
    ]);
    if (perKey) { setData(perKey); setError(null); }
    else setError("Failed to load analytics data");
    if (dKeys?.keys) setDecartKeys(dKeys.keys);
    if (ghostData) setGhosts(ghostData.sessions ?? ghostData.ghosts ?? []);
    setLastPoll(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const keys  = data?.keys ?? [];
  const sum   = data?.summary;

  const filtered = keys.filter(k => {
    if (liveOnly && !k.isLive) return false;
    if (flaggedOnly && k.tceHealth === "good") return false;
    if (search && !k.licenseKey.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const activeStreams = keys.filter(k => k.isLive);

  // Section nav
  const sections = [
    { id: "overview", label: "Overview" },
    { id: "tce",      label: "TCE Analytics" },
    { id: "profit",   label: "Profit" },
    { id: "decart",   label: "Decart Pool" },
    { id: "ghost",    label: `Ghost Sessions${ghosts.length > 0 ? ` (${ghosts.length})` : ""}` },
    { id: "streams",  label: `Live Streams${activeStreams.length > 0 ? ` (${activeStreams.length})` : ""}` },
  ] as const;

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-primary" />
              Billing Analytics
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Production control center · wallet.used_seconds truth · READ ONLY
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastPoll && <span className="text-xs text-muted-foreground font-mono">{lastPoll.toLocaleTimeString()}</span>}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: "hsl(142 76% 36% / 0.12)", border: "1px solid hsl(142 76% 36% / 0.3)" }}>
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400 font-mono font-semibold">LIVE 3s</span>
            </div>
            <button onClick={fetchAll} className="text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="flex items-center gap-3 rounded-lg p-4"
            style={{ background: "hsl(0 84% 60% / 0.08)", border: "1px solid hsl(0 84% 60% / 0.3)" }}>
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-red-400 font-mono text-xs">{error}</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && sum && (
          <>
            {/* ── Summary Cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <SummaryCard label="Real Seconds Used"      value={fmtSec(sum.totalUsedSeconds)}       sub="wallet.used_seconds truth"             color="hsl(var(--foreground))"  icon={Clock} />
              <SummaryCard label="Display Seconds (TCE)"  value={fmtSec(sum.totalDisplaySeconds)}    sub="compressed UX time"                    color="hsl(187 100% 52%)"       icon={Timer} />
              <SummaryCard label="Total Revenue"          value={`${sum.totalRevenue} cr`}            sub={`${sum.globalBillingRate} cr/s rate`}  color="hsl(142 76% 36%)"        icon={TrendingUp} />
              <SummaryCard label="Decart Cost"            value={`${sum.totalCost} cr`}              sub={`${COST_RATE} cr/s fixed`}             color="hsl(0 84% 60%)"          icon={DollarSign} />
              <SummaryCard label="Total Profit"           value={`${sum.totalProfit} cr`}            sub={sum.totalProfit >= 0 ? "profitable" : "loss"} color={sum.totalProfit >= 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"} icon={Zap} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <SummaryCard label="Avg Compression"        value={`${sum.avgCompressionFactor}×`}     sub="TCE factor avg"                        color="hsl(187 100% 52%)"       icon={Activity} />
              <SummaryCard label="Active Streams"         value={String(sum.activeStreams)}           sub="live right now"                        color="hsl(142 76% 36%)"        icon={Wifi} />
              <SummaryCard label="Ghost Sessions"         value={String(sum.ghostSessionCount)}       sub="no heartbeat detected"                 color={sum.ghostSessionCount > 0 ? "hsl(0 84% 60%)" : "hsl(215 20% 65%)"} icon={Ghost} />
              <SummaryCard label="Drift Alerts"           value={String(sum.driftAlertCount)}        sub="TCE drift ≥5%"                         color={sum.driftAlertCount > 0 ? "#fed330" : "hsl(215 20% 65%)"}         icon={AlertTriangle} />
              <SummaryCard label="Decart Credits Burned"  value={`${sum.totalDecartCreditsBurned} cr`} sub="actual api burn"                    color="hsl(215 20% 65%)"        icon={Key} />
            </div>

            {/* ── Section Nav ── */}
            <div className="flex gap-1 overflow-x-auto pb-1">
              {sections.map(s => (
                <button key={s.id} onClick={() => setActiveSection(s.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium whitespace-nowrap transition-colors ${
                    activeSection === s.id
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* ── Filters ── */}
            {["overview", "tce", "profit"].includes(activeSection) && (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 flex-1 max-w-xs"
                  style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 18%)" }}>
                  <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search licence key…"
                    className="bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none flex-1" />
                  {search && <button onClick={() => setSearch("")}><X className="w-3.5 h-3.5 text-muted-foreground" /></button>}
                </div>
                <button onClick={() => setLiveOnly(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono border transition-colors ${liveOnly ? "bg-green-400/15 text-green-400 border-green-400/30" : "text-muted-foreground border-border hover:text-foreground"}`}>
                  <Eye className="w-3.5 h-3.5" /> LIVE ONLY
                </button>
                <button onClick={() => setFlaggedOnly(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono border transition-colors ${flaggedOnly ? "bg-yellow-400/15 text-yellow-400 border-yellow-400/30" : "text-muted-foreground border-border hover:text-foreground"}`}>
                  <AlertTriangle className="w-3.5 h-3.5" /> FLAGGED ONLY
                </button>
                <p className="text-xs text-muted-foreground font-mono">{filtered.length} keys</p>
              </div>
            )}

            {/* ════════ OVERVIEW ════════ */}
            {activeSection === "overview" && (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "hsl(222 44% 6%)" }}>
                        {["Licence Key","Decart Key","Device","Real Used","Display Used","Display Rem","Eff. Rate","Revenue","Cost","Profit","Reconnects","Last HB","Drift %","Health","Live"].map(h => (
                          <th key={h} className="px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-right first:text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr><td colSpan={15} className="text-center py-12 text-muted-foreground font-mono text-sm">No licence keys match filter</td></tr>
                      ) : filtered.map(k => (
                        <tr key={k.licenseKeyId} style={{ borderTop: "1px solid hsl(222 40% 11%)" }} className={k.isLive ? "bg-green-400/[0.02]" : ""}>
                          <td className="px-3 py-2 font-mono text-foreground whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${k.isActive ? "bg-green-400" : "bg-muted"}`} />
                              <span title={k.licenseKey}>{fmtKey(k.licenseKey)}</span>
                              {k.rateSource === "custom" && <span className="text-[9px] px-1 rounded font-mono" style={{ background: "hsl(187 100% 52% / 0.15)", color: "hsl(187 100% 52%)", border: "1px solid hsl(187 100% 52% / 0.3)" }}>C</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">{k.decartLabel ?? "—"}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap text-[10px]">{k.deviceId ? k.deviceId.slice(0,8)+"…" : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono text-foreground">{fmtSec(k.usedSeconds)}</td>
                          <td className="px-3 py-2 text-right font-mono text-primary">{fmtSec(k.displaySecondsUsed)}</td>
                          <td className="px-3 py-2 text-right font-mono" style={{ color: k.remainingSeconds <= 0 ? "hsl(0 84% 60%)" : "hsl(142 76% 36%)" }}>{fmtSec(k.displaySecondsRemaining)}</td>
                          <td className="px-3 py-2 text-right font-mono text-foreground">{k.effectiveRate} cr/s</td>
                          <td className="px-3 py-2 text-right font-mono text-green-400">{k.revenue > 0 ? `${k.revenue}` : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono text-red-400/70">{k.cost > 0 ? `${k.cost}` : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono" style={{ color: k.profit > 0 ? "hsl(142 76% 36%)" : k.profit < 0 ? "hsl(0 84% 60%)" : "hsl(215 20% 65%)" }}>{k.profit !== 0 ? (k.profit > 0 ? `+${k.profit}` : `${k.profit}`) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">{k.reconnectCount}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap text-[10px]">{fmtTs(k.lastHeartbeat)}</td>
                          <td className="px-3 py-2 text-right font-mono" style={{ color: driftColor(k.driftPct) }}>{k.driftPct}%</td>
                          <td className="px-3 py-2 text-right">
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                              style={{ background: `${driftColor(k.tceHealth === "good" ? 0 : k.tceHealth === "warning" ? 3 : 6)}18`, color: driftColor(k.tceHealth === "good" ? 0 : k.tceHealth === "warning" ? 3 : 6) }}>
                              {healthLabel(k.tceHealth)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {k.isLive
                              ? <span className="inline-flex items-center gap-1 text-[10px] font-mono text-green-400"><span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />LIVE</span>
                              : <span className="text-[10px] font-mono text-muted-foreground">idle</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {filtered.length > 0 && sum && (
                      <tfoot style={{ borderTop: "2px solid hsl(222 40% 14%)", background: "hsl(222 44% 5%)" }}>
                        <tr>
                          <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">TOTAL</td>
                          <td colSpan={2} />
                          <td className="px-3 py-2 text-right font-mono text-foreground font-bold">{fmtSec(sum.totalUsedSeconds)}</td>
                          <td className="px-3 py-2 text-right font-mono text-primary font-bold">{fmtSec(sum.totalDisplaySeconds)}</td>
                          <td colSpan={2} />
                          <td className="px-3 py-2 text-right font-mono text-green-400 font-bold">{sum.totalRevenue}</td>
                          <td className="px-3 py-2 text-right font-mono text-red-400/70 font-bold">{sum.totalCost}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold" style={{ color: sum.totalProfit >= 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)" }}>{sum.totalProfit >= 0 ? `+${sum.totalProfit}` : sum.totalProfit}</td>
                          <td colSpan={5} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )}

            {/* ════════ TCE ANALYTICS ════════ */}
            {activeSection === "tce" && (
              <div className="space-y-4">
                <div className="rounded-xl p-4 space-y-2" style={{ background: "hsl(222 44% 5%)", border: "1px solid hsl(187 100% 52% / 0.15)" }}>
                  <p className="text-xs font-mono text-primary font-bold uppercase tracking-wider">TCE Layer — UX Only · Billing Unaffected</p>
                  <p className="text-xs font-mono text-muted-foreground">compression_factor = effective_billing_rate ÷ {COST_RATE} · display_seconds = real_seconds × factor</p>
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: "hsl(222 44% 6%)" }}>
                          {["Licence Key","Eff. Rate","Compress×","Real Used","Display Used","Real Rem","Display Rem","Drift %","TCE Status"].map(h => (
                            <th key={h} className="px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-right first:text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(k => (
                          <tr key={k.licenseKeyId} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}>
                            <td className="px-3 py-2 font-mono text-foreground whitespace-nowrap"><span title={k.licenseKey}>{fmtKey(k.licenseKey)}</span></td>
                            <td className="px-3 py-2 text-right font-mono text-foreground">{k.effectiveRate} cr/s</td>
                            <td className="px-3 py-2 text-right font-mono font-bold" style={{ color: k.compressionFactor > 1 ? "hsl(187 100% 52%)" : k.compressionFactor < 1 ? "hsl(0 84% 60%)" : "hsl(215 20% 65%)" }}>{k.compressionFactor}×</td>
                            <td className="px-3 py-2 text-right font-mono text-foreground">{fmtSec(k.usedSeconds)}</td>
                            <td className="px-3 py-2 text-right font-mono text-primary">{fmtSec(k.displaySecondsUsed)}</td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmtSec(k.remainingSeconds)}</td>
                            <td className="px-3 py-2 text-right font-mono" style={{ color: k.remainingSeconds > 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)" }}>{fmtSec(k.displaySecondsRemaining)}</td>
                            <td className="px-3 py-2 text-right font-mono" style={{ color: driftColor(k.driftPct) }}>{k.driftPct}%</td>
                            <td className="px-3 py-2 text-right">
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full" style={{ background: `${driftColor(k.tceHealth === "good" ? 0 : k.tceHealth === "warning" ? 3 : 6)}18`, border: `1px solid ${driftColor(k.tceHealth === "good" ? 0 : k.tceHealth === "warning" ? 3 : 6)}40`, color: driftColor(k.tceHealth === "good" ? 0 : k.tceHealth === "warning" ? 3 : 6) }}>
                                {k.tceHealth === "good" ? "🟢 GOOD" : k.tceHealth === "warning" ? "🟡 WARNING" : "🔴 DRIFT"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ════════ PROFIT ANALYTICS ════════ */}
            {activeSection === "profit" && (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "hsl(222 44% 6%)" }}>
                        {["Licence Key","Eff. Rate","Real Seconds","Revenue","Decart Cost","Profit","Profit/s","Margin %","Source"].map(h => (
                          <th key={h} className="px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-right first:text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(k => (
                        <tr key={k.licenseKeyId} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}>
                          <td className="px-3 py-2 font-mono text-foreground whitespace-nowrap"><span title={k.licenseKey}>{fmtKey(k.licenseKey)}</span></td>
                          <td className="px-3 py-2 text-right font-mono text-foreground">{k.effectiveRate} cr/s</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmtSec(k.usedSeconds)}</td>
                          <td className="px-3 py-2 text-right font-mono text-green-400">{k.revenue > 0 ? k.revenue : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono text-red-400/70">{k.cost > 0 ? k.cost : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold" style={{ color: k.profit > 0 ? "hsl(142 76% 36%)" : k.profit < 0 ? "hsl(0 84% 60%)" : "hsl(215 20% 65%)" }}>
                            {k.profit !== 0 ? (k.profit > 0 ? `+${k.profit}` : `${k.profit}`) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono" style={{ color: k.profitPerSecond > 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)" }}>
                            {k.profitPerSecond >= 0 ? "+" : ""}{k.profitPerSecond} cr/s
                          </td>
                          <td className="px-3 py-2 text-right font-mono" style={{ color: k.marginPct > 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)" }}>
                            {k.marginPct > 0 ? "+" : ""}{k.marginPct}%
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={k.rateSource === "custom" ? { background: "hsl(187 100% 52% / 0.15)", color: "hsl(187 100% 52%)", border: "1px solid hsl(187 100% 52% / 0.3)" } : { background: "hsl(222 40% 14%)", color: "hsl(215 20% 65%)", border: "1px solid hsl(222 40% 20%)" }}>
                              {k.rateSource === "custom" ? "CUSTOM" : "GLOBAL"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {sum && (
                      <tfoot style={{ borderTop: "2px solid hsl(222 40% 14%)", background: "hsl(222 44% 5%)" }}>
                        <tr>
                          <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">TOTAL</td>
                          <td colSpan={2} />
                          <td className="px-3 py-2 text-right font-mono text-green-400 font-bold">{sum.totalRevenue}</td>
                          <td className="px-3 py-2 text-right font-mono text-red-400/70 font-bold">{sum.totalCost}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold" style={{ color: sum.totalProfit >= 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)" }}>{sum.totalProfit >= 0 ? `+${sum.totalProfit}` : sum.totalProfit}</td>
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )}

            {/* ════════ DECART POOL ════════ */}
            {activeSection === "decart" && (
              <div className="space-y-4">
                {decartKeys.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground font-mono text-sm">No Decart API keys configured</div>
                ) : decartKeys.map(dk => {
                  const assignedKeys = keys.filter(k => k.decartLabel === dk.label);
                  const activeSessions = assignedKeys.reduce((a, k) => a + k.activeSessionCount, 0);
                  const totalUsed = assignedKeys.reduce((a, k) => a + k.usedSeconds, 0);
                  const expectedBurn = Math.round(totalUsed * COST_RATE * 100) / 100;
                  const creditsUsed = dk.totalCreditsLoaded - dk.creditsBaseline;
                  const drift = expectedBurn > 0 ? Math.abs((creditsUsed - expectedBurn) / expectedBurn * 100) : 0;
                  const driftPct = Math.round(drift * 100) / 100;
                  return (
                    <div key={dk.id} className="rounded-xl p-5 space-y-4" style={{ background: "hsl(222 44% 6%)", border: `1px solid ${driftPct >= 5 ? "hsl(0 84% 60% / 0.4)" : driftPct >= 2 ? "hsl(45 100% 51% / 0.3)" : "hsl(222 40% 14%)"}` }}>
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-2.5 h-2.5 rounded-full ${dk.isActive && dk.healthStatus !== "error" ? "bg-green-400" : "bg-red-400"}`} />
                          <p className="font-mono font-bold text-foreground">{dk.label}</p>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: dk.isActive ? "hsl(142 76% 36% / 0.15)" : "hsl(0 84% 60% / 0.15)", color: dk.isActive ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)", border: `1px solid ${dk.isActive ? "hsl(142 76% 36% / 0.3)" : "hsl(0 84% 60% / 0.3)"}` }}>
                            {dk.healthStatus?.toUpperCase() ?? "UNKNOWN"}
                          </span>
                        </div>
                        <div className="text-xs font-mono text-muted-foreground">
                          {activeSessions}/{dk.maxUsers ?? "∞"} active · Drift: <span style={{ color: driftColor(driftPct) }}>{driftPct}%</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                        <div><p className="text-muted-foreground mb-1">Credits Loaded</p><p className="text-foreground font-bold">{dk.totalCreditsLoaded}</p></div>
                        <div><p className="text-muted-foreground mb-1">Baseline</p><p className="text-foreground font-bold">{dk.creditsBaseline}</p></div>
                        <div><p className="text-muted-foreground mb-1">Expected Burn</p><p className="text-foreground font-bold">{expectedBurn} cr</p></div>
                        <div><p className="text-muted-foreground mb-1">Assigned Keys</p><p className="text-foreground font-bold">{assignedKeys.length}</p></div>
                      </div>
                      {assignedKeys.length > 0 && (
                        <div className="text-[11px] font-mono text-muted-foreground">
                          Keys: {assignedKeys.map(k => fmtKey(k.licenseKey)).join(" · ")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ════════ GHOST SESSIONS ════════ */}
            {activeSection === "ghost" && (
              <div className="space-y-4">
                <div className="rounded-lg p-4" style={{ background: "hsl(0 84% 60% / 0.06)", border: "1px solid hsl(0 84% 60% / 0.2)" }}>
                  <p className="text-xs font-mono text-red-400">READ ONLY — Ghost sessions detected by missing heartbeat or duplicate active session anomalies. Use cleanup button to settle individually.</p>
                </div>
                {ghosts.length === 0 ? (
                  <div className="text-center py-12">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-green-400 opacity-60" />
                    <p className="text-muted-foreground font-mono text-sm">No ghost sessions detected</p>
                  </div>
                ) : (
                  <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: "hsl(222 44% 6%)" }}>
                          {["Session ID","Licence Key","Last Heartbeat","Orphan Age","Status","Action"].map(h => (
                            <th key={h} className="px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ghosts.map((g, i) => {
                          const sid = g.sessionId ?? g.id ?? String(i);
                          const hb  = g.lastHeartbeat ?? g.lastHeartbeatAt ?? null;
                          return (
                            <tr key={sid} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}>
                              <td className="px-3 py-2 font-mono text-muted-foreground text-[10px]">{sid.slice(0, 12)}…</td>
                              <td className="px-3 py-2 font-mono text-foreground">{g.licenseKey ? fmtKey(g.licenseKey) : "—"}</td>
                              <td className="px-3 py-2 font-mono text-muted-foreground">{fmtTs(hb)}</td>
                              <td className="px-3 py-2 font-mono text-red-400">{g.orphanAgeSeconds ? fmtSec(g.orphanAgeSeconds) : "—"}</td>
                              <td className="px-3 py-2"><span className="text-[10px] font-mono text-red-400 px-2 py-0.5 rounded" style={{ background: "hsl(0 84% 60% / 0.1)", border: "1px solid hsl(0 84% 60% / 0.3)" }}>GHOST</span></td>
                              <td className="px-3 py-2">
                                <button className="text-[10px] font-mono text-muted-foreground hover:text-red-400 transition-colors px-2 py-1 rounded border border-border hover:border-red-400/30">
                                  Settle
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ════════ LIVE STREAMS ════════ */}
            {activeSection === "streams" && (
              <div className="space-y-3">
                {activeStreams.length === 0 ? (
                  <div className="text-center py-12">
                    <Wifi className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-40" />
                    <p className="text-muted-foreground font-mono text-sm">No active streams right now</p>
                  </div>
                ) : activeStreams.map(k => (
                  <div key={k.licenseKeyId} className="rounded-xl p-4 flex flex-wrap items-center gap-6" style={{ background: "hsl(142 76% 36% / 0.04)", border: "1px solid hsl(142 76% 36% / 0.2)" }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      <span className="font-mono text-foreground text-sm font-bold">{fmtKey(k.licenseKey)}</span>
                      {k.decartLabel && <span className="text-[10px] font-mono text-muted-foreground">via {k.decartLabel}</span>}
                    </div>
                    <div className="flex gap-6 text-xs font-mono flex-wrap">
                      <div><p className="text-muted-foreground text-[10px]">Real Consumed</p><p className="text-foreground font-bold">{fmtSec(k.usedSeconds)}</p></div>
                      <div><p className="text-muted-foreground text-[10px]">Display Shown</p><p className="text-primary font-bold">{fmtSec(k.displaySecondsUsed)}</p></div>
                      <div><p className="text-muted-foreground text-[10px]">Rate</p><p className="text-foreground font-bold">{k.effectiveRate} cr/s</p></div>
                      <div><p className="text-muted-foreground text-[10px]">Compress×</p><p className="font-bold" style={{ color: k.compressionFactor > 1 ? "hsl(187 100% 52%)" : "hsl(215 20% 65%)" }}>{k.compressionFactor}×</p></div>
                      <div><p className="text-muted-foreground text-[10px]">Profit/s</p><p className="font-bold" style={{ color: k.profitPerSecond > 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)" }}>{k.profitPerSecond >= 0 ? "+" : ""}{k.profitPerSecond}</p></div>
                      <div><p className="text-muted-foreground text-[10px]">Last HB</p><p className="text-foreground">{fmtTs(k.lastHeartbeat)}</p></div>
                      <div><p className="text-muted-foreground text-[10px]">Sessions</p><p className="text-foreground">{k.activeSessionCount}</p></div>
                    </div>
                    <div className="ml-auto">
                      <span className="text-[10px] font-mono px-2 py-1 rounded" style={{ background: "hsl(142 76% 36% / 0.12)", border: "1px solid hsl(142 76% 36% / 0.3)", color: "hsl(142 76% 36%)" }}>
                        {healthLabel(k.tceHealth)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
