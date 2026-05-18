import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import {
  useGetAdminDashboard,
  getGetAdminDashboardQueryKey,
  useAdminListUsers,
  getAdminListUsersQueryKey,
  useGetAdminRevenueChart,
  getGetAdminRevenueChartQueryKey,
} from "@workspace/api-client-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { AdminLayout } from "@/components/admin-layout";
import { Users, Activity, DollarSign, TrendingUp, UserPlus, Clock, BarChart2, Radio, ShieldCheck, ShieldAlert, RefreshCw, ExternalLink, Zap, Film, CreditCard, PencilLine, Check, X, Key, FileKey } from "lucide-react";

interface LiveSession {
  id: string;
  userId: number;
  username: string;
  email: string;
  style: string;
  startedAt: string;
}

interface DecartStatus { ok: boolean; error?: string; checkedAt: string }
interface TierBreakdown {
  label: string;
  minutes: number;
  sessionCount: number;
  minutesStreamed: number;
  revenueUsdt: number;
  purchaseCount: number;
}
interface DecartUsage {
  totalMinutesStreamed: number;
  totalSessionsAllTime: number;
  sessionsLast24h: number;
  tierBreakdown: TierBreakdown[];
  tierPerformanceResetAt: string | null;
}

function useDecartStatus() {
  const [status, setStatus] = useState<DecartStatus | null>(null);
    const [billingRate, setBillingRate] = useState(5);
    useEffect(() => {
      const t = localStorage.getItem("fullswap_admin_token") ?? localStorage.getItem("fullswap_token") ?? "";
      fetch("/api/admin/billing-rate", { headers: { Authorization: `Bearer ${t}` } })
        .then(r => r.ok ? r.json() : { rate: 5 })
        .then(d => setBillingRate(d.rate ?? 5))
        .catch(() => {});
    }, []);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    setLoading(true);
    try {
      const res = await fetch("/api/admin/decart-status", { headers: { Authorization: `Bearer ${token}` } });
      const data: DecartStatus = await res.json();
      setStatus(data);
    } catch {
      setStatus({ ok: false, error: "Could not reach the server", checkedAt: new Date().toISOString() });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, []);

  return { status, loading, check };
}

function useDecartUsage() {
  const [usage, setUsage] = useState<DecartUsage | null>(null);
  const [resetting, setResetting] = useState(false);

  const fetch_ = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    try {
      const res = await fetch("/api/admin/decart-usage", { headers: { Authorization: `Bearer ${token}` } });
      const data: DecartUsage = await res.json();
      setUsage(data);
    } catch { /* silent */ }
  };

  const resetTiers = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    setResetting(true);
    try {
      const res = await fetch("/api/admin/decart-usage/reset", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) console.error("[resetTiers] reset failed:", res.status);
    } catch (err) {
      console.error("[resetTiers] network error:", err);
    }
    // Always re-fetch after reset attempt so stats are current
    try { await fetch_(); } catch { /* silent */ }
    setResetting(false);
  };

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 30000);
    return () => clearInterval(id);
  }, []);

  return { usage, resetTiers, resetting };
}

interface DecartCreditState {
  base: number | null;
  setAt: string | null;
  consumedSeconds: number;
  activeSessions: number;
  estimatedRemaining: number | null;
  hourlyRateCredits: number;
  daysRemaining: number | null;
}

function useAdminCreditsReset(refetchDashboard: () => void) {
  const [resetting, setResetting] = useState(false);

  const resetCredits = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    setResetting(true);
    try {
      await fetch("/api/admin/credits/reset", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      refetchDashboard();
    } catch { /* silent */ } finally {
      setResetting(false);
    }
  };

  return { resetCredits, resetting };
}

