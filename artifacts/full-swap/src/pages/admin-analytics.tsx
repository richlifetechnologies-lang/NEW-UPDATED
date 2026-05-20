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
  Timer, X, CheckCircle2, Eye, Wifi,
} from "lucide-react";

const COST_RATE = 2.3;

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
  displaySecondsUsed: number; displaySecondsRemaining: number; remainingSeconds: number;
  projectedProfitPct: number; profitPerSecond: number; isLive: boolean;
  activeSessionCount: number; allocatedSeconds: number; usedSeconds: number;
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
function tceHealth(driftPct: number): "good" | "warning" | "drift" {
  if (driftPct < 2) return "good";
  if (driftPct < 5) return "warning";
  return "drift";
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

type Section = "overview" | "tce" | "profit" | "decart" | "ghost" | "streams";

export default function AdminAnalyticsPage() {
  const [brkData, setBrkData]     = useState<BrkResponse | null>(null);
  const [decartKeys, setDecartKeys] = useState<DecartKey[]>([]);
  const [ghosts, setGhosts]       = useState<GhostSession[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [liveOnly, setLiveOnly]   = useState(false);
  const [flagged, setFlagged]     = useState(false);
  const [lastPoll, setLastPoll]   = useState<string>("");
  const [section, setSection]     = useState<Section>("overview");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    const [brk, dkeys, ghostRes] = await Promise.all([
      apiFetch<BrkResponse>("/api/admin/billing-rate-per-key?limit=500"),
      apiFetch<{ keys: DecartKey[] }>("/api/admin/decart-keys"),
      apiFetch<Record<string, any>>("/api/admin/billing-intelligence/ghost-sessions"),
    ]);
    if (brk) setBrkData(brk);
    if (dkeys && Array.isArray(dkeys.keys)) setDecartKeys(dkeys.keys);
    if (ghostRes) {
      const list = ghostRes.sessions ?? ghostRes.ghosts ?? [];
      setGhosts(Array.isArray(list) ? list : []);
    }
    setLastPoll(new Date().toLocaleTimeString());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchAll]);

  const keys = Array.isArray(brkData?.keys) ? brkData!.keys : [];
  const globalRate = brkData?.globalBillingRate ?? 0;

  // Compute enriched rows
  const enriched = keys.map(k => {
    const revenue = Math.round(k.usedSeconds * k.effectiveRate * 100) / 100;
    const cost    = Math.round(k.usedSeconds * COST_RATE * 100) / 100;
    const profit  = Math.round((revenue - cost) * 100) / 100;
    const dispUsed = k.displaySecondsUsed ?? Math.round(k.usedSeconds * k.compressionFactor);
    const driftPct = k.usedSeconds > 0
      ? Math.round(Math.abs((dispUsed - k.usedSeconds) / k.usedSeconds) * 10000) / 100
      : 0;
    return { ...k, revenue, cost, profit, driftPct, health: tceHealth(driftPct) };
  });

  // Summary
  const totalUsed    = enriched.reduce((a, k) => a + k.usedSeconds, 0);
  const totalDisp    = enriched.reduce((a, k) => a + (k.displaySecondsUsed ?? 0), 0);
  const totalRev     = Math.round(enriched.reduce((a, k) => a + k.revenue, 0) * 100) / 100;
  const totalCost    = Math.round(enriched.reduce((a, k) => a + k.cost, 0) * 100) / 100;
  const totalProfit  = Math.round((totalRev - totalCost) * 100) / 100;
  const activeCount  = enriched.filter(k => k.isLive).length;
  const ghostCount   = ghosts.length;
  const driftAlerts  = enriched.filter(k => k.health === "drift").length;
  const totalBurn    = Math.round(totalUsed * COST_RATE * 100) / 100;
  const avgCF        = enriched.length > 0
    ? Math.round(enriched.reduce((a, k) => a + k.compressionFactor, 0) / enriched.length * 1000) / 1000
    : 1;

  // Filtered list
  const filtered = enriched.filter(k => {
    if (liveOnly && !k.isLive) return false;
    if (flagged && k.health === "good") return false;
    if (search && !k.licenseKey.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const liveStreams = enriched.filter(k => k.isLive);

  const sections: { id: Section; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "tce",      label: "TCE Analytics" },
    { id: "profit",   label: "Profit" },
    { id: "decart",   label: "Decart Pool" },
    { id: "ghost",    label: `Ghost Sessions${ghosts.length > 0 ? ` (${ghosts.length})` : ""}` },
    { id: "streams",  label: `Live Streams${liveStreams.length > 0 ? ` (${liveStreams.length})` : ""}` },
  ];

  const TH = ({ children }: { children: string }) => (
    <th className="px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-right first:text-left">
      {children}
    </th>
  );

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
              <SCard label="Real Seconds Used"     value={fmtSec(totalUsed)}     sub="wallet.used_seconds"        color="hsl(var(--foreground))"  icon={Clock} />
              <SCard label="Display Seconds (TCE)" value={fmtSec(totalDisp)}     sub="compressed UX time"         color="hsl(187 100% 52%)"        icon={Timer} />
              <SCard label="Total Revenue"          value={`${totalRev} cr`}      sub={`${globalRate} cr/s rate`}  color="hsl(142 76% 36%)"         icon={TrendingUp} />
              <SCard label="Decart API Cost"        value={`${totalCost} cr`}     sub={`${COST_RATE} cr/s fixed`}  color="hsl(0 84% 60%)"           icon={DollarSign} />
              <SCard label="Total Profit"           value={`${totalProfit} cr`}   sub={totalProfit >= 0 ? "profitable" : "loss"} color={totalProfit >= 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"} icon={Zap} />
            </div>
            {/* Summary Cards — Row 2 */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <SCard label="Avg Compression"       value={`${avgCF}×`}           sub="TCE factor avg"             color="hsl(187 100% 52%)"        icon={Activity} />
              <SCard label="Active Streams"         value={String(activeCount)}   sub="live right now"             color="hsl(142 76% 36%)"         icon={Wifi} />
              <SCard label="Ghost Sessions"         value={String(ghostCount)}    sub="no heartbeat detected"      color={ghostCount > 0 ? "hsl(0 84% 60%)" : "hsl(215 20% 55%)"} icon={AlertTriangle} />
              <SCard label="Drift Alerts"           value={String(driftAlerts)}   sub="TCE drift ≥5%"              color={driftAlerts > 0 ? "#fed330" : "hsl(215 20% 55%)"}        icon={AlertTriangle} />
              <SCard label="Decart Credits Burned"  value={`${totalBurn} cr`}     sub="real seconds × 2.3"         color="hsl(215 20% 55%)"         icon={Key} />
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

            {/* Filters */}
            {(section === "overview" || section === "tce" || section === "profit") && (
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
                <button onClick={() => setFlagged(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono border transition-colors"
                  style={flagged ? { background: "rgba(254,211,48,0.12)", color: "#fed330", border: "1px solid rgba(254,211,48,0.3)" } : { color: "hsl(215 20% 55%)", border: "1px solid hsl(222 40% 18%)" }}>
                  <AlertTriangle className="w-3.5 h-3.5" /> FLAGGED ONLY
                </button>
                <p className="text-xs text-muted-foreground font-mono">{filtered.length} keys</p>
              </div>
            )}

            {/* ── OVERVIEW ── */}
            {section === "overview" && (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "hsl(222 44% 6%)" }}>
                        <TH>Licence Key</TH>
                        <TH>Rate</TH>
                        <TH>Source</TH>
                        <TH>Real Used</TH>
                        <TH>Display Used</TH>
                        <TH>Display Rem</TH>
                        <TH>Revenue</TH>
                        <TH>Cost</TH>
                        <TH>Profit</TH>
                        <TH>Compress×</TH>
                        <TH>Drift%</TH>
                        <TH>Health</TH>
                        <TH>Live</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={13} className="text-center py-12 text-muted-foreground font-mono text-sm">
                            No licence keys match filter
                          </td>
                        </tr>
                      ) : filtered.map(k => (
                        <tr key={k.licenseKeyId}
                          style={{ borderTop: "1px solid hsl(222 40% 11%)" }}
                          className={k.isLive ? "bg-green-400/[0.02]" : ""}>
                          <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${k.isActive ? "bg-green-400" : "bg-muted"}`} />
                            <span title={k.licenseKey} className="text-foreground">{fmtKey(k.licenseKey)}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-foreground">{k.effectiveRate} cr/s</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                              style={k.rateSource === "custom"
                                ? { background: "hsl(187 100% 52% / 0.12)", color: "hsl(187 100% 52%)", border: "1px solid hsl(187 100% 52% / 0.3)" }
                                : { background: "hsl(222 40% 14%)", color: "hsl(215 20% 55%)", border: "1px solid hsl(222 40% 20%)" }}>
                              {k.rateSource === "custom" ? "CUSTOM" : "GLOBAL"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmtSec(k.usedSeconds)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-primary">{fmtSec(k.displaySecondsUsed)}</td>
                          <td className="px-3 py-2.5 text-right font-mono"
                            style={{ color: k.remainingSeconds > 0 ? "#26de81" : "hsl(0 84% 60%)" }}>
                            {fmtSec(k.displaySecondsRemaining)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-green-400">
                            {k.revenue > 0 ? k.revenue : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-red-400/70">
                            {k.cost > 0 ? k.cost : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold"
                            style={{ color: k.profit > 0 ? "#26de81" : k.profit < 0 ? "hsl(0 84% 60%)" : "hsl(215 20% 55%)" }}>
                            {k.profit !== 0 ? (k.profit > 0 ? `+${k.profit}` : String(k.profit)) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold"
                            style={{ color: k.compressionFactor > 1 ? "hsl(187 100% 52%)" : k.compressionFactor < 1 ? "hsl(0 84% 60%)" : "hsl(215 20% 55%)" }}>
                            {k.compressionFactor}×
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono"
                            style={{ color: driftFg(k.health) }}>
                            {k.driftPct}%
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                              style={{ background: driftBg(k.health), color: driftFg(k.health), border: `1px solid ${driftBdr(k.health)}` }}>
                              {k.health === "good" ? "🟢 GOOD" : k.health === "warning" ? "🟡 WARN" : "🔴 DRIFT"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {k.isLive
                              ? <span className="inline-flex items-center gap-1 text-[10px] font-mono text-green-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />LIVE
                                </span>
                              : <span className="text-[10px] font-mono text-muted-foreground">idle</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {filtered.length > 0 && (
                      <tfoot style={{ borderTop: "2px solid hsl(222 40% 14%)", background: "hsl(222 44% 5%)" }}>
                        <tr>
                          <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">TOTAL</td>
                          <td colSpan={3} />
                          <td className="px-3 py-2 text-right font-mono text-foreground font-bold">{fmtSec(totalUsed)}</td>
                          <td className="px-3 py-2 text-right font-mono text-primary font-bold">{fmtSec(totalDisp)}</td>
                          <td />
                          <td className="px-3 py-2 text-right font-mono text-green-400 font-bold">{totalRev}</td>
                          <td className="px-3 py-2 text-right font-mono text-red-400/70 font-bold">{totalCost}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold"
                            style={{ color: totalProfit >= 0 ? "#26de81" : "hsl(0 84% 60%)" }}>
                            {totalProfit >= 0 ? `+${totalProfit}` : String(totalProfit)}
                          </td>
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )}

            {/* ── TCE ANALYTICS ── */}
            {section === "tce" && (
              <div className="space-y-4">
                <div className="rounded-lg p-4" style={{ background: "hsl(187 100% 52% / 0.06)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
                  <p className="text-xs font-mono" style={{ color: "hsl(187 100% 52%)" }}>
                    <strong>TCE Layer — UX Display Only.</strong> compression_factor = effective_rate ÷ {COST_RATE} · Billing is NEVER affected by TCE.
                  </p>
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: "hsl(222 44% 6%)" }}>
                          <TH>Licence Key</TH>
                          <TH>Eff. Rate</TH>
                          <TH>Compress×</TH>
                          <TH>Real Used</TH>
                          <TH>Display Used</TH>
                          <TH>Real Remaining</TH>
                          <TH>Display Remaining</TH>
                          <TH>Drift %</TH>
                          <TH>TCE Status</TH>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(k => (
                          <tr key={k.licenseKeyId} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}>
                            <td className="px-3 py-2.5 font-mono text-foreground" title={k.licenseKey}>{fmtKey(k.licenseKey)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-foreground">{k.effectiveRate} cr/s</td>
                            <td className="px-3 py-2.5 text-right font-mono font-bold"
                              style={{ color: k.compressionFactor > 1 ? "hsl(187 100% 52%)" : k.compressionFactor < 1 ? "hsl(0 84% 60%)" : "hsl(215 20% 55%)" }}>
                              {k.compressionFactor}×
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmtSec(k.usedSeconds)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-primary">{fmtSec(k.displaySecondsUsed)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmtSec(k.remainingSeconds)}</td>
                            <td className="px-3 py-2.5 text-right font-mono"
                              style={{ color: k.remainingSeconds > 0 ? "#26de81" : "hsl(0 84% 60%)" }}>
                              {fmtSec(k.displaySecondsRemaining)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono" style={{ color: driftFg(k.health) }}>{k.driftPct}%</td>
                            <td className="px-3 py-2.5 text-right">
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full"
                                style={{ background: driftBg(k.health), border: `1px solid ${driftBdr(k.health)}`, color: driftFg(k.health) }}>
                                {k.health === "good" ? "🟢 GOOD" : k.health === "warning" ? "🟡 WARNING" : "🔴 DRIFT DETECTED"}
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

            {/* ── PROFIT ── */}
            {section === "profit" && (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "hsl(222 44% 6%)" }}>
                        <TH>Licence Key</TH>
                        <TH>Eff. Rate</TH>
                        <TH>Real Seconds</TH>
                        <TH>Revenue</TH>
                        <TH>Decart Cost</TH>
                        <TH>Profit</TH>
                        <TH>Profit/s</TH>
                        <TH>Margin %</TH>
                        <TH>Source</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(k => (
                        <tr key={k.licenseKeyId} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}>
                          <td className="px-3 py-2.5 font-mono text-foreground" title={k.licenseKey}>{fmtKey(k.licenseKey)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-foreground">{k.effectiveRate} cr/s</td>
                          <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmtSec(k.usedSeconds)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-green-400">{k.revenue > 0 ? k.revenue : "—"}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-red-400/70">{k.cost > 0 ? k.cost : "—"}</td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold"
                            style={{ color: k.profit > 0 ? "#26de81" : k.profit < 0 ? "hsl(0 84% 60%)" : "hsl(215 20% 55%)" }}>
                            {k.profit !== 0 ? (k.profit > 0 ? `+${k.profit}` : String(k.profit)) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono"
                            style={{ color: k.profitPerSecond > 0 ? "#26de81" : "hsl(0 84% 60%)" }}>
                            {k.profitPerSecond >= 0 ? "+" : ""}{k.profitPerSecond} cr/s
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono"
                            style={{ color: k.projectedProfitPct > 0 ? "#26de81" : "hsl(0 84% 60%)" }}>
                            {k.projectedProfitPct > 0 ? "+" : ""}{k.projectedProfitPct}%
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                              style={k.rateSource === "custom"
                                ? { background: "hsl(187 100% 52% / 0.12)", color: "hsl(187 100% 52%)", border: "1px solid hsl(187 100% 52% / 0.3)" }
                                : { background: "hsl(222 40% 14%)", color: "hsl(215 20% 55%)", border: "1px solid hsl(222 40% 20%)" }}>
                              {k.rateSource === "custom" ? "CUSTOM" : "GLOBAL"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot style={{ borderTop: "2px solid hsl(222 40% 14%)", background: "hsl(222 44% 5%)" }}>
                      <tr>
                        <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">TOTAL</td>
                        <td colSpan={2} />
                        <td className="px-3 py-2 text-right font-mono text-green-400 font-bold">{totalRev}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-400/70 font-bold">{totalCost}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold"
                          style={{ color: totalProfit >= 0 ? "#26de81" : "hsl(0 84% 60%)" }}>
                          {totalProfit >= 0 ? `+${totalProfit}` : String(totalProfit)}
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* ── DECART POOL ── */}
            {section === "decart" && (
              <div className="space-y-4">
                {decartKeys.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground font-mono text-sm">No Decart API keys configured</div>
                ) : decartKeys.map(dk => {
                  const assigned = enriched.filter(k => {
                    const keyLabel = String(dk.label ?? "");
                    return k.isLive;
                  });
                  const activeForKey = enriched.filter(k => k.isLive).length;
                  const totalUsedForKey = enriched.reduce((a, k) => a + k.usedSeconds, 0);
                  const expectedBurn = Math.round(totalUsedForKey * COST_RATE * 100) / 100;
                  const creditsUsed  = Math.max(0, dk.totalCreditsLoaded - dk.creditsBaseline);
                  const drift        = expectedBurn > 0 ? Math.round(Math.abs((creditsUsed - expectedBurn) / expectedBurn) * 10000) / 100 : 0;
                  const driftH       = tceHealth(drift / 2.5);
                  const maxU         = dk.maxUsers ?? 0;
                  const loadPct      = maxU > 0 ? Math.round((activeForKey / maxU) * 100) : 0;
                  return (
                    <div key={dk.id} className="rounded-xl p-5 space-y-4"
                      style={{ background: "hsl(222 44% 6%)", border: `1px solid ${driftBdr(driftH)}` }}>
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-2.5 h-2.5 rounded-full ${dk.isActive ? "bg-green-400" : "bg-red-400"}`} />
                          <p className="font-mono font-bold text-foreground">{dk.label}</p>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded"
                            style={{ background: driftBg(driftH), color: driftFg(driftH), border: `1px solid ${driftBdr(driftH)}` }}>
                            {dk.healthStatus?.toUpperCase() ?? "UNKNOWN"}
                          </span>
                        </div>
                        <p className="text-xs font-mono text-muted-foreground">
                          Load: <span className="text-foreground">{loadPct}%</span> · Drift: <span style={{ color: driftFg(driftH) }}>{drift}%</span>
                        </p>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                        <div><p className="text-muted-foreground mb-1">Credits Loaded</p><p className="font-bold text-foreground">{dk.totalCreditsLoaded}</p></div>
                        <div><p className="text-muted-foreground mb-1">Baseline</p><p className="font-bold text-foreground">{dk.creditsBaseline}</p></div>
                        <div><p className="text-muted-foreground mb-1">Expected Burn</p><p className="font-bold text-foreground">{expectedBurn} cr</p></div>
                        <div><p className="text-muted-foreground mb-1">Active Streams</p><p className="font-bold text-foreground">{activeForKey}</p></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── GHOST SESSIONS ── */}
            {section === "ghost" && (
              <div className="space-y-4">
                <div className="rounded-lg p-4"
                  style={{ background: "hsl(0 84% 60% / 0.06)", border: "1px solid hsl(0 84% 60% / 0.2)" }}>
                  <p className="text-xs font-mono text-red-400">
                    READ ONLY — Ghost sessions = active sessions with no heartbeat for &gt;2 min. Click Settle to clean up individually.
                  </p>
                </div>
                {ghosts.length === 0 ? (
                  <div className="flex flex-col items-center py-12 gap-3">
                    <CheckCircle2 className="w-8 h-8 text-green-400 opacity-60" />
                    <p className="text-muted-foreground font-mono text-sm">No ghost sessions detected</p>
                  </div>
                ) : (
                  <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: "hsl(222 44% 6%)" }}>
                          <TH>Session ID</TH>
                          <TH>Licence Key</TH>
                          <TH>Last Heartbeat</TH>
                          <TH>Orphan Age</TH>
                          <TH>Status</TH>
                          <TH>Action</TH>
                        </tr>
                      </thead>
                      <tbody>
                        {ghosts.map((g, i) => {
                          const sid = g.sessionId ?? g.id ?? String(i);
                          const hb  = g.lastHeartbeat ?? g.lastHeartbeatAt ?? null;
                          return (
                            <tr key={sid} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}>
                              <td className="px-3 py-2.5 font-mono text-muted-foreground text-[10px]">{String(sid).slice(0, 12)}…</td>
                              <td className="px-3 py-2.5 font-mono text-foreground">{g.licenseKey ? fmtKey(g.licenseKey) : "—"}</td>
                              <td className="px-3 py-2.5 font-mono text-muted-foreground">{fmtTs(hb)}</td>
                              <td className="px-3 py-2.5 font-mono text-red-400">{g.orphanAgeSeconds ? fmtSec(g.orphanAgeSeconds) : "—"}</td>
                              <td className="px-3 py-2.5">
                                <span className="text-[10px] font-mono text-red-400 px-2 py-0.5 rounded"
                                  style={{ background: "hsl(0 84% 60% / 0.1)", border: "1px solid hsl(0 84% 60% / 0.3)" }}>
                                  GHOST
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
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

            {/* ── LIVE STREAMS ── */}
            {section === "streams" && (
              <div className="space-y-3">
                {liveStreams.length === 0 ? (
                  <div className="flex flex-col items-center py-12 gap-3">
                    <Wifi className="w-8 h-8 text-muted-foreground opacity-40" />
                    <p className="text-muted-foreground font-mono text-sm">No active streams right now</p>
                  </div>
                ) : liveStreams.map(k => (
                  <div key={k.licenseKeyId} className="rounded-xl p-4 flex flex-wrap items-center gap-6"
                    style={{ background: "rgba(38,222,129,0.03)", border: "1px solid rgba(38,222,129,0.2)" }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      <span className="font-mono text-foreground text-sm font-bold">{fmtKey(k.licenseKey)}</span>
                    </div>
                    <div className="flex gap-5 text-xs font-mono flex-wrap">
                      <div><p className="text-muted-foreground text-[10px]">Real Consumed</p><p className="text-foreground font-bold">{fmtSec(k.usedSeconds)}</p></div>
                      <div><p className="text-muted-foreground text-[10px]">Display Shown</p><p className="text-primary font-bold">{fmtSec(k.displaySecondsUsed)}</p></div>
                      <div><p className="text-muted-foreground text-[10px]">Rate</p><p className="text-foreground font-bold">{k.effectiveRate} cr/s</p></div>
                      <div><p className="text-muted-foreground text-[10px]">Compress×</p><p className="font-bold" style={{ color: k.compressionFactor > 1 ? "hsl(187 100% 52%)" : "hsl(215 20% 55%)" }}>{k.compressionFactor}×</p></div>
                      <div><p className="text-muted-foreground text-[10px]">Profit/s</p><p className="font-bold" style={{ color: k.profitPerSecond > 0 ? "#26de81" : "hsl(0 84% 60%)" }}>{k.profitPerSecond >= 0 ? "+" : ""}{k.profitPerSecond}</p></div>
                      <div><p className="text-muted-foreground text-[10px]">Sessions</p><p className="text-foreground">{k.activeSessionCount}</p></div>
                    </div>
                    <div className="ml-auto">
                      <span className="text-[10px] font-mono px-2 py-1 rounded"
                        style={{ background: driftBg(k.health), border: `1px solid ${driftBdr(k.health)}`, color: driftFg(k.health) }}>
                        {k.health === "good" ? "🟢 HEALTHY" : k.health === "warning" ? "🟡 WARNING" : "🔴 DRIFT"}
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
