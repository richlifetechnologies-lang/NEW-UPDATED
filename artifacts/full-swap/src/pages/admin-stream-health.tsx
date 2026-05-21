/**
 * admin-stream-health.tsx — Real-time stream health monitor.
 * Auto-refreshes every 10 seconds. Shows every active stream with
 * Decart key assignment, burn rate, and estimated minutes remaining.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import {
  Activity, AlertTriangle, CheckCircle2, Clock,
  Flame, Key, Radio, RefreshCw, Wifi, WifiOff, Zap,
} from "lucide-react";

const COST_RATE = 2.3;
const REFRESH_INTERVAL_MS = 10_000;

function authH() {
  return { Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token") ?? ""}` };
}

interface StreamEntry {
  sessionId:         string;
  style:             string;
  startedAt:         string;
  elapsedSec:        number;
  licenseKey:        string;
  minutesAllocated:  number;
  usedSeconds:       number;
  remainingSec:      number;
  estimatedMinsLeft: number;
  burnRateCrPerSec:  number;
  decartKeyId:       number | null;
  decartKeyLabel:    string;
  decartKeyActive:   boolean;
  lastHeartbeatAt:   string | null;
  heartbeatStatus:   "ok" | "late" | "missing";
  healthStatus:      "healthy" | "warning" | "critical";
}

interface Summary {
  activeStreams:       number;
  totalBurnRateCrSec: number;
  totalRemainingSec:  number;
  decartKeysInUse:    number;
}

interface ByDecartKey {
  label:           string;
  count:           number;
  totalRemainingSec: number;
}

interface HealthPayload {
  fetchedAt: string;
  summary:   Summary;
  byDecartKey: Record<string, ByDecartKey>;
  streams:   StreamEntry[];
}

function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function fmtMins(sec: number): string {
  const m = Math.floor(sec / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}

function healthColor(status: string) {
  if (status === "critical") return { border: "#ef4444", bg: "rgba(239,68,68,0.06)", badge: "bg-red-500/15 text-red-400 border-red-500/25" };
  if (status === "warning")  return { border: "#f59e0b", bg: "rgba(245,158,11,0.06)", badge: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25" };
  return                            { border: "#22c55e", bg: "rgba(34,197,94,0.06)",  badge: "bg-green-500/15 text-green-400 border-green-500/25" };
}

function heartbeatIcon(status: string) {
  if (status === "ok")      return <Wifi className="w-3.5 h-3.5 text-green-400" />;
  if (status === "late")    return <Wifi className="w-3.5 h-3.5 text-yellow-400" />;
  return                           <WifiOff className="w-3.5 h-3.5 text-red-400" />;
}

const STYLE_COLORS: Record<string, string> = {
  natural:        "bg-blue-500/15 text-blue-300",
  anime:          "bg-pink-500/15 text-pink-300",
  superhero:      "bg-yellow-500/15 text-yellow-300",
  cinematic:      "bg-purple-500/15 text-purple-300",
  cyberpunk:      "bg-cyan-500/15 text-cyan-300",
  "oil-painting": "bg-orange-500/15 text-orange-300",
  sketch:         "bg-zinc-500/15 text-zinc-300",
  "3d-render":    "bg-green-500/15 text-green-300",
  vintage:        "bg-amber-500/15 text-amber-300",
};

function LiveClock({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() =>
    Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  );
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span className="font-mono tabular-nums">{fmtElapsed(elapsed)}</span>;
}

function LiveRemaining({ fetchedAt, remainingSecAtFetch, active }: {
  fetchedAt: string; remainingSecAtFetch: number; active: boolean;
}) {
  const baseRef = useRef({ fetchedAt, remainingSecAtFetch });
  useEffect(() => { baseRef.current = { fetchedAt, remainingSecAtFetch }; }, [fetchedAt, remainingSecAtFetch]);

  const calcRemaining = () => {
    if (!active) return baseRef.current.remainingSecAtFetch;
    const elapsed = (Date.now() - new Date(baseRef.current.fetchedAt).getTime()) / 1000;
    return Math.max(0, baseRef.current.remainingSecAtFetch - elapsed);
  };

  const [rem, setRem] = useState(calcRemaining);
  useEffect(() => {
    const id = setInterval(() => setRem(calcRemaining()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const color = rem < 300 ? "text-red-400" : rem < 900 ? "text-yellow-400" : "text-green-400";
  return <span className={`font-mono tabular-nums font-bold ${color}`}>{fmtMins(Math.round(rem))}</span>;
}

export default function AdminStreamHealthPage() {
  const [, setLocation] = useLocation();
  const [data, setData] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_MS / 1000);

  const token = localStorage.getItem("fullswap_admin_token");
  useEffect(() => { if (!token) setLocation("/admin"); }, [setLocation, token]);

  const fetchHealth = useCallback(async () => {
    setFetching(true);
    try {
      const res = await fetch("/api/admin/stream-health", { headers: authH() });
      if (res.ok) {
        const d: HealthPayload = await res.json();
        setData(d);
        setLastRefresh(new Date());
        setCountdown(REFRESH_INTERVAL_MS / 1000);
      }
    } catch { /* silent */ } finally {
      setFetching(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  useEffect(() => {
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const streams = data?.streams ?? [];
  const summary = data?.summary;
  const byKey   = data?.byDecartKey ?? {};
  const fetchedAt = data?.fetchedAt ?? "";

  const criticalCount = streams.filter(s => s.healthStatus === "critical").length;
  const warningCount  = streams.filter(s => s.healthStatus === "warning").length;

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Radio className="w-6 h-6 text-primary" />
              Stream Health Monitor
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {summary && summary.activeStreams > 0
                ? <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
                    {summary.activeStreams} active stream{summary.activeStreams !== 1 ? "s" : ""} · {COST_RATE} cr/s each
                  </span>
                : "No active streams right now"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs text-muted-foreground">
                Next refresh in <span className="font-mono text-foreground">{countdown}s</span>
              </span>
            )}
            <button
              onClick={fetchHealth}
              disabled={fetching}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${fetching ? "animate-spin text-primary" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Alert banner for critical streams */}
        {criticalCount > 0 && (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg border border-red-500/30 bg-red-500/08 text-red-400 text-sm font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {criticalCount} stream{criticalCount !== 1 ? "s" : ""} under 5 minutes remaining — act now
          </div>
        )}
        {criticalCount === 0 && warningCount > 0 && (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg border border-yellow-500/30 bg-yellow-500/08 text-yellow-400 text-sm font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {warningCount} stream{warningCount !== 1 ? "s" : ""} under 15 minutes remaining
          </div>
        )}

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "Active Streams",    value: summary.activeStreams,           icon: Activity,  color: "text-blue-400" },
              { label: "Total Burn Rate",   value: `${summary.totalBurnRateCrSec.toFixed(1)} cr/s`, icon: Flame, color: "text-orange-400" },
              { label: "Agg. Time Left",    value: fmtMins(summary.totalRemainingSec), icon: Clock, color: summary.totalRemainingSec < 1800 ? "text-red-400" : "text-green-400" },
              { label: "Decart Keys In Use",value: summary.decartKeysInUse,         icon: Key,   color: "text-purple-400" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="rounded-xl border border-border bg-card p-4">
                <div className={`flex items-center gap-2 ${color} mb-1.5`}>
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-medium text-muted-foreground">{label}</span>
                </div>
                <p className={`text-xl font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Decart key breakdown */}
        {Object.keys(byKey).length > 0 && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Key className="w-4 h-4 text-muted-foreground" />
                Decart Key Load
              </h2>
            </div>
            <div className="divide-y divide-border">
              {Object.entries(byKey).map(([id, info]) => (
                <div key={id} className="px-4 py-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">{info.label}</span>
                  </div>
                  <div className="flex items-center gap-6 shrink-0 text-sm">
                    <span className="text-muted-foreground">
                      <span className="font-mono text-foreground font-medium">{info.count}</span> stream{info.count !== 1 ? "s" : ""}
                    </span>
                    <span className="text-muted-foreground">
                      burn: <span className="font-mono text-orange-400 font-medium">{(info.count * COST_RATE).toFixed(1)} cr/s</span>
                    </span>
                    <span className="text-muted-foreground">
                      min agg. left: <span className="font-mono text-foreground font-medium">{fmtMins(info.totalRemainingSec)}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stream list */}
        {loading ? (
          <div className="rounded-xl border border-border bg-card p-12 flex items-center justify-center">
            <div className="flex items-center gap-3 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading stream data…</span>
            </div>
          </div>
        ) : streams.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center justify-center gap-3 text-center">
            <Activity className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No active streams right now.</p>
            <p className="text-xs text-muted-foreground/60">This page auto-refreshes every 10 seconds.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Live Streams — sorted by time remaining (low first)
            </h2>
            <div className="grid gap-3">
              {streams.map((s) => {
                const colors = healthColor(s.healthStatus);
                const pct = s.minutesAllocated > 0
                  ? Math.min(100, Math.max(0, (s.remainingSec / (s.minutesAllocated * 60)) * 100))
                  : 0;
                return (
                  <div
                    key={s.sessionId}
                    className="rounded-xl border bg-card overflow-hidden"
                    style={{ borderColor: colors.border, background: colors.bg }}
                  >
                    {/* Progress bar */}
                    <div className="h-1 w-full bg-border/50">
                      <div
                        className="h-full transition-all duration-1000"
                        style={{
                          width: `${pct}%`,
                          background: s.healthStatus === "critical" ? "#ef4444"
                            : s.healthStatus === "warning" ? "#f59e0b" : "#22c55e",
                        }}
                      />
                    </div>

                    <div className="px-4 py-3">
                      {/* Top row */}
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
                          <span className="text-sm font-mono font-semibold text-foreground truncate">
                            {s.licenseKey.length > 24 ? `${s.licenseKey.slice(0, 10)}…${s.licenseKey.slice(-6)}` : s.licenseKey}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${colors.badge}`}>
                            {s.healthStatus}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STYLE_COLORS[s.style] ?? "bg-zinc-500/15 text-zinc-300"}`}>
                            {s.style}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                          {heartbeatIcon(s.heartbeatStatus)}
                          <span>hb: {s.heartbeatStatus}</span>
                        </div>
                      </div>

                      {/* Stats row */}
                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">Elapsed</p>
                          <LiveClock startedAt={s.startedAt} />
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">Time Left</p>
                          <LiveRemaining
                            fetchedAt={fetchedAt}
                            remainingSecAtFetch={s.remainingSec}
                            active={s.healthStatus !== "critical" || s.remainingSec > 0}
                          />
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">Burn Rate</p>
                          <span className="text-sm font-mono font-bold text-orange-400">{s.burnRateCrPerSec} cr/s</span>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">Decart Key</p>
                          <span className="text-sm font-medium text-foreground flex items-center gap-1">
                            <Zap className="w-3 h-3 text-yellow-400" />
                            {s.decartKeyLabel}
                          </span>
                        </div>
                      </div>

                      {/* Footer row */}
                      <div className="mt-2.5 flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
                        <span>{s.minutesAllocated} min allocated</span>
                        <span>·</span>
                        <span>{Math.floor((s.minutesAllocated * 60 - s.remainingSec) / 60)} min used</span>
                        <span>·</span>
                        <span className="font-mono text-[10px]">ID: {s.sessionId.slice(0, 16)}…</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {lastRefresh && (
          <p className="text-center text-[11px] text-muted-foreground/50">
            Last fetched {lastRefresh.toLocaleTimeString()} · auto-refreshes every 10s
          </p>
        )}
      </div>
    </AdminLayout>
  );
}