function useDecartCredits() {
  const [state, setState] = useState<DecartCreditState>({
    base: null, setAt: null, consumedSeconds: 0, activeSessions: 0, estimatedRemaining: null,
    hourlyRateCredits: 0, daysRemaining: null,
  });
  // Live tick: extra seconds elapsed since last API poll (for smooth countdown)
  const [tickExtra, setTickExtra] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  const activeRef = useRef(0);

  const load = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    try {
      const res = await fetch("/api/admin/decart-credits", { headers: { Authorization: `Bearer ${token}` } });
      const data: DecartCreditState & { credits: number | null } = await res.json();
      setState({
        base: data.credits,
        setAt: data.setAt,
        consumedSeconds: data.consumedSeconds,
        activeSessions: data.activeSessions,
        estimatedRemaining: data.estimatedRemaining,
        hourlyRateCredits: (data as any).hourlyRateCredits ?? 0,
        daysRemaining: (data as any).daysRemaining ?? null,
      });
      activeRef.current = data.activeSessions;
      setTickExtra(0); // reset live tick on each poll
    } catch { /* silent */ }
  };

  const save = async (value: number) => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/decart-credits", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ credits: value }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      setState({
        base: data.credits,
        setAt: data.setAt,
        consumedSeconds: 0,
        activeSessions: data.activeSessions ?? 0,
        estimatedRemaining: data.credits,
        hourlyRateCredits: (data as any).hourlyRateCredits ?? 0,
        daysRemaining: (data as any).daysRemaining ?? null,
      });
      activeRef.current = data.activeSessions ?? 0;
      setTickExtra(0);
    } catch {
      setError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 5000);
    // Tick every second: decrement by active session count × 5 (5 credits/sec/stream)
    tickRef.current = setInterval(() => {
      if (activeRef.current > 0) {
        setTickExtra(prev => prev + activeRef.current * 5);
      }
    }, 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const liveRemaining = state.estimatedRemaining !== null
    ? Math.max(0, state.estimatedRemaining - tickExtra)
    : null;

  return {
    credits: state.base,
    liveRemaining,
    consumedSeconds: state.consumedSeconds + tickExtra,
    activeSessions: state.activeSessions,
    hourlyRateCredits: state.hourlyRateCredits,
    daysRemaining: state.daysRemaining,
    saving, error, save, reload: load,
  };
}

function useDecartCredentials() {
  const [data, setData] = useState<{
    apiKeyConfigured: boolean;
    apiKeyMasked: string | null;
    secretKeyConfigured: boolean;
    secretKeyMasked: string | null;
    source: string;
    updatedAt: string | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    try {
      const res = await fetch("/api/admin/decart-credentials", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setData(data);
      } else {
        console.warn("[decart-credentials] load failed:", res.status, res.statusText);
      }
    } catch (e) {
      console.warn("[decart-credentials] network error:", e);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (apiKey: string, secretKey: string) => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/decart-credentials", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey || undefined, secretKey: secretKey || undefined }),
      });
      if (res.ok) {
        setSaveOk(true);
        await load();
        setTimeout(() => setSaveOk(false), 3000);
      } else {
        let error = "Failed to save credentials";
        try {
          const d = await res.json();
          error = d.error ?? error;
        } catch {
          error = `Server error: ${res.status} ${res.statusText}`;
        }
        setSaveError(error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      setSaveError(msg);
      console.error("[decart-credentials]", msg, e);
    } finally {
      setSaving(false);
    }
  };

  return { data, saving, saveOk, saveError, save, reload: load };
}


