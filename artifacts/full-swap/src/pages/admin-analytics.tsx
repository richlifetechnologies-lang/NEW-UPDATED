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
  effectiveRate: number; rateSource: string;

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

type Section = "overview" | "profit" | "decart" | "ghost" | "streams" | "revenue" | "wallet";

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
  const [revenueData, setRevenueData] = useState<any>(null);
  const [walletData, setWalletData]   = useState<any>(null);

  const fetchAll = useCallback(async () => {
    const [brk, dkeys, ghostRes, revRes, walRes] = await Promise.all([
      apiFetch<BrkResponse>("/api/admin/billing-rate-per-key?limit=500"),
      apiFetch<{ keys: DecartKey[] }>("/api/admin/decart-keys"),
      apiFetch<Record<string, any>>("/api/admin/billing-intelligence/ghost-sessions"),
      apiFetch<any>("/api/admin/unified/revenue-intelligence"),
      apiFetch<any>("/api/admin/unified/wallet-health"),
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

  const keys = Array.isArray(brkData?.keys) ? brkData!.keys : [];
  const globalRate = brkData?.globalBillingRate ?? 0;

  // Compute enriched rows
  const enriched = keys.map(k => {
    const revenue = Math.round(k.usedSeconds * k.effectiveRate * 100) / 100;
    const cost    = Math.round(k.usedSeconds * COST_RATE * 100) / 100;
    const profit  = Math.round((revenue - cost) * 100) / 100;
      ? Math.round(Math.abs((dispUsed - k.usedSeconds) / k.usedSeconds) * 10000) / 100
      : 0;
    return { ...k, revenue, cost, profit,
 };
  });

  // Summary
  const totalUsed    = enriched.reduce((a, k) => a + k.usedSeconds, 0);
  const totalRev     = Math.round(enriched.reduce((a, k) => a + k.revenue, 0) * 100) / 100;
  const totalCost    = Math.round(enriched.reduce((a, k) => a + k.cost, 0) * 100) / 100;
  const totalProfit  = Math.round((totalRev - totalCost) * 100) / 100;
  const activeCount  = enriched.filter(k => k.isLive).length;
  const ghostCount   = ghosts.length;
  const totalBurn    = Math.round(totalUsed * COST_RATE * 100) / 100;

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
    { id: "profit",   label: "Profit" },
    { id: "decart",   label: "Decart Pool" },
    { id: "ghost",    label: `Ghost Sessions${ghosts.length > 0 ? ` (${ghosts.length})` : ""}` },
    { id: "streams",  label: `Live Streams${liveStreams.length > 0 ? ` (${liveStreams.length})` : ""}` },
    { id: "revenue",  label: "Revenue Intel" },
    { id: "wallet",   label: "Wallet Health" },
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
              <SCard label="Total Revenue"          value={`${totalRev} cr`}      sub={`${globalRate} cr/s rate`}  color="hsl(142 76% 36%)"         icon={TrendingUp} />
              <SCard label="Decart API Cost"        value={`${totalCost} cr`}     sub={`${COST_RATE} cr/s fixed`}  color="hsl(0 84% 60%)"           icon={DollarSign} />
              <SCard label="Total Profit"           value={`${totalProfit} cr`}   sub={totalProfit >= 0 ? "profitable" : "loss"} color={totalProfit >= 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"} icon={Zap} />
            </div>
            {/* Summary Cards — Row 2 */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <SCard label="Active Streams"         value={String(activeCount)}   sub="live right now"             color="hsl(142 76% 36%)"         icon={Wifi} />
              <SCard label="Ghost Sessions"         value={String(ghostCount)}    sub="no heartbeat detected"      color={ghostCount > 0 ? "hsl(0 84% 60%)" : "hsl(215 20% 55%)"} icon={AlertTriangle} />
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
                        <TH>Health</TH>
                        <TH>Live</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>

                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
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
