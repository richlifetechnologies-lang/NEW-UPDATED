import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation, Link } from "wouter";
import {
  useGetAdminDashboard,
  getGetAdminDashboardQueryKey,
  useAdminListUsers,
  getAdminListUsersQueryKey,
  useGetAdminRevenueChart,
  getGetAdminRevenueChartQueryKey,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/admin-layout";
import {
  RefreshCw, Zap, DollarSign, TrendingUp, Activity,
  ArrowUp, ArrowDown, Plus, RotateCcw, PencilLine, BarChart2,
  AlertTriangle, CheckCircle2, XCircle, Ghost, Clock,
  Key, Brain, Radio, Shield, ExternalLink, Eye,
} from "lucide-react";

// ─── Interfaces ──────────────────────────────────────────────────────────────

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

interface DecartCreditState {
  base: number | null;
  setAt: string | null;
  consumedSeconds: number;
  activeSessions: number;
  estimatedRemaining: number | null;
  hourlyRateCredits: number;
  daysRemaining: number | null;
}

interface DecartKey {
  id: number;
  label: string;
  apiKey: string;
  isActive: boolean;
  totalCreditsLoaded: number;
  creditsBaseline: number;
  healthStatus: string | null;
  usageLoad: number;
  assignedLicenseKeyCount: number;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useDecartStatus() {
  const [status, setStatus] = useState<DecartStatus | null>(null);
  const [billingRate, setBillingRate] = useState<number | null>(null);
  const [apiCostRate, setApiCostRate] = useState<number>(2.3);
  const [loading, setLoading] = useState(false);
  const [checkDurationMs, setCheckDurationMs] = useState<number | null>(null);
  const failCountRef = useRef(0);
  const totalChecksRef = useRef(0);
  const [successRate, setSuccessRate] = useState(100);

  useEffect(() => {
    const t = localStorage.getItem("fullswap_admin_token") ?? localStorage.getItem("fullswap_token") ?? "";
    fetch("/api/admin/billing-rate", { headers: { Authorization: `Bearer ${t}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.rate != null) setBillingRate(d.rate);
        if (d?.apiCostRate != null) setApiCostRate(d.apiCostRate);
      })
      .catch(() => {});
  }, []);

  const check = useCallback(async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    setLoading(true);
    const t0 = Date.now();
    try {
      const res = await fetch("/api/admin/decart-status", { headers: { Authorization: `Bearer ${token}` } });
      const data: DecartStatus = await res.json();
      setCheckDurationMs(Date.now() - t0);
      totalChecksRef.current += 1;
      if (!data.ok) failCountRef.current += 1;
      setSuccessRate(Math.round(((totalChecksRef.current - failCountRef.current) / totalChecksRef.current) * 1000) / 10);
      setStatus(data);
    } catch {
      totalChecksRef.current += 1;
      failCountRef.current += 1;
      setSuccessRate(Math.round(((totalChecksRef.current - failCountRef.current) / totalChecksRef.current) * 1000) / 10);
      setStatus({ ok: false, error: "Could not reach the server", checkedAt: new Date().toISOString() });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, [check]);

  const marginPct = billingRate != null && billingRate > 0
    ? Math.round(((billingRate - apiCostRate) / billingRate) * 1000) / 10
    : 0;

  return { status, loading, check, billingRate, apiCostRate, marginPct, checkDurationMs, successRate };
}

function useDecartUsage() {
  const [usage, setUsage] = useState<DecartUsage | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = async () => {
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
      await fetch("/api/admin/decart-usage/reset", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    } catch { /* silent */ }
    try { await load(); } catch { /* silent */ }
    setResetting(false);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  return { usage, resetTiers, resetting };
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
    base: null, setAt: null, consumedSeconds: 0, activeSessions: 0,
    estimatedRemaining: null, hourlyRateCredits: 0, daysRemaining: null,
  });
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
      setTickExtra(0);
    } catch { /* silent */ }
  };

  const save = async (value: number) => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/admin/decart-credits", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ credits: value }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      setState({
        base: data.credits, setAt: data.setAt, consumedSeconds: 0,
        activeSessions: data.activeSessions ?? 0,
        estimatedRemaining: data.credits,
        hourlyRateCredits: (data as any).hourlyRateCredits ?? 0,
        daysRemaining: (data as any).daysRemaining ?? null,
      });
      activeRef.current = data.activeSessions ?? 0;
      setTickExtra(0);
    } catch { setError("Could not save. Try again."); }
    finally { setSaving(false); }
  };

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 5000);
    tickRef.current = setInterval(() => {
      if (activeRef.current > 0) setTickExtra(prev => prev + activeRef.current * 5);
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

function useActiveSessions() {
  const [count, setCount] = useState<number | null>(null);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [elapsed, setElapsed] = useState<Record<string, number>>({});
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const tickRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSessions = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    try {
      const res = await fetch("/api/admin/active-sessions", { headers: { Authorization: `Bearer ${token}` } });
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

function useDecartKeys() {
  const [keys, setKeys] = useState<DecartKey[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    try {
      const res = await fetch("/api/admin/decart-keys", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const refresh = async () => { setLoading(true); await load(); };

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  return { keys, loading, refresh };
}

// ─── New data hooks (additive only) ──────────────────────────────────────────

function useStreamHealth() {
  const [data, setData] = useState<any>(null);
  const load = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    try {
      const res = await fetch("/api/admin/stream-health", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
  };
  useEffect(() => { load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, []);
  return { data, reload: load };
}

function useSessionMonitor() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [abuseFlags, setAbuseFlags] = useState<any[]>([]);
  const load = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    try {
      const [sr, ar] = await Promise.all([
        fetch("/api/admin/license-keys/active-streaming", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/admin/unified/abuse-detection", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (sr.ok) { const d = await sr.json(); setSessions(d.sessions ?? []); }
      if (ar.ok) { const d = await ar.json(); setAbuseFlags(d.flags ?? d.abuseSessions ?? []); }
    } catch { /* silent */ }
  };
  useEffect(() => { load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, []);
  return { sessions, abuseFlags, reload: load };
}

function useLiveSessionsAdvanced() {
  const [data, setData] = useState<any>(null);
  const load = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    try {
      const res = await fetch("/api/admin/live-sessions", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
  };
  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, []);
  return { data, reload: load };
}

function useKeyUsageSummary() {
  const [data, setData] = useState<any>(null);
  const load = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    try {
      const res = await fetch("/api/admin/key-usage", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
  };
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, []);
  return { data, reload: load };
}

function useBillingAuditStats() {
  const [data, setData] = useState<any>(null);
  const load = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    try {
      const res = await fetch("/api/admin/billing-audit/stats", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
  };
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, []);
  return { data, reload: load };
}

function useBillingAnalytics() {
  const [data, setData] = useState<any>(null);
  const load = async () => {
    const token = localStorage.getItem("fullswap_admin_token") ?? "";
    try {
      const res = await fetch("/api/admin/billing-rate-per-key", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
  };
  useEffect(() => { load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, []);
  return { data, reload: load };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function fmtSecs(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}:${String(sec).padStart(2, "0")}`;
  return `0:${String(sec).padStart(2, "0")}`;
}

function shortDate(iso: string) {
  const [, m, d] = iso.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

// ─── UI Components ────────────────────────────────────────────────────────────

function LiveClock() {
  const [time, setTime] = useState(() => new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC");
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      setTime(now.toUTCString().replace("GMT", "UTC").split(" ").slice(4).join(" ").slice(0, 12) + " UTC");
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-xs text-green-400">{time}</span>;
}

function RadialGauge({
  pct,
  label,
  sublabel,
  color,
  size = 140,
}: {
  pct: number;
  label: string;
  sublabel?: string;
  color: string;
  size?: number;
}) {
  const r = (size - 20) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const strokeW = 10;
  const circumference = 2 * Math.PI * r;
  const gap = circumference * 0.25;
  const arc = circumference - gap;
  const filled = arc * Math.min(1, Math.max(0, pct / 100));
  const rotation = 135;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: `rotate(${rotation}deg)` }}>
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="#1a2035"
          strokeWidth={strokeW}
          strokeDasharray={`${arc} ${circumference}`}
          strokeLinecap="round"
        />
        {/* Fill */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeW}
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          style={{
            filter: `drop-shadow(0 0 6px ${color})`,
            transition: "stroke-dasharray 0.8s ease",
          }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <span className="font-bold font-mono text-white" style={{ fontSize: size * 0.18 }}>
          {Math.round(pct)}%
        </span>
        <span className="font-mono text-center leading-tight" style={{ fontSize: size * 0.085, color }}>
          {label}
        </span>
        {sublabel && (
          <span className="text-gray-500 text-center" style={{ fontSize: size * 0.07 }}>
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}

function SparkBars({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 0.001);
  return (
    <div className="flex items-end gap-[2px] h-8">
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm min-h-[2px] transition-all duration-300"
          style={{
            height: `${Math.max(4, (v / max) * 100)}%`,
            background: i === data.length - 1 ? color : `${color}66`,
          }}
        />
      ))}
    </div>
  );
}

function SessionDot({ id, style }: { id: string; style: string }) {
  return (
    <div
      className="px-2 py-0.5 rounded text-xs font-mono font-bold border flex items-center gap-1.5"
      style={{ background: "#0a1628", borderColor: "#1e3a5f", color: "#38bdf8" }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full inline-block animate-pulse"
        style={{ background: "#22c55e", boxShadow: "0 0 6px #22c55e" }}
      />
      {style ? style.slice(0, 8).toUpperCase() : id.slice(0, 8).toUpperCase()}
    </div>
  );
}

function GlowBar({
  pct,
  color,
  height = 6,
}: {
  pct: number;
  color: string;
  height?: number;
}) {
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ height, background: "#0d1425" }}
    >
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          boxShadow: `0 0 8px ${color}88`,
        }}
      />
    </div>
  );
}

function KeyStatusBadge({ status }: { status: string }) {
  if (status === "cooldown" || status === "cooling_down") {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono" style={{ background: "#7f1d1d", color: "#f87171" }}>
        COOLDOWN
      </span>
    );
  }
  if (status === "low") {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono" style={{ background: "#78350f", color: "#fbbf24" }}>
        LOW
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono" style={{ background: "#052e16", color: "#4ade80" }}>
      ACTIVE
    </span>
  );
}

// ─── Tier color map ────────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, { from: string; to: string }> = {
  "starter":   { from: "#d97706", to: "#f59e0b" },
  "basic":     { from: "#059669", to: "#10b981" },
  "standard":  { from: "#0891b2", to: "#06b6d4" },
  "pro":       { from: "#7c3aed", to: "#a78bfa" },
  "pro plus":  { from: "#c2410c", to: "#f97316" },
  "proplus":   { from: "#c2410c", to: "#f97316" },
  "streamer":  { from: "#b45309", to: "#fbbf24" },
  "big maxi 1":{ from: "#be185d", to: "#ec4899" },
  "bigmaxi1":  { from: "#be185d", to: "#ec4899" },
  "big maxi 2":{ from: "#065f46", to: "#10b981" },
  "bigmaxi2":  { from: "#065f46", to: "#34d399" },
};

function getTierColor(label: string) {
  const key = label.toLowerCase().replace(/\s+/g, " ").trim();
  return TIER_COLORS[key] ?? { from: "#3b82f6", to: "#60a5fa" };
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const [, setLocation] = useLocation();
  const dashboard = useGetAdminDashboard({ query: { queryKey: getGetAdminDashboardQueryKey() } });
  const users = useAdminListUsers({ query: { queryKey: getAdminListUsersQueryKey(), refetchInterval: 15000 } });
  const live = useActiveSessions();
  const decart = useDecartStatus();
  const billingRate = decart.billingRate;
  const { usage: decartUsage, resetTiers } = useDecartUsage();
  const { resetCredits } = useAdminCreditsReset(() => dashboard.refetch());
  const decartCredits = useDecartCredits();
  const { keys: decartKeys, refresh: refreshKeys } = useDecartKeys();
  const streamHealth = useStreamHealth();
  const sessionMonitor = useSessionMonitor();
  const liveSessionsAdv = useLiveSessionsAdvanced();
  const keyUsageSummary = useKeyUsageSummary();
  const billingAuditStats = useBillingAuditStats();
  const billingAnalytics = useBillingAnalytics();

  // ── Toast alert state ────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<{ id: string; message: string; level: "critical" | "warning" | "info"; ts: number }[]>([]);
  const seenAlerts = useRef<Set<string>>(new Set());

  // ── Audio alert (Web Audio API — no deps, silent on failure) ────────────
  const playAlertBeep = useCallback((level: "critical" | "warning") => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);

      const schedule = (freq: number, startTime: number, duration: number, volume: number) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g);
        g.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, startTime);
        g.gain.setValueAtTime(0, startTime);
        g.gain.linearRampToValueAtTime(volume, startTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.05);
      };

      if (level === "critical") {
        // Three descending tones — urgent but not jarring
        schedule(880, ctx.currentTime,        0.18, 0.18);
        schedule(660, ctx.currentTime + 0.22, 0.18, 0.14);
        schedule(440, ctx.currentTime + 0.44, 0.25, 0.12);
      } else {
        // Single soft tone for warnings
        schedule(660, ctx.currentTime, 0.2, 0.10);
      }
    } catch { /* silent — browser may block audio without user gesture */ }
  }, []);

  const pushToast = useCallback((id: string, message: string, level: "critical" | "warning" | "info") => {
    if (seenAlerts.current.has(id)) return;
    seenAlerts.current.add(id);
    const ts = Date.now();
    setToasts(prev => [...prev.slice(-4), { id, message, level, ts }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 8000);
    if (level === "critical" || level === "warning") playAlertBeep(level);
  }, [playAlertBeep]);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Watch live sessions for orphan/critical alerts
  useEffect(() => {
    const sessions: any[] = liveSessionsAdv.data?.sessions ?? [];
    for (const s of sessions) {
      if (s.isCritical) {
        pushToast(`crit-${s.sessionId}`, `Critical session — wallet nearly empty (${s.wallet?.remainingMinutes?.toFixed(0) ?? "?"}m left): ${s.sessionId?.slice(0, 12)}`, "critical");
      }
      if (s.isOrphan) {
        pushToast(`orphan-${s.sessionId}`, `Orphan session detected — no heartbeat: ${s.sessionId?.slice(0, 12)}`, "warning");
      }
    }
  }, [liveSessionsAdv.data, pushToast]);

  // Watch stream health for critical streams
  useEffect(() => {
    const streams: any[] = streamHealth.data?.streams ?? [];
    for (const s of streams) {
      if (s.healthStatus === "critical") {
        pushToast(`health-crit-${s.sessionId}`, `Stream health CRITICAL — ${s.style ?? "unknown"} on ${s.decartKeyLabel ?? "?"} (${s.estimatedMinsLeft ?? "?"}m left)`, "critical");
      }
    }
  }, [streamHealth.data, pushToast]);

  // Watch abuse flags for high-severity
  useEffect(() => {
    const flags: any[] = sessionMonitor.abuseFlags ?? [];
    for (const f of flags) {
      if (f.severity === "high") {
        const alertId = `abuse-${f.sessionId}-${f.type}`;
        pushToast(alertId, `Abuse flag: ${f.type?.replace(/_/g, " ")} on session ${f.sessionId?.slice(0, 12)} (${f.count}x in ${f.windowSeconds}s)`, "warning");
      }
    }
  }, [sessionMonitor.abuseFlags, pushToast]);

  const revenueChart = useGetAdminRevenueChart({
    query: { queryKey: getGetAdminRevenueChartQueryKey(), refetchInterval: 60000 },
  });

  useEffect(() => {
    if (!localStorage.getItem("fullswap_admin_token")) setLocation("/admin");
  }, [setLocation]);

  const data = dashboard.data;
  const chartData = (revenueChart.data ?? []).map((d: any) => ({ ...d, label: shortDate(d.date) }));
  const last7 = chartData.slice(-7);
  const spark = last7.map((d: any) => d.usdt ?? 0);

  // Revenue today vs yesterday
  const todayRevenue = data?.revenueToday ?? 0;
  const yesterdayRevenue = chartData.length >= 2 ? ((chartData[chartData.length - 2] as any)?.usdt ?? 0) : 0;
  const revChangePct = yesterdayRevenue > 0
    ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 1000) / 10
    : 0;

  // Credits gauge
  const creditsBase = decartCredits.credits ?? 0;
  const creditsRemaining = decartCredits.liveRemaining ?? 0;
  const creditsPct = creditsBase > 0 ? (creditsRemaining / creditsBase) * 100 : 0;
  const burnRateSec = decartCredits.hourlyRateCredits / 3600;
  const minutesRemaining = decartCredits.hourlyRateCredits > 0
    ? Math.floor(creditsRemaining / (decartCredits.hourlyRateCredits / 60))
    : null;

  // Platform health
  const platformOnline = decart.status !== null;
  const apiOk = decart.status?.ok ?? false;
  const uptimePct = platformOnline ? (apiOk ? 99.9 : 97.2) : 0;
  const apiSuccessRate = decart.successRate;
  const latencyMs = decart.checkDurationMs;

  // Key pool stats
  const activeKeys = decartKeys.filter(k => k.isActive && k.healthStatus !== "cooldown" && k.healthStatus !== "cooling_down").length;
  const totalKeys = decartKeys.length;
  const poolTotalCredits = decartKeys.reduce((s, k) => s + (k.totalCreditsLoaded ?? 0), 0);

  // Top revenue tiers (top 4)
  const sortedTiers = [...(decartUsage?.tierBreakdown ?? [])].sort((a, b) => (b.revenueUsdt ?? 0) - (a.revenueUsdt ?? 0));
  const topTiers = sortedTiers.slice(0, 4);
  const maxTierRevenue = topTiers[0]?.revenueUsdt ?? 1;

  // Sessions today
  const sessionsToday = decartUsage?.sessionsLast24h ?? 0;
  const minutesStreamedToday = decartUsage?.totalMinutesStreamed ?? 0;

  // Tier performance (all tiers for section 02)
  const allTiers = decartUsage?.tierBreakdown ?? [];
  const maxTierRev = Math.max(...allTiers.map(t => t.revenueUsdt ?? 0), 1);

  const isLive = (live.count ?? 0) > 0;

  return (
    <AdminLayout>
      {/* ── Mission Control Toast Alerts (fixed overlay) ── */}
      {toasts.length > 0 && (
        <div
          className="fixed z-50 flex flex-col gap-2 pointer-events-none"
          style={{ bottom: "24px", right: "24px", width: "340px" }}
        >
          {toasts.map(t => (
            <div
              key={t.id}
              className="pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl shadow-2xl"
              style={{
                background: t.level === "critical" ? "#1a0505" : t.level === "warning" ? "#1a1005" : "#050f1a",
                border: `1px solid ${t.level === "critical" ? "#ef444440" : t.level === "warning" ? "#f59e0b40" : "#38bdf840"}`,
                boxShadow: `0 0 20px ${t.level === "critical" ? "#ef444420" : t.level === "warning" ? "#f59e0b20" : "#38bdf820"}`,
                animation: "fadeInUp 0.3s ease",
              }}
            >
              <div className="shrink-0 mt-0.5">
                {t.level === "critical" ? (
                  <AlertTriangle className="w-4 h-4" style={{ color: "#ef4444" }} />
                ) : t.level === "warning" ? (
                  <AlertTriangle className="w-4 h-4" style={{ color: "#f59e0b" }} />
                ) : (
                  <Activity className="w-4 h-4" style={{ color: "#38bdf8" }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className="text-[10px] font-mono tracking-widest mb-0.5"
                  style={{ color: t.level === "critical" ? "#ef4444" : t.level === "warning" ? "#f59e0b" : "#38bdf8" }}
                >
                  {t.level === "critical" ? "⚠ CRITICAL ALERT" : t.level === "warning" ? "⚠ WARNING" : "ℹ INFO"}
                </div>
                <div className="text-[11px] font-mono text-gray-300 leading-relaxed">{t.message}</div>
              </div>
              <button
                onClick={() => dismissToast(t.id)}
                className="shrink-0 text-gray-600 hover:text-gray-300 transition-colors mt-0.5"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <style>{`@keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div
        className="min-h-screen"
        style={{
          background: "#060b14",
          fontFamily: "'Rajdhani', 'Orbitron', sans-serif",
        }}
      >
        {/* ── Top Header Bar ── */}
        <div
          className="flex items-center justify-between px-6 py-3 border-b"
          style={{ background: "#08101d", borderColor: "#0d1f35" }}
        >
          <div className="flex items-center gap-3">
            <span className="font-bold text-white text-base tracking-widest font-mono">FULLSWAP</span>
            <span className="text-gray-500 text-sm">//</span>
            <span className="text-gray-400 text-sm tracking-widest font-mono">ADMIN MISSION CONTROL</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: isLive ? "#22c55e" : "#374151", boxShadow: isLive ? "0 0 8px #22c55e" : "none" }}
              />
              <span className="text-xs font-mono font-bold" style={{ color: isLive ? "#22c55e" : "#6b7280" }}>
                {live.count ?? 0} LIVE SESSIONS
              </span>
            </div>
            <span className="w-px h-4 bg-gray-700" />
            <LiveClock />
          </div>
        </div>

        {/* ── Status Strip ── */}
        <div
          className="flex flex-wrap items-center gap-0 border-b divide-x"
          style={{ background: "#06111e", borderColor: "#0d1f35", divideColor: "#0d2035" }}
        >
          {[
            {
              label: "Platform",
              value: platformOnline ? "ONLINE" : "CHECKING",
              color: platformOnline ? "#22c55e" : "#f59e0b",
              dot: true,
            },
            {
              label: "Decart API",
              value: apiOk ? "CONNECTED" : decart.status === null ? "CHECKING" : "ERROR",
              color: apiOk ? "#22c55e" : decart.status === null ? "#f59e0b" : "#ef4444",
              dot: true,
            },
            {
              label: "Key Pool",
              value: `${activeKeys}/${totalKeys} ACTIVE`,
              color: activeKeys === totalKeys ? "#22c55e" : activeKeys > 0 ? "#f59e0b" : "#ef4444",
              dot: true,
            },
            {
              label: "Billing Rate",
              value: billingRate != null ? `${billingRate} cr/s` : "—",
              color: "#38bdf8",
              dot: false,
            },
            {
              label: "Decart Credits",
              value: creditsRemaining > 0 ? `${Math.round(creditsRemaining).toLocaleString()} remaining` : "—",
              color: creditsPct > 30 ? "#38bdf8" : creditsPct > 10 ? "#f59e0b" : "#ef4444",
              dot: false,
            },
            {
              label: "Margin",
              value: decart.marginPct > 0 ? `${decart.marginPct}% profit` : "—",
              color: decart.marginPct > 20 ? "#4ade80" : decart.marginPct > 0 ? "#fbbf24" : "#ef4444",
              dot: false,
            },
          ].map(({ label, value, color, dot }) => (
            <div key={label} className="flex items-center gap-2 px-4 py-2.5" style={{ borderColor: "#0d2035" }}>
              {dot && (
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                />
              )}
              <span className="text-xs text-gray-500 font-mono">{label}</span>
              <span className="text-xs font-bold font-mono" style={{ color }}>
                {value}
              </span>
            </div>
          ))}
        </div>

        <div className="p-5 space-y-5">

          {/* ── Section 01 — Platform Overview ── */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-mono text-gray-500">01</span>
              <div className="w-px h-3 bg-gray-700" />
              <span className="text-xs font-mono tracking-widest text-gray-400">PLATFORM OVERVIEW</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Live Streaming Sessions */}
              <div
                className="rounded-xl p-4 border"
                style={{ background: "#080f1c", borderColor: "#0d1f35" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-xs font-mono text-gray-500 tracking-wider">LIVE STREAMING SESSIONS</span>
                </div>
                <div
                  className="text-4xl font-bold font-mono mb-1"
                  style={{ color: "#4ade80", textShadow: "0 0 20px #4ade8066" }}
                >
                  {live.count ?? "—"}
                </div>
                <div className="text-xs text-gray-500 mb-3 font-mono">
                  {live.count != null && live.count > 0
                    ? `${live.count} streaming now`
                    : "No active streams"}
                </div>
                {live.sessions.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {live.sessions.slice(0, 5).map(s => (
                      <SessionDot key={s.id} id={s.id} style={s.style} />
                    ))}
                    {live.sessions.length > 5 && (
                      <span className="text-xs text-gray-500 font-mono self-center">+{live.sessions.length - 5}</span>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-1.5 mt-2">
                    {[...Array(3)].map((_, i) => (
                      <div
                        key={i}
                        className="px-2 py-0.5 rounded text-xs font-mono border"
                        style={{ background: "#0a1628", borderColor: "#1e3a5f", color: "#1e3a5f" }}
                      >
                        ——
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Billing Rate */}
              <div
                className="rounded-xl p-4 border"
                style={{ background: "#080f1c", borderColor: "#0d1f35" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-xs font-mono text-gray-500 tracking-wider">BILLING RATE</span>
                </div>
                <div
                  className="text-4xl font-bold font-mono mb-1"
                  style={{ color: "#f59e0b", textShadow: "0 0 20px #f59e0b66" }}
                >
                  {billingRate != null ? billingRate.toFixed(1) : "—"}
                </div>
                <div className="text-xs text-gray-500 mb-3 font-mono">
                  cr/s · {decart.marginPct > 0 ? `${decart.marginPct}% margin above cost` : "at cost"}
                </div>
                <SparkBars data={spark.length > 0 ? spark : [0.2, 0.4, 0.3, 0.5, 0.4, 0.6, 0.5]} color="#f59e0b" />
              </div>

              {/* Revenue Today */}
              <div
                className="rounded-xl p-4 border"
                style={{ background: "#080f1c", borderColor: "#0d1f35" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-xs font-mono text-gray-500 tracking-wider">REVENUE TODAY</span>
                </div>
                <div
                  className="text-4xl font-bold font-mono mb-1"
                  style={{ color: "#38bdf8", textShadow: "0 0 20px #38bdf866" }}
                >
                  ${todayRevenue.toFixed(0)}
                </div>
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-xs text-gray-500 font-mono">USDT</span>
                  {revChangePct !== 0 && (
                    <span
                      className="flex items-center gap-0.5 text-xs font-mono font-bold"
                      style={{ color: revChangePct >= 0 ? "#4ade80" : "#ef4444" }}
                    >
                      {revChangePct >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                      {Math.abs(revChangePct)}% vs yesterday
                    </span>
                  )}
                </div>
                <SparkBars data={spark.length > 0 ? spark : [0.3, 0.5, 0.4, 0.6, 0.5, 0.7, 0.6]} color="#38bdf8" />
              </div>

              {/* Sessions Today */}
              <div
                className="rounded-xl p-4 border"
                style={{ background: "#080f1c", borderColor: "#0d1f35" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <BarChart2 className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-xs font-mono text-gray-500 tracking-wider">SESSIONS TODAY</span>
                </div>
                <div
                  className="text-4xl font-bold font-mono mb-1"
                  style={{ color: "#a78bfa", textShadow: "0 0 20px #a78bfa66" }}
                >
                  {sessionsToday}
                </div>
                <div className="text-xs text-gray-500 mb-3 font-mono">
                  {minutesStreamedToday > 0
                    ? `${minutesStreamedToday.toLocaleString()} min streamed`
                    : "last 24 hours"}
                </div>
                <SparkBars
                  data={last7.map((d: any) => d.payments ?? 0).map((v: number) => v || 0.1)}
                  color="#a78bfa"
                />
              </div>
            </div>
          </div>

          {/* ── Gauge Row ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

            {/* Decart API Credits */}
            <div
              className="rounded-xl p-5 border"
              style={{ background: "#080f1c", borderColor: "#0d1f35" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-mono text-gray-500 tracking-wider">DECART API CREDITS</span>
              </div>
              <div className="flex flex-col items-center gap-3">
                <RadialGauge
                  pct={creditsPct}
                  label="REMAIN"
                  color={creditsPct > 30 ? "#f59e0b" : creditsPct > 10 ? "#f97316" : "#ef4444"}
                  size={150}
                />
                <div className="w-full space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500 font-mono">Current burn rate</span>
                    <span className="text-xs font-mono font-bold text-yellow-400">
                      {burnRateSec > 0 ? `${burnRateSec.toFixed(1)} cr/s` : "—"}
                    </span>
                  </div>
                  <GlowBar
                    pct={creditsPct}
                    color={creditsPct > 30 ? "#f59e0b" : "#ef4444"}
                    height={5}
                  />
                  <div className="text-xs text-gray-600 font-mono text-center">
                    {minutesRemaining != null && minutesRemaining > 0
                      ? `~${minutesRemaining} min remaining at current load`
                      : creditsBase > 0
                      ? `${Math.round(creditsRemaining).toLocaleString()} cr remaining`
                      : "No credit baseline set"}
                  </div>
                </div>
              </div>
            </div>

            {/* Platform Health */}
            <div
              className="rounded-xl p-5 border"
              style={{ background: "#080f1c", borderColor: "#0d1f35" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-mono text-gray-500 tracking-wider">PLATFORM HEALTH</span>
              </div>
              <div className="flex flex-col items-center gap-3">
                <RadialGauge
                  pct={uptimePct}
                  label="UPTIME"
                  color="#06b6d4"
                  size={150}
                />
                <div className="w-full space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500 font-mono">API success rate</span>
                    <span className="text-xs font-mono font-bold text-cyan-400">
                      {apiSuccessRate.toFixed(1)}%
                    </span>
                  </div>
                  <GlowBar pct={apiSuccessRate} color="#06b6d4" height={5} />
                  <div className="text-xs text-gray-600 font-mono text-center">
                    {latencyMs != null
                      ? `Avg session latency: ${latencyMs}ms`
                      : "Monitoring active"}
                  </div>
                </div>
              </div>
            </div>

            {/* Top Revenue Tiers */}
            <div
              className="rounded-xl p-5 border"
              style={{ background: "#080f1c", borderColor: "#0d1f35" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 className="w-3.5 h-3.5 text-gray-500" />
                <span className="text-xs font-mono text-gray-500 tracking-wider">TOP REVENUE TIERS</span>
              </div>
              <div className="space-y-3">
                {topTiers.length > 0 ? topTiers.map((tier, i) => {
                  const tierColors = ["#f59e0b", "#a78bfa", "#06b6d4", "#4ade80"];
                  const color = tierColors[i] ?? "#6b7280";
                  const pct = maxTierRevenue > 0 ? (tier.revenueUsdt / maxTierRevenue) * 100 : 0;
                  return (
                    <div key={tier.label}>
                      <div className="flex justify-between mb-1">
                        <span className="text-xs font-mono text-gray-400">
                          {tier.label.toUpperCase()} · {tier.minutes}min
                        </span>
                        <span className="text-xs font-mono font-bold" style={{ color }}>
                          ${tier.revenueUsdt.toFixed(0)} · {tier.sessionCount} sessions
                        </span>
                      </div>
                      <GlowBar pct={pct} color={color} height={5} />
                    </div>
                  );
                }) : (
                  <div className="text-center py-6">
                    <span className="text-xs text-gray-600 font-mono">No tier data yet</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Section 02 — Package Tier Performance ── */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-mono text-gray-500">02</span>
              <div className="w-px h-3 bg-gray-700" />
              <span className="text-xs font-mono tracking-widest text-gray-400">PACKAGE TIER PERFORMANCE</span>
              <button
                onClick={() => {
                  if (window.confirm("Reset tier performance stats?")) resetTiers();
                }}
                className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-gray-600 hover:text-gray-400 transition-colors border border-gray-800 hover:border-gray-700"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                Reset
              </button>
            </div>

            <div
              className="rounded-xl border p-4"
              style={{ background: "#080f1c", borderColor: "#0d1f35" }}
            >
              {allTiers.length > 0 ? (
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(allTiers.length, 8)}, 1fr)` }}>
                  {allTiers.slice(0, 8).map(tier => {
                    const { from, to } = getTierColor(tier.label);
                    const heightPct = maxTierRev > 0 ? (tier.revenueUsdt / maxTierRev) * 100 : 10;
                    return (
                      <div key={tier.label} className="flex flex-col items-center gap-2">
                        <span
                          className="text-xs font-mono font-bold"
                          style={{ color: to }}
                        >
                          ${tier.revenueUsdt.toFixed(0)}
                        </span>
                        <div className="w-full relative" style={{ height: 80 }}>
                          <div
                            className="absolute bottom-0 left-0 right-0 rounded-t-sm transition-all duration-700"
                            style={{
                              height: `${Math.max(10, heightPct)}%`,
                              background: `linear-gradient(180deg, ${to}, ${from}88)`,
                              boxShadow: `0 -2px 12px ${to}44`,
                            }}
                          />
                        </div>
                        <div
                          className="w-full h-0.5 rounded-full"
                          style={{ background: `linear-gradient(90deg, ${from}, ${to})` }}
                        />
                        <span className="text-[9px] font-mono text-gray-400 tracking-wider text-center">
                          {tier.label.toUpperCase()}
                        </span>
                        <span className="text-[9px] font-mono text-gray-600">
                          {tier.minutes}min
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-10">
                  <BarChart2 className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                  <p className="text-xs text-gray-600 font-mono">No tier performance data yet</p>
                  <p className="text-[10px] text-gray-700 font-mono mt-1">Revenue will appear here once sessions complete</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Section 03 — Operational Intelligence ── */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-mono text-gray-500">03</span>
              <div className="w-px h-3 bg-gray-700" />
              <span className="text-xs font-mono tracking-widest text-gray-400">OPERATIONAL INTELLIGENCE</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

              {/* Live Sessions Now */}
              <div
                className="rounded-xl border p-4"
                style={{ background: "#080f1c", borderColor: "#0d1f35" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ background: "#22c55e", boxShadow: "0 0 6px #22c55e" }}
                  />
                  <span className="text-xs font-mono text-gray-400 tracking-wider">LIVE SESSIONS NOW</span>
                </div>
                <div className="space-y-2 min-h-[120px]">
                  {live.sessions.length > 0 ? live.sessions.map(s => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between py-1 border-b"
                      style={{ borderColor: "#0d1f35" }}
                    >
                      <span
                        className="text-xs font-mono font-bold truncate max-w-[55%]"
                        style={{ color: "#38bdf8" }}
                      >
                        {s.username ?? s.id.slice(0, 12).toUpperCase()}
                      </span>
                      <span className="text-xs font-mono text-yellow-400 shrink-0">
                        {live.elapsed[s.id] != null ? fmtSecs(live.elapsed[s.id]) : "—"}
                      </span>
                    </div>
                  )) : (
                    <div className="flex items-center justify-center h-24">
                      <span className="text-xs text-gray-700 font-mono">No active sessions</span>
                    </div>
                  )}
                  {live.sessions.length > 0 && (
                    <div className="pt-1 border-t" style={{ borderColor: "#0d1f35" }}>
                      <span className="text-[10px] text-gray-600 font-mono">
                        → {live.count ?? 0} active · {burnRateSec.toFixed(1)} cr/s total burn · {decart.marginPct}% margin
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Decart Key Pool */}
              <div
                className="rounded-xl border p-4"
                style={{ background: "#080f1c", borderColor: "#0d1f35" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-xs font-mono text-gray-400 tracking-wider">DECART KEY POOL</span>
                </div>
                <div className="space-y-2 min-h-[120px]">
                  {decartKeys.length > 0 ? decartKeys.map(k => {
                    const creditsLeft = Math.max(0, (k.totalCreditsLoaded ?? 0) - (k.creditsBaseline ?? 0));
                    const status = !k.isActive
                      ? "cooldown"
                      : k.healthStatus === "cooling_down" || k.healthStatus === "cooldown"
                      ? "cooldown"
                      : creditsLeft < 5000
                      ? "low"
                      : "active";
                    return (
                      <div
                        key={k.id}
                        className="flex items-center justify-between py-1 border-b"
                        style={{ borderColor: "#0d1f35" }}
                      >
                        <span className="text-xs font-mono text-gray-300 truncate max-w-[40%]">
                          {k.label}
                        </span>
                        <span className="text-xs font-mono text-gray-500">
                          {creditsLeft.toLocaleString()} cr
                        </span>
                        <KeyStatusBadge status={status} />
                      </div>
                    );
                  }) : (
                    <div className="flex items-center justify-center h-20">
                      <span className="text-xs text-gray-700 font-mono">Loading key pool…</span>
                    </div>
                  )}
                  {decartKeys.length > 0 && (
                    <div className="pt-2 border-t" style={{ borderColor: "#0d1f35" }}>
                      <div className="flex justify-between mb-1">
                        <span className="text-[10px] text-gray-500 font-mono">Pool credit total</span>
                        <span className="text-[10px] text-gray-400 font-mono font-bold">
                          {poolTotalCredits.toLocaleString()} cr
                        </span>
                      </div>
                      <GlowBar
                        pct={totalKeys > 0 ? (activeKeys / totalKeys) * 100 : 0}
                        color="#f59e0b"
                        height={4}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div
                className="rounded-xl border p-4"
                style={{ background: "#080f1c", borderColor: "#0d1f35" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-xs font-mono text-gray-400 tracking-wider">QUICK ACTIONS</span>
                </div>
                <div className="space-y-2">
                  {[
                    {
                      label: "TOP UP DECART CREDITS",
                      icon: Plus,
                      color: "#f59e0b",
                      action: () => {
                        const val = window.prompt("Enter new Decart credit balance:");
                        if (val && !isNaN(Number(val))) {
                          decartCredits.save(Number(val));
                        }
                      },
                    },
                    {
                      label: "REFRESH KEY POOL",
                      icon: RotateCcw,
                      color: "#38bdf8",
                      action: () => refreshKeys(),
                    },
                    {
                      label: "CHANGE BILLING RATE",
                      icon: PencilLine,
                      color: "#a78bfa",
                      action: () => setLocation("/admin/billing"),
                    },
                    {
                      label: "RESET USAGE STATS",
                      icon: RefreshCw,
                      color: "#6b7280",
                      action: () => {
                        if (window.confirm("Reset usage stats?")) resetCredits();
                      },
                    },
                  ].map(({ label, icon: Icon, color, action }) => (
                    <button
                      key={label}
                      onClick={action}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all duration-150 hover:brightness-125 group"
                      style={{
                        background: "#06111e",
                        borderColor: "#0d1f35",
                        color: "#6b7280",
                      }}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0 transition-colors" style={{ color }} />
                      <span className="text-[11px] font-mono tracking-wider group-hover:text-gray-300 transition-colors">
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Stats Footer ── */}
          <div
            className="rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-4"
            style={{ background: "#080f1c", borderColor: "#0d1f35" }}
          >
            {[
              {
                label: "TOTAL LICENSE KEYS",
                value: data?.totalUsers ?? "—",
                color: "#38bdf8",
                icon: DollarSign,
              },
              {
                label: "ACTIVE MEMBERS",
                value: data?.activeUsers ?? "—",
                color: "#4ade80",
                icon: Activity,
              },
              {
                label: "TOTAL REVENUE",
                value: `$${data?.totalRevenue?.toFixed(2) ?? "0.00"}`,
                color: "#f59e0b",
                icon: TrendingUp,
              },
              {
                label: "TOTAL SESSIONS",
                value: decartUsage?.totalSessionsAllTime?.toLocaleString() ?? "—",
                color: "#a78bfa",
                icon: BarChart2,
              },
            ].map(({ label, value, color, icon: Icon }) => (
              <div key={label} className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `${color}15`, border: `1px solid ${color}30` }}
                >
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
                <div>
                  <div className="text-[10px] font-mono text-gray-600 tracking-wider">{label}</div>
                  <div className="text-sm font-bold font-mono" style={{ color }}>{String(value)}</div>
                </div>
              </div>
            ))}
          </div>

        {/* ════════════════════════════════════════════════════════════
            SECTION A — BILLING ANALYTICS
        ════════════════════════════════════════════════════════════ */}
        <div className="rounded-xl border overflow-hidden" style={{ background: "#080f1c", borderColor: "#0d1f35" }}>
          <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "#0d1f35", background: "#050b16" }}>
            <div className="flex items-center gap-2">
              <BarChart2 className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} />
              <span className="text-[11px] font-mono tracking-widest text-gray-400">BILLING ANALYTICS</span>
            </div>
            <Link href="/admin/analytics">
              <span className="flex items-center gap-1 text-[10px] font-mono text-gray-600 hover:text-yellow-400 transition-colors cursor-pointer">
                FULL VIEW <ExternalLink className="w-3 h-3" />
              </span>
            </Link>
          </div>
          <div className="p-4">
            {!billingAnalytics.data ? (
              <p className="text-[11px] font-mono text-gray-600 text-center py-4">Loading billing data…</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: "BILLING RATE", value: `${billingAnalytics.data.globalBillingRate ?? "—"} cr/s`, color: "#f59e0b" },
                    { label: "API COST RATE", value: `${billingAnalytics.data.apiCostRate ?? 2.3} cr/s`, color: "#ef4444" },
                    { label: "TOTAL KEYS", value: billingAnalytics.data.total ?? "—", color: "#38bdf8" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg p-3 text-center" style={{ background: "#060b14", border: "1px solid #0d1f35" }}>
                      <div className="text-[10px] font-mono text-gray-600 tracking-wider mb-1">{label}</div>
                      <div className="text-sm font-bold font-mono" style={{ color }}>{String(value)}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-1">
                  {(billingAnalytics.data.keys ?? []).slice(0, 5).map((k: any) => (
                    <div key={k.licenseKeyId} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: "#060b14", border: "1px solid #0d1f35" }}>
                      <div className="flex items-center gap-2 min-w-0">
                        <Key className="w-3 h-3 shrink-0" style={{ color: k.isLive ? "#4ade80" : "#6b7280" }} />
                        <span className="text-[11px] font-mono text-gray-400 truncate">{k.licenseKey?.slice(0, 10)}…</span>
                        {k.isLive && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "#4ade8015", color: "#4ade80" }}>LIVE</span>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[10px] font-mono" style={{ color: "#38bdf8" }}>{k.effectiveRate} cr/s</span>
                        <span className="text-[10px] font-mono" style={{ color: (k.projectedProfitPct ?? 0) > 0 ? "#4ade80" : "#ef4444" }}>
                          {k.projectedProfitPct?.toFixed(1) ?? "—"}%
                        </span>
                      </div>
                    </div>
                  ))}
                  {(billingAnalytics.data.keys?.length ?? 0) === 0 && (
                    <p className="text-[11px] font-mono text-gray-600 text-center py-2">No key data</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════
            SECTION B — SESSION MONITOR
        ════════════════════════════════════════════════════════════ */}
        <div className="rounded-xl border overflow-hidden" style={{ background: "#080f1c", borderColor: "#0d1f35" }}>
          <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "#0d1f35", background: "#050b16" }}>
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5" style={{ color: "#38bdf8" }} />
              <span className="text-[11px] font-mono tracking-widest text-gray-400">SESSION MONITOR</span>
              {sessionMonitor.abuseFlags.length > 0 && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "#ef444415", color: "#ef4444" }}>
                  {sessionMonitor.abuseFlags.length} ABUSE FLAGS
                </span>
              )}
            </div>
            <Link href="/admin/sessions">
              <span className="flex items-center gap-1 text-[10px] font-mono text-gray-600 hover:text-sky-400 transition-colors cursor-pointer">
                FULL VIEW <ExternalLink className="w-3 h-3" />
              </span>
            </Link>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-4 mb-3 text-[11px] font-mono">
              <span style={{ color: "#38bdf8" }}>{sessionMonitor.sessions.length} active streaming</span>
              {sessionMonitor.abuseFlags.filter((f: any) => f.severity === "high").length > 0 && (
                <span style={{ color: "#ef4444" }}>⚠ {sessionMonitor.abuseFlags.filter((f: any) => f.severity === "high").length} high-severity</span>
              )}
            </div>
            {sessionMonitor.sessions.length === 0 ? (
              <p className="text-[11px] font-mono text-gray-600 text-center py-3">No active streaming sessions</p>
            ) : (
              <div className="space-y-1">
                {sessionMonitor.sessions.slice(0, 6).map((s: any) => (
                  <div key={s.sessionId} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: "#060b14", border: "1px solid #0d1f35" }}>
                    <div className="flex items-center gap-2">
                      <Radio className="w-3 h-3 animate-pulse" style={{ color: "#4ade80" }} />
                      <span className="text-[11px] font-mono text-gray-300 capitalize">{s.style ?? "—"}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-gray-500">{s.minutesRemaining?.toFixed(0) ?? "—"}m left</span>
                      <span className="text-[10px] font-mono text-gray-600">{s.key?.slice(0, 8)}…</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {sessionMonitor.abuseFlags.length > 0 && (
              <div className="mt-3 pt-3 border-t" style={{ borderColor: "#0d1f35" }}>
                <div className="text-[10px] font-mono text-gray-600 mb-2 tracking-wider">ABUSE FLAGS</div>
                <div className="space-y-1">
                  {sessionMonitor.abuseFlags.slice(0, 3).map((f: any, i: number) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded" style={{ background: "#1a0a0a", border: "1px solid #2a0f0f" }}>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3 h-3" style={{ color: f.severity === "high" ? "#ef4444" : "#f59e0b" }} />
                        <span className="text-[10px] font-mono text-gray-400">{f.type ?? "flag"}</span>
                      </div>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{
                        background: f.severity === "high" ? "#ef444415" : "#f59e0b15",
                        color: f.severity === "high" ? "#ef4444" : "#f59e0b",
                      }}>{f.severity?.toUpperCase()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════
            SECTION C — STREAM HEALTH
        ════════════════════════════════════════════════════════════ */}
        <div className="rounded-xl border overflow-hidden" style={{ background: "#080f1c", borderColor: "#0d1f35" }}>
          <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "#0d1f35", background: "#050b16" }}>
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5" style={{ color: "#a78bfa" }} />
              <span className="text-[11px] font-mono tracking-widest text-gray-400">STREAM HEALTH</span>
            </div>
            <Link href="/admin/stream-health">
              <span className="flex items-center gap-1 text-[10px] font-mono text-gray-600 hover:text-violet-400 transition-colors cursor-pointer">
                FULL VIEW <ExternalLink className="w-3 h-3" />
              </span>
            </Link>
          </div>
          <div className="p-4">
            {!streamHealth.data ? (
              <p className="text-[11px] font-mono text-gray-600 text-center py-4">Loading stream health…</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: "ACTIVE STREAMS", value: streamHealth.data.summary?.activeStreams ?? 0, color: "#4ade80" },
                    { label: "BURN RATE", value: `${((streamHealth.data.summary?.totalBurnRateCrSec ?? 0)).toFixed(2)} cr/s`, color: "#f59e0b" },
                    { label: "DECART KEYS IN USE", value: streamHealth.data.summary?.decartKeysInUse ?? 0, color: "#38bdf8" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg p-3 text-center" style={{ background: "#060b14", border: "1px solid #0d1f35" }}>
                      <div className="text-[10px] font-mono text-gray-600 tracking-wider mb-1">{label}</div>
                      <div className="text-sm font-bold font-mono" style={{ color }}>{String(value)}</div>
                    </div>
                  ))}
                </div>
                {(streamHealth.data.streams ?? []).length === 0 ? (
                  <p className="text-[11px] font-mono text-gray-600 text-center py-2">No active streams</p>
                ) : (
                  <div className="space-y-1">
                    {streamHealth.data.streams.slice(0, 5).map((s: any) => (
                      <div key={s.sessionId} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{
                        background: "#060b14",
                        border: `1px solid ${s.healthStatus === "critical" ? "#ef444430" : s.healthStatus === "warning" ? "#f59e0b30" : "#22c55e30"}`,
                      }}>
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: s.healthStatus === "critical" ? "#ef4444" : s.healthStatus === "warning" ? "#f59e0b" : "#22c55e" }} />
                          <span className="text-[11px] font-mono text-gray-300 capitalize">{s.style ?? "—"}</span>
                          <span className="text-[10px] font-mono text-gray-600">{s.decartKeyLabel ?? "—"}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono" style={{ color: "#38bdf8" }}>{s.estimatedMinsLeft ?? "—"}m left</span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded capitalize" style={{
                            background: s.healthStatus === "critical" ? "#ef444415" : s.healthStatus === "warning" ? "#f59e0b15" : "#22c55e15",
                            color: s.healthStatus === "critical" ? "#ef4444" : s.healthStatus === "warning" ? "#f59e0b" : "#22c55e",
                          }}>{s.healthStatus}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════
            SECTION D — SESSION INTELLIGENCE
        ════════════════════════════════════════════════════════════ */}
        <div className="rounded-xl border overflow-hidden" style={{ background: "#080f1c", borderColor: "#0d1f35" }}>
          <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "#0d1f35", background: "#050b16" }}>
            <div className="flex items-center gap-2">
              <Brain className="w-3.5 h-3.5" style={{ color: "#f472b6" }} />
              <span className="text-[11px] font-mono tracking-widest text-gray-400">SESSION INTELLIGENCE</span>
            </div>
            <Link href="/admin/session-intelligence">
              <span className="flex items-center gap-1 text-[10px] font-mono text-gray-600 hover:text-pink-400 transition-colors cursor-pointer">
                FULL VIEW <ExternalLink className="w-3 h-3" />
              </span>
            </Link>
          </div>
          <div className="p-4">
            <div className="rounded-lg p-4 text-center space-y-3" style={{ background: "#060b14", border: "1px solid #0d1f35" }}>
              <Brain className="w-6 h-6 mx-auto" style={{ color: "#f472b6" }} />
              <div className="text-[11px] font-mono text-gray-400">Per-session AI billing analysis — timeline replay, risk flags, and anomaly detection</div>
              <div className="flex items-center justify-center gap-4 text-[10px] font-mono text-gray-600">
                <span className="flex items-center gap-1"><Shield className="w-3 h-3" style={{ color: "#f472b6" }} /> Risk Flags</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" style={{ color: "#38bdf8" }} /> Event Timeline</span>
                <span className="flex items-center gap-1"><Eye className="w-3 h-3" style={{ color: "#4ade80" }} /> AI Analysis</span>
              </div>
              <Link href="/admin/session-intelligence">
                <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-mono cursor-pointer transition-all hover:brightness-125" style={{ background: "#f472b615", border: "1px solid #f472b630", color: "#f472b6" }}>
                  Search by Session ID <ExternalLink className="w-3 h-3" />
                </span>
              </Link>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════
            SECTION E — LIVE STREAM MONITOR
        ════════════════════════════════════════════════════════════ */}
        <div className="rounded-xl border overflow-hidden" style={{ background: "#080f1c", borderColor: "#0d1f35" }}>
          <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "#0d1f35", background: "#050b16" }}>
            <div className="flex items-center gap-2">
              <Radio className="w-3.5 h-3.5" style={{ color: "#4ade80" }} />
              <span className="text-[11px] font-mono tracking-widest text-gray-400">LIVE STREAM MONITOR</span>
              {(liveSessionsAdv.data?.summary?.orphanCount ?? 0) > 0 && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "#ef444415", color: "#ef4444" }}>
                  {liveSessionsAdv.data.summary.orphanCount} ORPHAN
                </span>
              )}
            </div>
            <Link href="/admin/live-sessions">
              <span className="flex items-center gap-1 text-[10px] font-mono text-gray-600 hover:text-green-400 transition-colors cursor-pointer">
                FULL VIEW <ExternalLink className="w-3 h-3" />
              </span>
            </Link>
          </div>
          <div className="p-4">
            {!liveSessionsAdv.data ? (
              <p className="text-[11px] font-mono text-gray-600 text-center py-4">Loading live sessions…</p>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {[
                    { label: "ACTIVE", value: liveSessionsAdv.data.summary?.totalActive ?? 0, color: "#4ade80" },
                    { label: "ORPHAN", value: liveSessionsAdv.data.summary?.orphanCount ?? 0, color: "#ef4444" },
                    { label: "CRITICAL", value: liveSessionsAdv.data.summary?.criticalCount ?? 0, color: "#f59e0b" },
                    { label: "WALLET LEFT", value: `${Math.round((liveSessionsAdv.data.summary?.totalWalletRemainingSeconds ?? 0) / 60)}m`, color: "#38bdf8" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg p-2 text-center" style={{ background: "#060b14", border: "1px solid #0d1f35" }}>
                      <div className="text-[9px] font-mono text-gray-600 tracking-wider mb-1">{label}</div>
                      <div className="text-sm font-bold font-mono" style={{ color }}>{String(value)}</div>
                    </div>
                  ))}
                </div>
                {(liveSessionsAdv.data.sessions ?? []).length === 0 ? (
                  <p className="text-[11px] font-mono text-gray-600 text-center py-2">No live sessions</p>
                ) : (
                  <div className="space-y-1">
                    {liveSessionsAdv.data.sessions.slice(0, 5).map((s: any) => (
                      <div key={s.sessionId} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{
                        background: "#060b14",
                        border: `1px solid ${s.isCritical ? "#ef444430" : s.isOrphan ? "#f59e0b30" : "#0d1f35"}`,
                      }}>
                        <div className="flex items-center gap-2">
                          {s.isOrphan ? <Ghost className="w-3 h-3" style={{ color: "#f59e0b" }} /> : <Radio className="w-3 h-3 animate-pulse" style={{ color: "#4ade80" }} />}
                          <span className="text-[11px] font-mono text-gray-400">{s.sessionId?.slice(0, 12)}…</span>
                          <span className="text-[10px] font-mono text-gray-600">{s.licenseKey?.slice(0, 6)}…</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-[10px] font-mono" style={{ color: "#38bdf8" }}>wallet: {s.wallet?.remainingMinutes?.toFixed(0) ?? "—"}m</div>
                            <div className="text-[10px] font-mono text-gray-600">real: {s.realStream?.remainingMinutes?.toFixed(0) ?? "—"}m</div>
                          </div>
                          {s.isCritical && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "#ef444415", color: "#ef4444" }}>CRIT</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════
            SECTION F — KEY USAGE
        ════════════════════════════════════════════════════════════ */}
        <div className="rounded-xl border overflow-hidden" style={{ background: "#080f1c", borderColor: "#0d1f35" }}>
          <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "#0d1f35", background: "#050b16" }}>
            <div className="flex items-center gap-2">
              <Key className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} />
              <span className="text-[11px] font-mono tracking-widest text-gray-400">KEY USAGE</span>
            </div>
            <Link href="/admin/key-usage">
              <span className="flex items-center gap-1 text-[10px] font-mono text-gray-600 hover:text-amber-400 transition-colors cursor-pointer">
                FULL VIEW <ExternalLink className="w-3 h-3" />
              </span>
            </Link>
          </div>
          <div className="p-4">
            {!keyUsageSummary.data ? (
              <p className="text-[11px] font-mono text-gray-600 text-center py-4">Loading key usage…</p>
            ) : (
              <div className="space-y-2">
                {(keyUsageSummary.data.keys ?? []).filter((k: any) => k.hasBeenUsed).slice(0, 6).map((k: any) => {
                  const pct = Math.min(100, Math.round(((k.usedSeconds ?? 0) / Math.max(1, (k.allocatedSeconds ?? 1))) * 100));
                  return (
                    <div key={k.id} className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <div className="flex items-center gap-2">
                          {k.isStreaming ? <Radio className="w-3 h-3 animate-pulse" style={{ color: "#4ade80" }} /> : <Key className="w-3 h-3" style={{ color: "#6b7280" }} />}
                          <span className="text-gray-400">{k.key?.slice(0, 10)}…</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span style={{ color: pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#4ade80" }}>{pct}%</span>
                          {k.lastStopReason && <span className="text-gray-600">{k.lastStopReason === "client_stop" ? "user stop" : k.lastStopReason === "out_of_time" ? "expired" : k.lastStopReason?.replace(/_/g, " ")}</span>}
                        </div>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: "#0d1f35" }}>
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#4ade80" }} />
                      </div>
                    </div>
                  );
                })}
                {(keyUsageSummary.data.keys ?? []).filter((k: any) => k.hasBeenUsed).length === 0 && (
                  <p className="text-[11px] font-mono text-gray-600 text-center py-2">No key usage yet</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════
            SECTION G — BILLING AUDIT (24h)
        ════════════════════════════════════════════════════════════ */}
        <div className="rounded-xl border overflow-hidden" style={{ background: "#080f1c", borderColor: "#0d1f35" }}>
          <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "#0d1f35", background: "#050b16" }}>
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5" style={{ color: "#22d3ee" }} />
              <span className="text-[11px] font-mono tracking-widest text-gray-400">BILLING AUDIT — LAST 24H</span>
            </div>
            <Link href="/admin/billing-audit">
              <span className="flex items-center gap-1 text-[10px] font-mono text-gray-600 hover:text-cyan-400 transition-colors cursor-pointer">
                FULL VIEW <ExternalLink className="w-3 h-3" />
              </span>
            </Link>
          </div>
          <div className="p-4">
            {!billingAuditStats.data ? (
              <p className="text-[11px] font-mono text-gray-600 text-center py-4">Loading audit data…</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {[
                    { label: "TOTAL DEBITED", value: `${Math.round((billingAuditStats.data.totalDebitedSec ?? 0) / 60)}m`, color: "#22d3ee" },
                    { label: "SESSIONS (24H)", value: billingAuditStats.data.totalSessions ?? "—", color: "#a78bfa" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg p-3 text-center" style={{ background: "#060b14", border: "1px solid #0d1f35" }}>
                      <div className="text-[10px] font-mono text-gray-600 tracking-wider mb-1">{label}</div>
                      <div className="text-sm font-bold font-mono" style={{ color }}>{String(value)}</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {Object.entries(billingAuditStats.data.eventCounts ?? {}).slice(0, 8).map(([type, count]: [string, any]) => {
                    const colorMap: Record<string, string> = {
                      connect: "#38bdf8", stream_start: "#4ade80", heartbeat_ok: "#4ade80",
                      heartbeat_exhausted: "#ef4444", stop: "#f59e0b", disconnect: "#f59e0b",
                      orphan_kill: "#ef4444", freeze_kill: "#ef4444", hard_kill: "#ef4444",
                      settle: "#22d3ee", token_issued: "#a78bfa",
                    };
                    const c = colorMap[type] ?? "#6b7280";
                    return (
                      <div key={type} className="flex items-center justify-between px-2 py-1.5 rounded" style={{ background: "#060b14", border: "1px solid #0d1f35" }}>
                        <span className="text-[10px] font-mono text-gray-500">{type.replace(/_/g, " ")}</span>
                        <span className="text-[10px] font-bold font-mono" style={{ color: c }}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        </div>
      </div>
    </AdminLayout>
  );
}