function useActiveSessions() {
  const [count, setCount] = useState<number | null>(null);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [elapsed, setElapsed] = useState<Record<string, number>>({});
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const tickRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSessions = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    try {
      const res = await fetch("/api/admin/active-sessions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setCount(data.count);
      setSessions(data.sessions);
      const now = Date.now();
      setElapsed(prev => {
        const next: Record<string, number> = {};
        for (const s of data.sessions as LiveSession[]) {
          next[s.id] = prev[s.id] ?? Math.floor((now - new Date(s.startedAt).getTime()) / 1000);
        }
        return next;
      });
    } catch { }
  };

  useEffect(() => {
    fetchSessions();
    intervalRef.current = setInterval(fetchSessions, 5000);
    tickRef.current = setInterval(() => {
      setElapsed(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v + 1])));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  return { count, sessions, elapsed };
}

function fmtSecs(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

function fmt(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  const s = Math.round((minutes % 1) * 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function UsageBar({ used, purchased, freeSecs }: { used: number; purchased: number; freeSecs: number }) {
  const totalMins = purchased + freeSecs / 60;
  const pct = totalMins > 0 ? Math.min(100, (used / totalMins) * 100) : 0;
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-primary";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[60px]">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{pct.toFixed(0)}%</span>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="font-semibold text-primary">{payload[0]?.value?.toFixed(2)} USDT</p>
      <p className="text-muted-foreground">{payload[0]?.payload?.payments} payment{payload[0]?.payload?.payments !== 1 ? "s" : ""}</p>
    </div>
  );
}

function shortDate(iso: string) {
  const [, m, d] = iso.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

export default function AdminDashboardPage() {
  const [, setLocation] = useLocation();
  const dashboard = useGetAdminDashboard({ query: { queryKey: getGetAdminDashboardQueryKey() } });
  const users = useAdminListUsers({ query: { queryKey: getAdminListUsersQueryKey(), refetchInterval: 15000 } });
  const live = useActiveSessions();
  const decart = useDecartStatus();
  const { usage: decartUsage, resetTiers, resetting: tierResetting } = useDecartUsage();
  const { resetCredits, resetting: creditsResetting } = useAdminCreditsReset(() => dashboard.refetch());
  const decartCredits = useDecartCredits();
  const [creditInput, setCreditInput] = useState<string>("");
  const [editingCredits, setEditingCredits] = useState(false);
  const decartCreds = useDecartCredentials();
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [secretKeyInput, setSecretKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [editingApiCreds, setEditingApiCreds] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("fullswap_admin_token")) {
      setLocation("/admin");
    }
  }, [setLocation]);

  const data = dashboard.data;

  const stats = [
    { label: "Generated License Keys", value: data?.totalUsers ?? 0, icon: FileKey, color: "text-blue-400" },
    { label: "Active Members", value: data?.activeUsers ?? 0, icon: Activity, color: "text-green-400" },
    { label: "Total Revenue", value: `${data?.totalRevenue?.toFixed(2) ?? "0.00"} USDT`, icon: DollarSign, color: "text-amber-400" },
    { label: "Revenue Today", value: `${data?.revenueToday?.toFixed(2) ?? "0.00"} USDT`, icon: TrendingUp, color: "text-green-400" },
    { label: "Licensed Keys Activated Today", value: (data as any)?.keysActivatedToday ?? data?.newUsersToday ?? 0, icon: Key, color: "text-purple-400" },
    { label: "Admin Credits", value: `${(data as any)?.totalCreditedMinutes ?? 0} min`, icon: CreditCard, color: "text-teal-400", sub: `${(data as any)?.totalCreditedUsdt?.toFixed(2) ?? "0.00"} USDT equiv.` },
  ];

  const revenueChart = useGetAdminRevenueChart({ query: { queryKey: getGetAdminRevenueChartQueryKey(), refetchInterval: 60000 } });
  const chartData = (revenueChart.data ?? []).map((d: any) => ({ ...d, label: shortDate(d.date) }));
  const totalChart = chartData.reduce((s: number, d: any) => s + d.usdt, 0);
  const hasRevenue = chartData.some((d: any) => d.usdt > 0);
  const sortedUsers = [...(users.data ?? [])].sort((a, b) => b.totalMinutesUsed - a.totalMinutesUsed);

  const isLive = (live.count ?? 0) > 0;

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-6" data-testid="admin-dashboard-page">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">Platform overview</p>
        </div>

        {/* ── Decart LUCY 2.1 Monitor ── */}
        <div className={`rounded-xl border transition-all ${
          decart.status === null
            ? "bg-card border-border"
            : decart.status.ok
              ? "bg-green-950/20 border-green-500/30"
              : "bg-red-950/30 border-red-500/40 shadow-[0_0_24px_hsl(0_72%_51%/0.1)]"
        }`}>
          {/* Header row */}
          <div className="flex items-center justify-between gap-4 px-5 pt-4 pb-3 border-b border-border/50">
            <div className="flex items-center gap-3 min-w-0">
              {decart.status === null ? (
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
                </div>
              ) : decart.status.ok ? (
                <div className="w-8 h-8 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4 text-green-400" />
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-4 h-4 text-red-400" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Decart LUCY 2.1 Monitor</p>
                {decart.status === null ? (
                  <p className="text-xs text-muted-foreground">Checking API key…</p>
                ) : decart.status.ok ? (
                  <p className="text-xs text-green-400">API Key Operational — checked {new Date(decart.status.checkedAt).toLocaleTimeString()}</p>
                ) : (
                  <p className="text-xs text-red-400 truncate">⚠ {decart.status.error}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => decart.check()}
                disabled={decart.loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer"
                style={{ background: "hsl(222 44% 7%)", borderColor: "hsl(222 40% 14%)", color: "hsl(var(--muted-foreground))" }}
              >
                <RefreshCw className={`w-3 h-3 ${decart.loading ? "animate-spin" : ""}`} />
                Test Key
              </button>
              <a
                href="https://platform.decart.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer hover:border-primary/40"
                style={{ background: "hsl(222 44% 7%)", borderColor: "hsl(222 40% 14%)", color: "hsl(var(--muted-foreground))" }}
              >
                <ExternalLink className="w-3 h-3" />
                Decart Dashboard
              </a>
            </div>
          </div>

          {/* Overall usage stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/50 px-1 py-1">
            <div className="flex flex-col items-center gap-1 px-4 py-3">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Film className="w-3.5 h-3.5" />
                <span className="text-xs">Minutes Streamed</span>
              </div>
              <p className="text-xl font-bold text-foreground">
                {decartUsage ? decartUsage.totalMinutesStreamed.toLocaleString() : "—"}
              </p>
              <p className="text-xs text-muted-foreground">all time via LUCY 2.1</p>
            </div>
            <div className="flex flex-col items-center gap-1 px-4 py-3">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Zap className="w-3.5 h-3.5" />
                <span className="text-xs">Sessions Today</span>
              </div>
              <p className="text-xl font-bold text-foreground">
                {decartUsage ? decartUsage.sessionsLast24h.toLocaleString() : "—"}
              </p>
              <p className="text-xs text-muted-foreground">last 24 hours</p>
            </div>
            <div className="flex flex-col items-center gap-1 px-4 py-3">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <BarChart2 className="w-3.5 h-3.5" />
                <span className="text-xs">Total Sessions</span>
              </div>
              <p className="text-xl font-bold text-foreground">
                {decartUsage ? decartUsage.totalSessionsAllTime.toLocaleString() : "—"}
              </p>
              <p className="text-xs text-muted-foreground">all time</p>
            </div>
          </div>

          {/* Tier breakdown */}
          <div className="border-t border-border/50 px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Package Tier Performance</p>
                {decartUsage?.tierPerformanceResetAt && (
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    Since {new Date(decartUsage.tierPerformanceResetAt).toLocaleString()}
                  </p>
                )}
              </div>
              <button
                onClick={() => { if (!tierResetting && window.confirm("Reset tier performance stats? Historical data is preserved — only the view resets from now.")) resetTiers(); }}
                disabled={tierResetting}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }}
                title="Reset tier performance view from now (data is not deleted)"
              >
                <RefreshCw className={`w-3 h-3 ${tierResetting ? "animate-spin" : ""}`} />
                {tierResetting ? "Resetting…" : "Reset"}
              </button>
            </div>
            {decartUsage?.tierBreakdown?.length ? (
              <div className="space-y-4">
                {(() => {
                  const totalSessions = decartUsage.tierBreakdown.reduce((s, t) => s + t.sessionCount, 0);
                  const totalRevenue  = decartUsage.tierBreakdown.reduce((s, t) => s + (t.revenueUsdt ?? 0), 0);
                  const totalMinStr   = decartUsage.tierBreakdown.reduce((s, t) => s + t.minutesStreamed, 0);
                  const tierColors = ["hsl(217 91% 60%)", "hsl(142 71% 45%)", "hsl(38 92% 55%)", "hsl(280 80% 60%)"];
                  return decartUsage.tierBreakdown.map((tier, i) => {
                    const sessionPct = totalSessions > 0 ? (tier.sessionCount / totalSessions) * 100 : 0;
                    const revPct     = totalRevenue  > 0 ? ((tier.revenueUsdt ?? 0) / totalRevenue) * 100 : 0;
                    const minPct     = totalMinStr   > 0 ? (tier.minutesStreamed / totalMinStr) * 100 : 0;
                    const color = tierColors[i % tierColors.length];
                    return (
                      <div key={tier.label} className="rounded-lg border border-border/40 bg-background/30 p-3">
                        {/* Header row */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                            <span className="text-sm font-semibold text-foreground">{tier.label}</span>
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{tier.minutes} min</span>
                          </div>
                          <span className="text-xs font-mono font-bold text-foreground">
                            ${(tier.revenueUsdt ?? 0).toFixed(2)} USDT
                          </span>
                        </div>

                        {/* Revenue bar */}
                        <div className="mb-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-0.5">
                            <span>Revenue</span>
                            <span>{tier.purchaseCount ?? 0} purchase{tier.purchaseCount !== 1 ? "s" : ""} · {revPct.toFixed(0)}% of total</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${revPct}%`, background: color }} />
                          </div>
                        </div>

                        {/* Sessions bar */}
                        <div className="mb-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-0.5">
                            <span>Sessions streamed</span>
                            <span>{tier.sessionCount} session{tier.sessionCount !== 1 ? "s" : ""} · {sessionPct.toFixed(0)}% of total</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500 opacity-70" style={{ width: `${sessionPct}%`, background: color }} />
                          </div>
                        </div>

                        {/* Minutes streamed bar */}
                        <div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-0.5">
                            <span>Minutes streamed</span>
                            <span>{tier.minutesStreamed} min · {minPct.toFixed(0)}% of total</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500 opacity-50" style={{ width: `${minPct}%`, background: color }} />
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No sessions recorded yet. Tier usage will appear here once users start streaming.</p>
            )}
          </div>

          {/* Note */}
          <div className="px-5 pb-3">
            <p className="text-xs text-muted-foreground/60">
              Decart does not expose a public credits API. Use these figures as a guide and check exact credit balance on the Decart dashboard.
            </p>
          </div>
        </div>

        {/* ── Decart Credit Left ── */}
        {(() => {
          const live = decartCredits.liveRemaining;
          const isZero = live !== null && live === 0;
          const isLow = live !== null && live > 0 && live < 60;
          const isOk = live !== null && live >= 60;
          const draining = decartCredits.activeSessions > 0;
          return (
            <div className={`border rounded-xl overflow-hidden transition-all ${
              isZero ? "bg-red-950/20 border-red-500/40" :
              isLow  ? "bg-amber-950/20 border-amber-500/30" :
              draining ? "bg-primary/5 border-primary/30" :
              "bg-card border-border"
            }`}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    isZero ? "bg-red-500/15" : isLow ? "bg-amber-500/15" : "bg-primary/10"
                  }`}>
                    <CreditCard className={`w-4 h-4 ${isZero ? "text-red-400" : isLow ? "text-amber-400" : "text-primary"}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Decart LUCY 2.1 Credits</p>
                    <p className="text-xs text-muted-foreground">
                      {draining
                        ? `Live — draining at ${decartCredits.activeSessions * 5} credits/sec (${decartCredits.activeSessions} active stream${decartCredits.activeSessions !== 1 ? "s" : ""} × 5)`
                        : "Auto-tracked as streams run"}
                    </p>
                  </div>
                </div>
                {!editingCredits && (
                  <button
                    onClick={() => { setCreditInput(decartCredits.credits !== null ? String(decartCredits.credits) : ""); setEditingCredits(true); }}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
                  >
                    <PencilLine className="w-3.5 h-3.5" />
                    Set Balance
                  </button>
                )}
              </div>

              {/* Body */}
              <div className="px-5 py-6">
                {editingCredits ? (
                  <div className="flex flex-col gap-3">
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Enter current credit balance from Decart</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={creditInput}
                        onChange={e => setCreditInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            const v = parseFloat(creditInput);
                            if (!isNaN(v) && v >= 0) { decartCredits.save(v); setEditingCredits(false); }
                          }
                          if (e.key === "Escape") setEditingCredits(false);
                        }}
                        placeholder="e.g. 3600"
                        autoFocus
                        className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <button
                        disabled={decartCredits.saving || creditInput === ""}
                        onClick={() => {
                          const v = parseFloat(creditInput);
                          if (!isNaN(v) && v >= 0) { decartCredits.save(v); setEditingCredits(false); }
                        }}
                        className="flex items-center gap-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        <Check className="w-4 h-4" />
                        Save
                      </button>
                      <button
                        onClick={() => setEditingCredits(false)}
                        className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted text-muted-foreground text-sm hover:bg-muted/80 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {decartCredits.error && <p className="text-xs text-red-400">{decartCredits.error}</p>}
                    <p className="text-xs text-muted-foreground">Check your balance at <span className="underline cursor-pointer" onClick={() => window.open("https://platform.decart.ai/", "_blank")}>platform.decart.ai</span>, then enter it here. The system will auto-decrement as streams run.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Big number */}
                    <div className="flex items-end gap-4">
                      <div>
                        <p className={`text-5xl font-bold tabular-nums leading-none transition-all ${
                          isZero ? "text-red-400" : isLow ? "text-amber-400" : "text-foreground"
                        }`}>
                          {live !== null ? Math.floor(live).toLocaleString() : "—"}
                        </p>
                        <p className="text-sm text-muted-foreground mt-2">credits remaining on Decart LUCY 2.1</p>
                      </div>
                      {live !== null && (
                        <div className={`mb-1 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                          isZero ? "bg-red-500/10 text-red-400 border-red-500/30" :
                          isLow  ? "bg-amber-500/10 text-amber-400 border-amber-500/30" :
                          isOk   ? "bg-green-500/10 text-green-400 border-green-500/30" :
                          "bg-muted text-muted-foreground border-border"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${draining ? "animate-pulse" : ""} ${
                            isZero ? "bg-red-400" : isLow ? "bg-amber-400" : "bg-green-400"
                          }`} />
                          {isZero ? "Out of credits" : isLow ? "Low — top up soon" : draining ? "Draining…" : "Sufficient"}
                        </div>
                      )}
                    </div>

                    {/* Consumed stats */}
                    {decartCredits.credits !== null && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-background/60 rounded-lg px-3 py-2.5 border border-border/50">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Consumed</p>
                          <p className="text-lg font-bold tabular-nums text-foreground">{Math.floor(decartCredits.consumedSeconds).toLocaleString()}</p>
                          <p className="text-[10px] text-muted-foreground">credits since reset</p>
                        </div>
                        <div className="bg-background/60 rounded-lg px-3 py-2.5 border border-border/50">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Base Set</p>
                          <p className="text-lg font-bold tabular-nums text-foreground">{Math.floor(decartCredits.credits).toLocaleString()}</p>
                          <p className="text-[10px] text-muted-foreground">when last updated</p>
                        </div>
                        <div className="bg-background/60 rounded-lg px-3 py-2.5 border border-border/50">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Hourly Burn Rate</p>
                          <p className="text-lg font-bold tabular-nums text-foreground">
                            {decartCredits.hourlyRateCredits > 0
                              ? Math.round(decartCredits.hourlyRateCredits).toLocaleString()
                              : "—"}
                          </p>
                          <p className="text-[10px] text-muted-foreground">credits / hr (7-day avg)</p>
                        </div>
                        <div className={`rounded-lg px-3 py-2.5 border ${
                          decartCredits.daysRemaining !== null && decartCredits.daysRemaining < 3
                            ? "bg-red-500/10 border-red-500/30"
                            : decartCredits.daysRemaining !== null && decartCredits.daysRemaining < 7
                              ? "bg-amber-500/10 border-amber-500/30"
                              : "bg-background/60 border-border/50"
                        }`}>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Est. Days Left</p>
                          <p className={`text-lg font-bold tabular-nums ${
                            decartCredits.daysRemaining !== null && decartCredits.daysRemaining < 3
                              ? "text-red-400"
                              : decartCredits.daysRemaining !== null && decartCredits.daysRemaining < 7
                                ? "text-amber-400"
                                : "text-foreground"
                          }`}>
                            {decartCredits.daysRemaining !== null && decartCredits.hourlyRateCredits > 0
                              ? decartCredits.daysRemaining.toFixed(1)
                              : "—"}
                          </p>
                          <p className="text-[10px] text-muted-foreground">at current burn rate</p>
                        </div>
                      </div>
                    )}

                    {/* Progress bar */}
                    {decartCredits.credits !== null && decartCredits.credits > 0 && live !== null && (
                      <div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                          <span>{Math.floor(decartCredits.consumedSeconds).toLocaleString()} consumed</span>
                          <span>{Math.round((live / decartCredits.credits) * 100)}% remaining</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-1000 ${
                              isZero ? "bg-red-500" : isLow ? "bg-amber-400" : "bg-primary"
                            }`}
                            style={{ width: `${Math.max(0, Math.min(100, (live / decartCredits.credits) * 100))}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="px-5 pb-4">
                <p className="text-xs text-muted-foreground/60">
                  Decart does not expose a balance API. Check <span className="underline underline-offset-2 cursor-pointer" onClick={() => window.open("https://platform.decart.ai/", "_blank")}>platform.decart.ai</span> and enter your balance — the system tracks consumption automatically at {billingRate} credits/sec per active stream.
                </p>
              </div>
            </div>
          );
        })()}

        {/* ── Decart API Credentials ── */}
        <div className="rounded-xl border bg-card border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <Zap className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-foreground text-sm">Decart Lucy 2.1 API Credentials</h2>
              {decartCreds.data && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  decartCreds.data.source === "database"
                    ? "bg-primary/10 text-primary border-primary/25"
                    : decartCreds.data.source === "environment"
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
                    : "bg-red-500/10 text-red-400 border-red-500/25"
                }`}>
                  {decartCreds.data.source === "database" ? "DB override" : decartCreds.data.source === "environment" ? "env var" : "not set"}
                </span>
              )}
            </div>
            {!editingApiCreds ? (
              <button
                type="button"
                onClick={() => { setApiKeyInput(""); setSecretKeyInput(""); setShowApiKey(false); setShowSecretKey(false); setEditingApiCreds(true); }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <PencilLine className="w-3.5 h-3.5" />
                Update Keys
              </button>
            ) : (
              <button type="button" onClick={() => setEditingApiCreds(false)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
            )}
          </div>

          {!editingApiCreds && decartCreds.data && (
            <div className="space-y-2 mb-3">
              {[
                { label: "API Key", masked: decartCreds.data.apiKeyMasked, configured: decartCreds.data.apiKeyConfigured },
                { label: "Secret Key", masked: decartCreds.data.secretKeyMasked, configured: decartCreds.data.secretKeyConfigured },
              ].map(({ label, masked, configured }) => (
                <div key={label} className="flex items-center justify-between px-3 py-2 rounded-lg bg-background/60 border border-border/50">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    {configured ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">✓ Set</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">Not configured</span>
                    )}
                  </div>
                  <span className="text-xs font-mono text-foreground">{masked ?? "—"}</span>
                </div>
              ))}
              {decartCreds.data.updatedAt && (
                <p className="text-[10px] text-muted-foreground/60 pl-1">
                  Last updated: {new Date(decartCreds.data.updatedAt).toLocaleString()}
                </p>
              )}
              {decartCreds.saveOk && (
                <div className="flex items-center gap-1.5 text-xs text-primary mt-1">
                  <Check className="w-3.5 h-3.5" />
                  Credentials updated — live streams will use the new keys immediately.
                </div>
              )}
            </div>
          )}

          {editingApiCreds && (
            <div className="space-y-3">
              {[
                { label: "API Key", value: apiKeyInput, set: setApiKeyInput, show: showApiKey, toggleShow: () => setShowApiKey(v => !v), placeholder: decartCreds.data?.apiKeyMasked ?? "Paste new API Key…" },
                { label: "Secret Key", value: secretKeyInput, set: setSecretKeyInput, show: showSecretKey, toggleShow: () => setShowSecretKey(v => !v), placeholder: decartCreds.data?.secretKeyMasked ?? "Paste new Secret Key…" },
              ].map(({ label, value, set, show, toggleShow, placeholder }) => (
                <div key={label} className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</label>
                  <div className="relative">
                    <input
                      type={show ? "text" : "password"}
                      placeholder={placeholder}
                      value={value}
                      onChange={e => set(e.target.value)}
                      className="w-full h-10 px-3 pr-10 rounded-lg text-sm font-mono bg-background border border-border text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors"
                    />
                    <button type="button" tabIndex={-1} onClick={toggleShow} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {show ? <X className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              ))}

              {decartCreds.saveError && <p className="text-xs text-red-400">{decartCreds.saveError}</p>}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  disabled={decartCreds.saving || (!apiKeyInput.trim() && !secretKeyInput.trim())}
                  onClick={async () => {
                    await decartCreds.save(apiKeyInput, secretKeyInput);
                    if (!decartCreds.saveError) setEditingApiCreds(false);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-primary text-black hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {decartCreds.saving ? "Saving…" : decartCreds.saveOk ? <><Check className="w-3.5 h-3.5" /> Saved!</> : "Save Credentials"}
                </button>
                <p className="text-[10px] text-muted-foreground/60">Stored in database — no server restart needed.</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Live Active Sessions Counter ── */}
        <div
          data-testid="live-sessions-card"
          className={`rounded-xl border p-5 transition-all ${isLive
            ? "bg-green-950/30 border-green-500/40 shadow-[0_0_24px_hsl(142_71%_45%/0.1)]"
            : "bg-card border-border"
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              {isLive ? (
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-400" />
                </span>
              ) : (
                <Radio className="w-4 h-4 text-muted-foreground" />
              )}
              <h2 className="font-semibold text-foreground text-sm">Live Active Sessions</h2>
              <span className="text-xs text-muted-foreground">— refreshes every 5s</span>
            </div>
            <div className="font-mono text-3xl font-bold tabular-nums" style={{ color: isLive ? "hsl(142 71% 45%)" : "hsl(var(--muted-foreground))" }}>
              {live.count ?? "—"}
            </div>
          </div>

          {isLive ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-green-500/20">
                    <th className="text-left pb-2 text-xs text-green-400/70 font-medium">User</th>
                    <th className="text-left pb-2 text-xs text-green-400/70 font-medium">Style</th>
                    <th className="text-left pb-2 text-xs text-green-400/70 font-medium">Running</th>
                    <th className="text-left pb-2 text-xs text-green-400/70 font-medium">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {live.sessions.map(s => (
                    <tr key={s.id} className="border-b border-green-500/10 last:border-0">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-foreground">{s.username}</p>
                        <p className="text-xs text-muted-foreground">{s.email}</p>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium capitalize">
                          {s.style}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-green-400 font-semibold text-sm tabular-nums">
                        {live.elapsed[s.id] !== undefined ? fmtSecs(live.elapsed[s.id]) : "—"}
                      </td>
                      <td className="py-2.5 text-xs text-muted-foreground">
                        {new Date(s.startedAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {live.count === null ? "Loading..." : "No users are streaming right now."}
            </p>
          )}
        </div>

        {/* ── Stats Grid (5 cards, no "Active Sessions" since it's now live above) ── */}
        {dashboard.isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(5)].map((_, i) => <div key={i} className="h-28 bg-card rounded-lg animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {stats.map(({ label, value, icon: Icon, color, ...rest }) => (
              <div key={label} data-testid={`stat-${label.toLowerCase().replace(/ /g, "-")}`} className="bg-card border border-border rounded-lg p-5">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-3">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="flex-1">{label}</span>
                  {label === "Admin Credits" && (
                    <button
                      onClick={() => {
                        if (!creditsResetting && window.confirm("Reset admin credits display? Historical invoice data is preserved — the counter will restart from now.")) {
                          resetCredits();
                        }
                      }}
                      disabled={creditsResetting}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }}
                      title="Reset credit totals from now (data is not deleted)"
                    >
                      <RefreshCw className={`w-3 h-3 ${creditsResetting ? "animate-spin" : ""}`} />
                      {creditsResetting ? "Resetting…" : "Reset"}
                    </button>
                  )}
                </div>
                <div className="text-3xl font-bold text-foreground font-mono">{value}</div>
                {(rest as any).sub && (
                  <p className="text-xs text-muted-foreground mt-1">{(rest as any).sub}</p>
                )}
                {label === "Admin Credits" && (data as any)?.creditStatsResetAt && (
                  <p className="text-[10px] text-muted-foreground/60 mt-1.5">
                    Since {new Date((data as any).creditStatsResetAt).toLocaleString()}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Revenue Chart */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-foreground">USDT Revenue — Last 30 Days</h2>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">30-day total</p>
              <p className="font-mono font-bold text-primary text-sm">{totalChart.toFixed(2)} USDT</p>
            </div>
          </div>

          {revenueChart.isLoading ? (
            <div className="h-52 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !hasRevenue ? (
            <div className="h-52 flex flex-col items-center justify-center gap-2">
              <BarChart2 className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">No payments recorded yet</p>
              <p className="text-muted-foreground/60 text-xs">Revenue will appear here once users make purchases</p>
            </div>
          ) : (
            <div className="px-2 pt-4 pb-2 h-60">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(187 100% 52%)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="hsl(187 100% 52%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval={4}
                  />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `$${v}`}
                    width={40}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "hsl(187 100% 52% / 0.3)", strokeWidth: 1 }} />
                  <Area
                    type="monotone"
                    dataKey="usdt"
                    stroke="hsl(187 100% 52%)"
                    strokeWidth={2}
                    fill="url(#revenueGrad)"
                    dot={false}
                    activeDot={{ r: 4, fill: "hsl(187 100% 52%)", stroke: "hsl(var(--background))", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Usage Monitor */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
            <Clock className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-foreground">User Usage Monitor</h2>
            <span className="ml-auto text-xs text-muted-foreground">Auto-refreshes every 15s</span>
          </div>
          {users.isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}
            </div>
          ) : sortedUsers.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No users yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-background/50">
                    <th className="text-left p-4 text-muted-foreground font-medium">User</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Status</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Used</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Purchased</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Free Remaining</th>
                    <th className="text-left p-4 text-muted-foreground font-medium w-40">Usage</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Last Session</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map((user) => {
                    const freeMinsLeft = (user.freeSecondsRemaining ?? 0) / 60;
                    const totalBudget = user.totalMinutesPurchased + freeMinsLeft;
                    const membershipColors: Record<string, string> = {
                      active: "bg-green-500/20 text-green-400",
                      free_trial: "bg-primary/20 text-primary",
                      suspended: "bg-red-500/20 text-red-400",
                    };
                    return (
                      <tr key={user.id} data-testid={`usage-row-${user.id}`} className="border-b border-border last:border-0 hover:bg-accent/5">
                        <td className="p-4">
                          <p className="font-medium text-foreground">{user.username}</p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${membershipColors[user.membership] ?? "bg-muted text-muted-foreground"}`}>
                            {user.membership.replace("_", " ")}
                          </span>
                        </td>
                        <td className="p-4 font-mono text-foreground font-medium">
                          {fmt(user.totalMinutesUsed)}
                        </td>
                        <td className="p-4 font-mono text-muted-foreground">
                          {fmt(user.totalMinutesPurchased)}
                        </td>
                        <td className="p-4 font-mono text-muted-foreground">
                          {freeMinsLeft > 0 ? fmt(freeMinsLeft) : <span className="text-red-400">0s</span>}
                        </td>
                        <td className="p-4">
                          <UsageBar
                            used={user.totalMinutesUsed}
                            purchased={user.totalMinutesPurchased}
                            freeSecs={user.freeSecondsRemaining ?? 0}
                          />
                        </td>
                        <td className="p-4 text-xs text-muted-foreground">
                          {user.lastSession
                            ? new Date(user.lastSession).toLocaleString()
                            : <span className="italic">Never</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="font-semibold text-foreground mb-4">Recent Activity</h2>
          {data?.recentActivity && data.recentActivity.length > 0 ? (
            <div className="space-y-3">
              {data.recentActivity.map((item, i) => (
                <div key={i} data-testid={`activity-${i}`} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${item.type === "payment_received" ? "bg-green-400" : "bg-blue-400"}`} />
                    <p className="text-sm text-foreground">{item.message}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No activity yet</p>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
