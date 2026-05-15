import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck, ShieldOff, Clock, Play, RefreshCw,
  CalendarDays, Timer, Zap, Key, AlertTriangle,
} from "lucide-react";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getLicenseKey } from "@/lib/auth";

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  return new Date(raw).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function maskKey(key: string): string {
  const parts = key.split("-");
  if (parts.length < 2) return key;
  return parts
    .map((p, i) => (i === 0 || i === parts.length - 1) ? p : "•".repeat(p.length))
    .join("-");
}

// ── stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color = "text-foreground", icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon: React.ElementType;
}) {
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-1"
      style={{ background: "hsl(222 40% 8%)", border: "1px solid hsl(222 40% 12%)" }}
    >
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase tracking-widest">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className={`text-2xl font-bold font-mono tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const licKey = getLicenseKey() ?? "";

  useEffect(() => {
    if (!licKey) setLocation("/");
  }, [licKey, setLocation]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{
    key: string;
    isActive: boolean;
    streamingEnabled: boolean;
    minutesAllocated: number;
    minutesUsed: number;
    minutesRemaining: number;
    remainingSeconds: number;
    usedSeconds: number;
    expiresAt: string | null;
    activatedAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
  }>({
    queryKey: ["license-status", licKey],
    queryFn: async () => {
      const res = await fetch("/api/license/status", {
        headers: { "X-License-Key": licKey },
      });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!licKey,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  // ── derived display values ────────────────────────────────────────────────

  const totalSecs    = (data?.minutesAllocated ?? 0) * 60;
  const remainSecs   = data?.remainingSeconds ?? 0;
  const usedSecs     = data?.usedSeconds ?? 0;
  const barPct       = totalSecs > 0 ? Math.max(0, Math.min(1, remainSecs / totalSecs)) : 0;
  const isActive     = data?.isActive ?? false;
  const streamOk     = data?.streamingEnabled ?? false;
  const isExpired    = !!data?.expiresAt && new Date(data.expiresAt) < new Date();
  const exhausted    = isActive && remainSecs <= 0;

  // colour for remaining bar / numbers
  const barColor =
    !isActive || isExpired ? "bg-red-500/60" :
    exhausted              ? "bg-red-500/60" :
    barPct <= 0.15         ? "bg-red-500"   :
    barPct <= 0.35         ? "bg-amber-400" :
                             "bg-emerald-400";

  const remainColor =
    !isActive || isExpired || exhausted ? "text-red-400" :
    barPct <= 0.15                      ? "text-red-400" :
    barPct <= 0.35                      ? "text-amber-400" :
                                          "text-emerald-400";

  // status label
  type StatusKey = "loading" | "error" | "disabled" | "expired" | "exhausted" | "active";
  const statusKey: StatusKey = isLoading
    ? "loading"
    : isError
    ? "error"
    : !isActive
    ? "disabled"
    : isExpired
    ? "expired"
    : exhausted
    ? "exhausted"
    : "active";

  const STATUS_META: Record<StatusKey, { label: string; color: string; icon: React.ElementType }> = {
    loading:   { label: "Loading…",    color: "bg-muted/40 text-muted-foreground",               icon: Clock },
    error:     { label: "Unavailable", color: "bg-red-500/20 text-red-400 border-red-500/30",    icon: AlertTriangle },
    disabled:  { label: "Disabled",    color: "bg-red-500/20 text-red-400 border-red-500/30",    icon: ShieldOff },
    expired:   { label: "Expired",     color: "bg-red-500/20 text-red-400 border-red-500/30",    icon: ShieldOff },
    exhausted: { label: "No Balance",  color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: AlertTriangle },
    active:    { label: "Active",      color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: ShieldCheck },
  };

  const status = STATUS_META[statusKey];
  const StatusIcon = status.icon;

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-6 max-w-3xl" data-testid="dashboard-page">

        {/* ── Header ── */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-wide">My License</h1>
            <p className="text-muted-foreground mt-1 text-sm">Real-time status of your streaming balance</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-muted-foreground"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* ── Status + key banner ── */}
        <div
          className="rounded-xl p-5 flex flex-wrap items-center justify-between gap-4"
          style={{ background: "hsl(222 40% 7%)", border: "1px solid hsl(222 40% 11%)" }}
        >
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isActive && !isExpired && !exhausted ? "bg-emerald-500/15" : "bg-red-500/15"}`}>
              <StatusIcon className={`w-5 h-5 ${isActive && !isExpired && !exhausted ? "text-emerald-400" : "text-red-400"}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-foreground">License Status</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${status.color}`}>
                  {status.label}
                </span>
              </div>
              {data?.key && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Key className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs font-mono text-muted-foreground tracking-widest">
                    {maskKey(data.key)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <Button
            size="sm"
            onClick={() => setLocation("/stream")}
            disabled={!isActive || isExpired || exhausted || !streamOk}
            style={
              isActive && !isExpired && !exhausted && streamOk
                ? { background: "linear-gradient(135deg, hsl(187 100% 42%) 0%, hsl(210 100% 48%) 100%)" }
                : {}
            }
          >
            <Play className="w-4 h-4 mr-2" />
            Stream Now
          </Button>
        </div>

        {/* ── Big remaining-time gauge ── */}
        <div
          className="rounded-xl p-6 space-y-4"
          style={{ background: "hsl(222 40% 7%)", border: "1px solid hsl(222 40% 11%)" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Streaming Balance</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {totalSecs > 0 ? `${(barPct * 100).toFixed(1)}% remaining` : "No time allocated"}
            </span>
          </div>

          {/* Big number */}
          <div className="flex items-end gap-3">
            <span className={`text-5xl font-black font-mono tabular-nums leading-none ${isLoading ? "text-muted-foreground" : remainColor}`}>
              {isLoading ? "—" : fmt(remainSecs)}
            </span>
            <span className="text-muted-foreground text-sm mb-1">
              of {isLoading ? "—" : fmt(totalSecs)} allocated
            </span>
          </div>

          {/* Progress bar */}
          <div className="relative h-3 rounded-full overflow-hidden bg-muted/30">
            <div
              className={`h-full rounded-full transition-all duration-700 ${barColor}`}
              style={{ width: `${barPct * 100}%` }}
            />
          </div>

          {exhausted && (
            <p className="text-amber-400 text-xs flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Balance exhausted — contact admin to top up your minutes.
            </p>
          )}
        </div>

        {/* ── 3-column stats ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Allocated"
            value={isLoading ? "—" : `${data?.minutesAllocated ?? 0} min`}
            sub={`${fmt(totalSecs)} total`}
            icon={Zap}
          />
          <StatCard
            label="Used"
            value={isLoading ? "—" : `${(usedSecs / 60).toFixed(1)} min`}
            sub={`${fmt(usedSecs)} streamed`}
            color="text-amber-400"
            icon={Clock}
          />
          <StatCard
            label="Remaining"
            value={isLoading ? "—" : `${(remainSecs / 60).toFixed(1)} min`}
            sub={`${fmt(remainSecs)} left`}
            color={remainColor}
            icon={Timer}
          />
        </div>

        {/* ── License info ── */}
        <div
          className="rounded-xl p-5 space-y-3"
          style={{ background: "hsl(222 40% 7%)", border: "1px solid hsl(222 40% 11%)" }}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            License Details
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">Activated</p>
              <p className="font-mono text-foreground">{fmtDate(data?.activatedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">Expires</p>
              <p className={`font-mono ${isExpired ? "text-red-400" : "text-foreground"}`}>
                {data?.expiresAt ? fmtDate(data.expiresAt) : "Never"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">Last Used</p>
              <p className="font-mono text-foreground">{fmtDate(data?.lastUsedAt)}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            <Badge
              variant="outline"
              className={streamOk ? "border-emerald-500/40 text-emerald-400" : "border-red-500/40 text-red-400"}
            >
              {streamOk ? "Streaming enabled" : "Streaming disabled"}
            </Badge>
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
