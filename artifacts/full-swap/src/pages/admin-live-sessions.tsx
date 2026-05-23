import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { useQuery } from "@tanstack/react-query";
import { getAdminToken } from "@/lib/auth";
import {
  Activity,
  AlertTriangle,
  Clock,
  Gauge,
  Ghost,
  RefreshCw,
  Skull,
  Timer,
  Zap,
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchLiveSessions() {
  const res = await fetch(`${API}/api/admin/live-sessions`, {
    headers: { Authorization: `Bearer ${getAdminToken()}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function fmtTime(sec: number): string {
  if (sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

interface WalletData {
  minutesAllocated: number;
  allocatedSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  remainingMinutes: number;
  usedPercent: number;
}

interface RealStreamData {
  allocatedSeconds: number;
  allocatedMinutes: number;
  usedSeconds: number;
  usedMinutes: number;
  remainingSeconds: number;
  remainingMinutes: number;
}

interface LiveSession {
  sessionId: string;
  decartSessionId: string | null;
  licenseKeyId: number | null;
  licenseKey: string | null;
  decartKeyId: number | null;
  status: string;
  startedAt: string;
  wallClockElapsedSeconds: number;
  secondsSinceHeartbeat: number | null;
  isOrphan: boolean;
  isCritical: boolean;
  billingRate: number | null;
  compressionFactor: number;
  wallet: WalletData;
  realStream: RealStreamData;
}

interface Summary {
  totalActive: number;
  orphanCount: number;
  criticalCount: number;
  totalWalletRemainingMinutes: number;
  totalRealStreamRemainingMinutes: number;
}

interface LiveSessionsResponse {
  sessions: LiveSession[];
  summary: Summary;
  queriedAt: string;
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

function SessionCard({ s }: { s: LiveSession }) {
  const walletPct = 100 - s.wallet.usedPercent;
  const realPct = s.realStream.allocatedSeconds > 0
    ? Math.round((s.realStream.remainingSeconds / s.realStream.allocatedSeconds) * 100)
    : 0;

  const barColor = walletPct <= 10
    ? "bg-red-500"
    : walletPct <= 25
    ? "bg-yellow-500"
    : "bg-emerald-500";

  return (
    <div className={`rounded-xl border bg-card p-4 space-y-3 transition-all ${
      s.isOrphan
        ? "border-red-500/40 bg-red-500/5"
        : s.isCritical
        ? "border-yellow-500/40 bg-yellow-500/5"
        : "border-border"
    }`}>

      {/* Top row — session ID + badges */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-muted-foreground truncate max-w-[160px]" title={s.sessionId}>
              {s.sessionId.slice(0, 8)}…
            </span>
            {s.isOrphan && (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                <Ghost className="w-2.5 h-2.5" />ORPHAN
              </span>
            )}
            {s.isCritical && !s.isOrphan && (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">
                <Skull className="w-2.5 h-2.5" />CRITICAL
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {s.licenseKey ?? "—"} · key #{s.decartKeyId ?? "?"}
          </div>
        </div>

        {/* Elapsed + heartbeat */}
        <div className="text-right text-xs text-muted-foreground shrink-0">
          <div className="flex items-center gap-1 justify-end">
            <Activity className="w-3 h-3" />
            {fmtElapsed(s.wallClockElapsedSeconds)} elapsed
          </div>
          {s.secondsSinceHeartbeat != null && (
            <div className={`flex items-center gap-1 justify-end mt-0.5 ${
              s.secondsSinceHeartbeat > 8 ? "text-yellow-400" : "text-muted-foreground"
            }`}>
              <Clock className="w-3 h-3" />
              hb {s.secondsSinceHeartbeat}s ago
            </div>
          )}
        </div>
      </div>

      {/* Wallet time row */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
            <Timer className="w-3.5 h-3.5" />
            Wallet ({s.wallet.minutesAllocated}min key)
          </span>
          <span className={`font-mono font-bold tabular-nums ${
            walletPct <= 10 ? "text-red-400" : walletPct <= 25 ? "text-yellow-400" : "text-foreground"
          }`}>
            {fmtTime(s.wallet.remainingSeconds)} left
          </span>
        </div>
        <ProgressBar pct={walletPct} color={barColor} />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{fmtTime(s.wallet.usedSeconds)} used</span>
          <span>{walletPct.toFixed(0)}% remaining</span>
        </div>
      </div>

      {/* Real stream time row */}
      <div className="space-y-1 border-t border-border/50 pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-blue-400 font-medium">
            <Zap className="w-3.5 h-3.5" />
            Real Stream (×{s.compressionFactor.toFixed(3)} compression)
          </span>
          <span className="font-mono font-bold tabular-nums text-blue-400">
            {fmtTime(s.realStream.remainingSeconds)} left
          </span>
        </div>
        <ProgressBar pct={realPct} color="bg-blue-500" />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{fmtTime(s.realStream.usedSeconds)} Decart time used</span>
          <span>of {fmtTime(s.realStream.allocatedSeconds)} total real</span>
        </div>
      </div>

      {/* Rate pill */}
      {s.billingRate != null && (
        <div className="flex justify-end">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
            {s.billingRate} cr/s → {s.compressionFactor.toFixed(3)}× factor
          </span>
        </div>
      )}
    </div>
  );
}

export default function AdminLiveSessionsPage() {
  const [, setLocation] = useLocation();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery<LiveSessionsResponse>({
    queryKey: ["live-sessions"],
    queryFn: fetchLiveSessions,
    staleTime: 0,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!getAdminToken()) setLocation("/admin");
  }, [setLocation]);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const sessions: LiveSession[] = data?.sessions ?? [];
  const summary: Summary = data?.summary ?? {
    totalActive: 0, orphanCount: 0, criticalCount: 0,
    totalWalletRemainingMinutes: 0, totalRealStreamRemainingMinutes: 0,
  };

  return (
    <AdminLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Gauge className="w-6 h-6 text-primary" />
              Live Stream Monitor
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Real streaming time remaining (Decart wall-clock) alongside wallet time — auto-refreshes every 5s
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Active Sessions</p>
            <p className="text-2xl font-bold text-foreground mt-1">{summary.totalActive}</p>
          </div>
          <div className={`rounded-xl border bg-card p-4 ${summary.orphanCount > 0 ? "border-red-500/40" : "border-border"}`}>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Ghost className="w-3 h-3" /> Orphans
            </p>
            <p className={`text-2xl font-bold mt-1 ${summary.orphanCount > 0 ? "text-red-400" : "text-foreground"}`}>
              {summary.orphanCount}
            </p>
          </div>
          <div className={`rounded-xl border bg-card p-4 ${summary.criticalCount > 0 ? "border-yellow-500/40" : "border-border"}`}>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Critical
            </p>
            <p className={`text-2xl font-bold mt-1 ${summary.criticalCount > 0 ? "text-yellow-400" : "text-foreground"}`}>
              {summary.criticalCount}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Total Real Stream Left</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">
              {(summary.totalRealStreamRemainingMinutes ?? 0).toFixed(1)}m
            </p>
          </div>
        </div>

        {/* Compression explanation banner */}
        {sessions.length > 0 && (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs text-blue-300 flex items-start gap-2">
            <Zap className="w-3.5 h-3.5 mt-0.5 shrink-0 text-blue-400" />
            <span>
              <strong className="text-blue-300">How compression works:</strong> Wallet time is what the license shows.
              Real stream time = wallet ÷ compression factor (billingRate ÷ 2.3).
              At 3 cr/s: factor = 1.304 → a 30-min key gives ~23 min of actual Decart streaming.
              Wallet drains faster than the clock so Decart is billed less.
            </span>
          </div>
        )}

        {/* Sessions grid */}
        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3" />
            Loading live sessions…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
            Failed to load live session data. Check that you are logged in as admin.
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <Activity className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No active streaming sessions</p>
            <p className="text-xs text-muted-foreground/60 mt-1">This view updates automatically every 5 seconds</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sessions.map(s => <SessionCard key={s.sessionId} s={s} />)}
          </div>
        )}

        {/* Footer */}
        {data?.queriedAt && (
          <p className="text-[10px] text-muted-foreground/50 text-right">
            Last fetched: {new Date(data.queriedAt).toLocaleTimeString()}
          </p>
        )}
      </div>
    </AdminLayout>
  );
}
