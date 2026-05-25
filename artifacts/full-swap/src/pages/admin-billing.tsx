/**
 * admin-billing.tsx — Billing Rate Control Center
 *
 * The global billing rate controls how fast wallet minutes drain relative to
 * the real Decart API cost (2.3 cr/s).
 *
 * Key formula:
 *   deduction_rate   = billing_rate / 2.3
 *   real_stream_min  = wallet_min × (2.3 / billing_rate)
 *   profit_per_sec   = billing_rate - 2.3   (credits)
 *   margin %         = (billing_rate - 2.3) / 2.3 × 100  (profit-on-cost ratio)
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, CheckCircle2,
  Clock, Loader2, RefreshCw, RotateCcw, Save,
  Timer, TrendingUp, Wifi, Zap, DollarSign,
  Radio, Shield, Settings2, Users,
} from "lucide-react";
import { ProfitOptimizerPanel } from "@/components/profit-optimizer-panel";

const COST_RATE = 2.3; // Decart API fixed cost — fallback; prefer apiCostRate from API response

const authH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token") ?? ""}`,
});

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...opts, headers: { ...authH(), ...(opts?.headers ?? {}) } });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface RateInfo { rate: number; apiCostRate: number; realStreamMinutesPerLicenseHour: number; }
interface BrkKey {
  licenseKeyId: number; licenseKey: string; isActive: boolean;
  effectiveRate: number; usedSeconds: number; remainingSeconds: number;
  isLive: boolean; activeSessionCount: number; rateSource: string;
  customBillingRate: number | null; useCustomBillingRate: boolean;
  subAdminBillingRate?: number | null; subAdminUsername?: string | null;
}
interface BrkResponse { keys: BrkKey[]; globalBillingRate: number; apiCostRate: number; }
interface AuditRow {
  id: number; previousRate: number; newRate: number;
  changedByEmail: string | null; note: string | null; createdAt: string;
}

// ── Rate Profiles ─────────────────────────────────────────────────────────────
// Each profile sets the billing rate. Higher rate = more profit margin but
// shorter real streaming time per wallet-minute.
const PROFILES = [
  { id: "breakeven",  label: "BREAKEVEN", rate: 2.3,  color: "hsl(215 20% 55%)" },
  { id: "light",      label: "LIGHT",     rate: 3,    color: "#26de81"           },
  { id: "standard",   label: "STANDARD",  rate: 4,    color: "hsl(187 100% 52%)"},
  { id: "high",       label: "HIGH",      rate: 6,    color: "#fed330"           },
  { id: "max",        label: "MAX",       rate: 10,   color: "#fc5c65"           },
] as const;

// ── Math helpers ──────────────────────────────────────────────────────────────
/** Profit margin at a given billing rate */
function margin(rate: number, costRate = COST_RATE): number {
  return rate > 0 ? Math.round(((rate - costRate) / costRate) * 1000) / 10 : 0;
}
/** Real streaming minutes a wallet-hour yields at this billing rate */
function realMinPerWalletHour(rate: number, costRate = COST_RATE): number {
  return rate > 0 ? Math.round((60 * costRate / rate) * 10) / 10 : 60;
}
/** Real streaming seconds remaining from wallet seconds remaining */
function realStreamRemaining(walletSec: number, rate: number, costRate = COST_RATE): number {
  return rate > 0 ? Math.round(walletSec * costRate / rate) : walletSec;
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
  if (!k) return "—";
  return k.length > 14 ? `${k.slice(0, 8)}…${k.slice(-4)}` : k;
}
function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

function SCard({ label, value, sub, color, icon: Icon, pulse }: {
  label: string; value: string; sub?: string; color?: string; icon: any; pulse?: boolean;
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color: color ?? "hsl(215 20% 55%)" }} />
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</p>
        {pulse && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse ml-auto" />}
      </div>
      <p className="text-xl font-bold font-mono" style={{ color: color ?? "hsl(var(--foreground))" }}>{value}</p>
      {sub && <p className="text-[10px] font-mono text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

type TabId = "control" | "keys" | "audit" | "estimator" | "tokenwindow";

export default function AdminBillingPage() {
  const { toast } = useToast();
  const [tab, setTab]             = useState<TabId>("control");
  const [rateInfo, setRateInfo]   = useState<RateInfo | null>(null);
  const [brkData, setBrkData]     = useState<BrkResponse | null>(null);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  // Source API cost rate from backend response; fall back to module constant if not yet loaded
  const activeCostRate = rateInfo?.apiCostRate ?? brkData?.apiCostRate ?? COST_RATE;
  const [inputRate, setInputRate] = useState<string>("");
  const [saving, setSaving]       = useState(false);
  const [loading, setLoading]     = useState(true);
  const [lastPoll, setLastPoll]   = useState("");
  // Dynamic Rate Impact Preview
  const [previewMinutes, setPreviewMinutes] = useState<string>("60");
  // Per-key inline editing
  const [editingKeyId, setEditingKeyId]   = useState<number | null>(null);
  const [editRateVal, setEditRateVal]     = useState<string>("");
  const [savingKeyId, setSavingKeyId]     = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const twPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [estWalletMins, setEstWalletMins] = useState("60");
  const [estRate, setEstRate]             = useState("");

  // ── Token Window Tab State ─────────────────────────────────────────────────
  interface TwSession {
    sessionId: number; licenseKey: string; apiKey: string;
    tokenWindowMinutes: number; remainingTokenMinutes: number;
    elapsedMinutes: number; sessionStartTime: string; lastHeartbeatAt: string | null;
    sessionStatus: "ACTIVE" | "EXPIRED" | "BLOCKED" | "TERMINATED";
    decartStreamStatus: string; minutesAllocated: number;
    remainingWalletSeconds: number; isNewKey: boolean;
  }
  interface TwSubAdmin { id: number; username: string; email: string; defaultTokenWindowMinutes: number | null; }
  const [twSessions, setTwSessions]               = useState<TwSession[]>([]);
  const [twSessionsLoading, setTwSessionsLoading] = useState(false);
  const [twGlobal, setTwGlobal]                   = useState<number | null>(null);
  const [twGlobalInput, setTwGlobalInput]         = useState("");
  const [twGlobalSaving, setTwGlobalSaving]       = useState(false);
  const [twSubAdmins, setTwSubAdmins]             = useState<TwSubAdmin[]>([]);
  const [twSubAdminsLoading, setTwSubAdminsLoading] = useState(false);
  const [twSaEditId, setTwSaEditId]               = useState<number | null>(null);
  const [twSaEditVal, setTwSaEditVal]             = useState("");
  const [twSaSaving, setTwSaSaving]               = useState<number | null>(null);
  const [twKeyInput, setTwKeyInput]               = useState("");
  const [twKeyMinutes, setTwKeyMinutes]           = useState("");
  const [twKeySaving, setTwKeySaving]             = useState(false);
  const [twLastPoll, setTwLastPoll]               = useState("");

  const fetchTwSessions = useCallback(async () => {
    setTwSessionsLoading(true);
    const data = await apiFetch<{ sessions: TwSession[]; count: number }>("/api/admin/token-window/sessions");
    if (data) setTwSessions(data.sessions ?? []);
    setTwLastPoll(new Date().toLocaleTimeString());
    setTwSessionsLoading(false);
  }, []);

  const fetchTwGlobal = useCallback(async () => {
    const data = await apiFetch<{ globalDefaultTokenWindowMinutes: number }>("/api/admin/token-window/global");
    if (data) { setTwGlobal(data.globalDefaultTokenWindowMinutes); setTwGlobalInput(v => v === "" ? String(data.globalDefaultTokenWindowMinutes) : v); }
  }, []);

  const fetchTwSubAdmins = useCallback(async () => {
    setTwSubAdminsLoading(true);
    const data = await apiFetch<any[]>("/api/admin/users?role=sub_admin");
    if (data && Array.isArray(data)) setTwSubAdmins(data as TwSubAdmin[]);
    setTwSubAdminsLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "tokenwindow") {
      fetchTwSessions(); fetchTwGlobal(); fetchTwSubAdmins();
      twPollRef.current = setInterval(fetchTwSessions, 5000);
    } else {
      if (twPollRef.current) { clearInterval(twPollRef.current); twPollRef.current = null; }
    }
    return () => { if (twPollRef.current) { clearInterval(twPollRef.current); twPollRef.current = null; } };
  }, [tab, fetchTwSessions, fetchTwGlobal, fetchTwSubAdmins]);

  const saveGlobalTw = async () => {
    const m = parseFloat(twGlobalInput);
    if (!Number.isFinite(m) || m < 1 || m > 480) {
      toast({ title: "Invalid value", description: "Enter minutes between 1 and 480", variant: "destructive" }); return;
    }
    setTwGlobalSaving(true);
    const res = await fetch("/api/admin/token-window/global", { method: "PUT", headers: authH(), body: JSON.stringify({ minutes: m }) });
    setTwGlobalSaving(false);
    if (res.ok) { toast({ title: "Global token window updated", description: `Set to ${m} minutes` }); fetchTwGlobal(); }
    else { const b = await res.json().catch(() => ({})); toast({ title: "Failed", description: b.error ?? "Error", variant: "destructive" }); }
  };

  const saveSaTw = async (id: number) => {
    const m = parseFloat(twSaEditVal);
    if (!Number.isFinite(m) || m < 1 || m > 480) {
      toast({ title: "Invalid value", description: "Enter minutes between 1 and 480", variant: "destructive" }); return;
    }
    setTwSaSaving(id);
    const res = await fetch(`/api/admin/token-window/sub-admin/${id}`, { method: "PUT", headers: authH(), body: JSON.stringify({ minutes: m }) });
    setTwSaSaving(null);
    if (res.ok) {
      toast({ title: "Sub-admin token window updated" });
      setTwSaEditId(null);
      setTwSubAdmins(prev => prev.map(sa => sa.id === id ? { ...sa, defaultTokenWindowMinutes: m } : sa));
    } else { const b = await res.json().catch(() => ({})); toast({ title: "Failed", description: b.error ?? "Error", variant: "destructive" }); }
  };

  const saveKeyTw = async () => {
    const key = twKeyInput.trim().toUpperCase();
    const m   = parseFloat(twKeyMinutes);
    if (!key) { toast({ title: "Enter a license key", variant: "destructive" }); return; }
    if (!Number.isFinite(m) || m < 1 || m > 480) { toast({ title: "Enter minutes 1–480", variant: "destructive" }); return; }
    setTwKeySaving(true);
    const res = await fetch(`/api/admin/token-window/key/${encodeURIComponent(key)}`, { method: "PUT", headers: authH(), body: JSON.stringify({ minutes: m }) });
    setTwKeySaving(false);
    if (res.ok) { toast({ title: "Per-key token window set", description: `${key} → ${m} min` }); setTwKeyInput(""); setTwKeyMinutes(""); }
    else { const b = await res.json().catch(() => ({})); toast({ title: "Failed", description: b.error ?? "Error", variant: "destructive" }); }
  };

  const fetchLive = useCallback(async () => {
    const [ri, brk] = await Promise.all([
      apiFetch<RateInfo>("/api/admin/billing-rate"),
      apiFetch<BrkResponse>("/api/admin/billing-rate-per-key?limit=500"),
    ]);
    if (ri) {
      setRateInfo(ri);
      setInputRate(v => v === "" ? String(ri.rate) : v);
    }
    if (brk) setBrkData(brk);
    setLastPoll(new Date().toLocaleTimeString());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLive();
    timerRef.current = setInterval(fetchLive, 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchLive]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    const data = await apiFetch<AuditRow[]>("/api/admin/billing-rate/audit");
    if (data) setAuditRows(data);
    setAuditLoading(false);
  }, []);

  useEffect(() => { if (tab === "audit") loadAudit(); }, [tab, loadAudit]);

  const currentRate  = rateInfo?.rate ?? null;
  const inputVal     = parseFloat(inputRate);
  const previewRate: number | null = Number.isFinite(inputVal) && inputVal > 0 ? inputVal : currentRate;
  const dirty        = currentRate !== null && inputVal !== currentRate;

  const save = async () => {
    if (!Number.isFinite(inputVal) || inputVal < 0.1 || inputVal > 100) {
      toast({ title: "Invalid rate", description: "Must be a number between 0.1 and 100", variant: "destructive" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/admin/billing-rate", {
      method: "PUT",
      headers: authH(),
      body: JSON.stringify({ rate: inputVal }),
    });
    setSaving(false);
    if (res.ok) {
      toast({
        title: "Billing rate updated",
        description: `New rate: ${inputVal} cr/s · Margin: ${margin(inputVal)}% · ${realMinPerWalletHour(inputVal)}m real stream per wallet-hour`,
      });
      fetchLive();
      if (tab === "audit") loadAudit();
    } else {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Failed to update", description: body.error ?? "Unknown error", variant: "destructive" });
    }
  };

  // Aggregate per-key data
  const keys         = Array.isArray(brkData?.keys) ? brkData!.keys : [];
  const activeStreams = keys.filter(k => k.isLive).length;
  const totalWalletUsed = keys.reduce((a, k) => a + k.usedSeconds, 0);
  // Total revenue = SUM(used_seconds × effective_rate) per key
  const totalRevenue = Math.round(keys.reduce((a, k) => a + k.usedSeconds * k.effectiveRate, 0) * 100) / 100;
  // Total Decart cost = SUM(real_stream_sec × 2.3) per key
  const totalCost    = Math.round(keys.reduce((a, k) => {
    const realSec = k.effectiveRate > 0 ? k.usedSeconds * activeCostRate / k.effectiveRate : k.usedSeconds;
    return a + realSec * activeCostRate;
  }, 0) * 100) / 100;
  const totalProfit  = Math.round((totalRevenue - totalCost) * 100) / 100;

  // Nearest profile for current rate
  const nearestProfile = currentRate != null
    ? PROFILES.reduce((best, p) =>
        Math.abs(p.rate - currentRate) < Math.abs(best.rate - currentRate) ? p : best
      )
    : null;
  const inputProfile = previewRate != null
    ? PROFILES.reduce((best, p) =>
        Math.abs(p.rate - previewRate) < Math.abs(best.rate - previewRate) ? p : best
      )
    : null;

  // Per-key custom rate helpers
  const saveCustomRate = async (keyId: number) => {
    const rateNum = parseFloat(editRateVal);
    if (!Number.isFinite(rateNum) || rateNum < 0.1) {
      toast({ title: "Invalid rate", description: "Must be ≥ 0.1 cr/s", variant: "destructive" });
      return;
    }
    setSavingKeyId(keyId);
    const res = await fetch(`/api/admin/billing-rate-per-key/${keyId}`, {
      method: "PUT",
      headers: authH(),
      body: JSON.stringify({ customBillingRate: rateNum, useCustomBillingRate: true }),
    });
    setSavingKeyId(null);
    if (res.ok) {
      toast({ title: "Custom rate set", description: `Key #${keyId} → ${rateNum} cr/s (${margin(rateNum)}% margin)` });
      setEditingKeyId(null);
      fetchLive();
    } else {
      const b = await res.json().catch(() => ({}));
      toast({ title: "Failed", description: b.error ?? "Unknown error", variant: "destructive" });
    }
  };
  const revertToGlobal = async (keyId: number) => {
    setSavingKeyId(keyId);
    const res = await fetch(`/api/admin/billing-rate-per-key/${keyId}/custom`, {
      method: "DELETE", headers: authH(),
    });
    setSavingKeyId(null);
    if (res.ok) {
      toast({ title: "Reverted to global rate", description: `Key #${keyId} now uses global billing rate` });
      fetchLive();
    } else {
      toast({ title: "Failed to revert", variant: "destructive" });
    }
  };

  // Dynamic Rate Impact Preview — based on user-supplied previewMinutes
  const prevMins      = Math.max(0, parseFloat(previewMinutes) || 60);
  const prevSecs      = prevMins * 60;
  const previewMargin = previewRate != null ? margin(previewRate) : null;
  // Real streaming seconds the wallet gives at this billing rate
  const previewRealSec    = previewRate != null ? Math.round(prevSecs * activeCostRate / previewRate) : null;
  const previewRealMin    = previewRealSec != null ? Math.round(previewRealSec / 60 * 10) / 10 : null;
  // Revenue = wallet_seconds × billing_rate
  const previewRevenue    = previewRate != null ? Math.round(prevSecs * previewRate * 100) / 100 : null;
  // Decart cost = real_stream_seconds × 2.3
  const previewDecartCost = previewRealSec != null ? Math.round(previewRealSec * activeCostRate * 100) / 100 : null;
  // Profit = revenue - cost
  const previewProfit     = previewRevenue != null && previewDecartCost != null
    ? Math.round((previewRevenue - previewDecartCost) * 100) / 100 : null;

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: "control",     label: "Rate Control",     icon: Zap       },
    { id: "keys",        label: "Per-Key Monitor",  icon: Activity  },
    { id: "audit",       label: "Change Log",       icon: RotateCcw },
    { id: "estimator",   label: "Runtime Estimator",icon: BarChart3 },
    { id: "tokenwindow", label: "Token Window",     icon: Shield    },
  ];

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 lg:p-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <DollarSign className="w-6 h-6 text-primary" />
              Billing Rate Control Center
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Set the billing rate · Controls wallet drain speed &amp; profit margin vs Decart API cost (2.3 cr/s)
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastPoll && <span className="text-xs text-muted-foreground font-mono">{lastPoll}</span>}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: "rgba(38,222,129,0.1)", border: "1px solid rgba(38,222,129,0.3)" }}>
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400 font-mono font-semibold">LIVE 3s</span>
            </div>
            <button onClick={fetchLive} className="text-muted-foreground hover:text-foreground transition-colors">
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
            {/* ── Live Summary Cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SCard
                label="Global Billing Rate"
                value={currentRate != null ? `${currentRate} cr/s` : "—"}
                sub={nearestProfile?.label ?? "Loading…"}
                color="hsl(187 100% 52%)"
                icon={Zap}
                pulse
              />
              <SCard
                label="Profit Margin"
                value={currentRate != null ? `${margin(currentRate)}%` : "—"}
                sub={currentRate != null ? `${Math.round((currentRate - activeCostRate) * 100) / 100} cr/s profit` : ""}
                color={currentRate != null && currentRate > activeCostRate ? "#26de81" : "#fc5c65"}
                icon={TrendingUp}
              />
              <SCard
                label="Real Stream per Wallet-Hour"
                value={currentRate != null ? `${realMinPerWalletHour(currentRate)}m` : "—"}
                sub="real streaming minutes per 60 wallet-min"
                color="hsl(var(--foreground))"
                icon={Clock}
              />
              <SCard
                label="Active Streams"
                value={String(activeStreams)}
                sub="live right now"
                color={activeStreams > 0 ? "#26de81" : "hsl(215 20% 55%)"}
                icon={Wifi}
                pulse={activeStreams > 0}
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SCard
                label="Total Wallet Seconds Used"
                value={fmtSec(totalWalletUsed)}
                sub="billing seconds across all keys"
                color="hsl(var(--foreground))"
                icon={Timer}
              />
              <SCard
                label="Total Revenue"
                value={`${totalRevenue} cr`}
                sub="wallet_used × billing_rate"
                color="hsl(187 100% 52%)"
                icon={BarChart3}
              />
              <SCard
                label="Total Decart Cost"
                value={`${totalCost} cr`}
                sub="real_stream_sec × 2.3 fixed"
                color="hsl(215 20% 55%)"
                icon={Zap}
              />
              <SCard
                label="Net Profit"
                value={`${totalProfit} cr`}
                sub="revenue − decart cost"
                color={totalProfit >= 0 ? "#26de81" : "#fc5c65"}
                icon={DollarSign}
              />
            </div>

            {/* ── Tab Nav ── */}
            <div className="flex gap-1 border-b border-border">
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap"
                  style={tab === t.id
                    ? { borderColor: "hsl(var(--primary))", color: "hsl(var(--primary))" }
                    : { borderColor: "transparent", color: "hsl(215 20% 55%)" }}>
                  <t.icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              ))}
            </div>

            {/* ════════ RATE CONTROL ════════ */}
            {tab === "control" && (
              <div className="space-y-6">

                {/* Current Rate Banner */}
                <div className="rounded-xl p-5 flex items-center gap-6 flex-wrap"
                  style={{ background: "hsl(222 44% 5%)", border: `2px solid ${nearestProfile?.color ?? "hsl(222 40% 14%)"}30` }}>
                  <div>
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Active Billing Profile</p>
                    <p className="text-4xl font-black font-mono" style={{ color: nearestProfile?.color ?? "hsl(215 20% 55%)" }}>
                      {nearestProfile?.label ?? "—"}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 text-xs font-mono">
                    <span className="text-muted-foreground">Rate: <span className="text-foreground font-bold">{currentRate ?? "—"} cr/s</span></span>
                    <span className="text-muted-foreground">Margin: <span style={{ color: nearestProfile?.color ?? "hsl(215 20% 55%)" }} className="font-bold">{currentRate != null ? `${margin(currentRate)}%` : "—"}</span></span>
                    <span className="text-muted-foreground">Decart Cost: <span className="text-foreground font-bold">{activeCostRate} cr/s fixed</span></span>
                  </div>
                  <div className="ml-auto flex flex-col items-end gap-1">
                    <p className="text-[10px] font-mono text-muted-foreground">Profit Margin Meter</p>
                    <div className="w-48 h-3 rounded-full overflow-hidden" style={{ background: "hsl(222 44% 11%)" }}>
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.min(100, Math.max(0, currentRate != null ? margin(currentRate) : 0))}%`,
                          background: `linear-gradient(90deg, #26de81, ${nearestProfile?.color ?? "hsl(215 20% 55%)"})`,
                        }} />
                    </div>
                    <p className="text-[10px] font-mono" style={{ color: nearestProfile?.color ?? "hsl(215 20% 55%)" }}>
                      {currentRate != null ? `${margin(currentRate)}% margin` : "—"}
                    </p>
                  </div>
                </div>

                {/* Profile Selector */}
                <div className="rounded-xl p-5 space-y-5"
                  style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                  <div>
                    <p className="text-sm font-bold font-mono text-foreground mb-1">Billing Rate Profiles</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      Higher rate = faster wallet drain + more profit. Changes apply immediately on next heartbeat.
                    </p>
                  </div>

                  {/* Profile buttons */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {PROFILES.map(p => {
                      const isActive = Math.abs(inputVal - p.rate) < 0.05;
                      const m = margin(p.rate);
                      const realMin = realMinPerWalletHour(p.rate);
                      return (
                        <button key={p.id}
                          onClick={() => setInputRate(String(p.rate))}
                          className="flex flex-col items-center gap-1 px-3 py-4 rounded-xl border transition-all duration-200"
                          style={isActive
                            ? { background: `${p.color}15`, border: `2px solid ${p.color}`, boxShadow: `0 0 16px ${p.color}20` }
                            : { background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 16%)" }}>
                          <p className="text-xs font-mono font-black" style={{ color: isActive ? p.color : "hsl(215 20% 55%)" }}>
                            {p.label}
                          </p>
                          <p className="text-base font-bold font-mono" style={{ color: isActive ? p.color : "hsl(var(--foreground))" }}>
                            {m}%
                          </p>
                          <p className="text-[10px] font-mono text-muted-foreground text-center leading-tight">{p.rate} cr/s</p>
                          <p className="text-[9px] font-mono text-muted-foreground text-center">{realMin}m/hr real</p>
                        </button>
                      );
                    })}
                  </div>

                  {/* Slider */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                      <span>2.3 cr/s (0% margin)</span>
                      <span className="font-bold" style={{ color: inputProfile?.color ?? "hsl(215 20% 55%)" }}>
                        {previewRate != null
                          ? `${Number.isFinite(inputVal) ? inputVal : previewRate} cr/s → ${margin(previewRate)}% margin`
                          : "Loading…"}
                      </span>
                      <span>10+ cr/s (77%+ margin)</span>
                    </div>
                    <input
                      type="range" min="2.3" max="12" step="0.1"
                      value={Number.isFinite(inputVal) ? inputVal : (previewRate ?? "")}
                      onChange={e => setInputRate(e.target.value)}
                      disabled={previewRate == null}
                      className="w-full accent-primary disabled:opacity-40"
                      style={{ accentColor: inputProfile?.color ?? "hsl(var(--primary))" }}
                    />
                  </div>

                  {/* Custom input + save */}
                  <div className="flex items-center gap-3 flex-wrap pt-1">
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2"
                      style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 18%)" }}>
                      <span className="text-[10px] font-mono text-muted-foreground">Rate:</span>
                      <input
                        type="number" min="0.1" max="100" step="0.1"
                        value={inputRate}
                        onChange={e => setInputRate(e.target.value)}
                        className="w-16 bg-transparent text-sm font-mono font-bold text-foreground focus:outline-none"
                        style={{ color: inputProfile?.color ?? "hsl(215 20% 55%)" }}
                      />
                      <span className="text-[10px] font-mono text-muted-foreground">cr/s</span>
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">
                      → <span style={{ color: "hsl(187 100% 52%)" }} className="font-bold">
                        {previewRate != null ? `${margin(previewRate)}% margin` : "—"}
                      </span>
                    </div>
                    <button onClick={save} disabled={saving || !dirty}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono font-bold transition-all disabled:opacity-40"
                      style={dirty && inputProfile
                        ? { background: `${inputProfile.color}18`, color: inputProfile.color, border: `1px solid ${inputProfile.color}40` }
                        : { background: "hsl(222 44% 4%)", color: "hsl(215 20% 55%)", border: "1px solid hsl(222 40% 18%)" }}>
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      {saving ? "Applying…" : dirty ? "Apply Rate" : "Saved"}
                    </button>
                    {dirty && currentRate !== null && (
                      <button onClick={() => setInputRate(String(currentRate))}
                        className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors">
                        Reset
                      </button>
                    )}
                  </div>

                  {inputVal > 20 && (
                    <div className="flex items-center gap-2 text-xs font-mono p-3 rounded-lg"
                      style={{ background: "rgba(252,92,101,0.08)", border: "1px solid rgba(252,92,101,0.25)", color: "#fc5c65" }}>
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      Very high billing rate. Wallet minutes will drain much faster than real time. Confirm intent before applying.
                    </div>
                  )}
                </div>

                {/* Rate Impact Preview */}
                <div className="rounded-xl p-5 space-y-4"
                  style={{ background: "hsl(222 44% 5%)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                      <p className="text-xs font-mono font-bold uppercase tracking-wider" style={{ color: "hsl(187 100% 52%)" }}>
                        Rate Impact Preview — {inputProfile?.label ?? "Loading…"} ({previewRate} cr/s)
                      </p>
                    </div>
                    {/* Dynamic minutes input */}
                    <div className="flex items-center gap-2 rounded-lg px-3 py-1.5"
                      style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 18%)" }}>
                      <span className="text-[10px] font-mono text-muted-foreground">Wallet minutes:</span>
                      <input
                        type="number" min="1" max="99999" step="1"
                        value={previewMinutes}
                        onChange={e => setPreviewMinutes(e.target.value)}
                        className="w-16 bg-transparent text-sm font-mono font-bold text-foreground focus:outline-none"
                        style={{ color: "hsl(187 100% 52%)" }}
                      />
                      <span className="text-[10px] font-mono text-muted-foreground">min</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Wallet → Real Stream */}
                    <div className="rounded-lg p-4 space-y-3" style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 12%)" }}>
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                        {prevMins} Wallet-Minutes gives →
                      </p>
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="text-3xl font-black font-mono text-foreground">
                            {prevMins}<span className="text-lg">m</span>
                          </p>
                          <p className="text-[10px] font-mono text-muted-foreground">wallet allocation</p>
                        </div>
                        <ArrowRight className="w-5 h-5 text-primary shrink-0" />
                        <div>
                          <p className="text-3xl font-black font-mono" style={{ color: "hsl(187 100% 52%)" }}>
                            {previewRealMin != null ? <>{previewRealMin}<span className="text-lg">m</span></> : "—"}
                          </p>
                          <p className="text-[10px] font-mono text-muted-foreground">real streaming minutes</p>
                        </div>
                      </div>
                      <p className="text-[11px] font-mono text-muted-foreground">
                        Deduction speed: <span className="text-foreground font-bold">
                          {previewRate != null ? `${Math.round(previewRate / activeCostRate * 1000) / 1000}× faster` : "—"}
                        </span> than real time at {activeCostRate} cr/s base
                      </p>
                    </div>

                    {/* Profit breakdown */}
                    <div className="rounded-lg p-4 space-y-3" style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 12%)" }}>
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                        Per {prevMins} Wallet-Minutes Sold
                      </p>
                      <div className="space-y-2 font-mono text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Revenue charged</span>
                          <span className="text-foreground font-bold">{previewRevenue != null ? `${previewRevenue} cr` : "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Decart API cost</span>
                          <span className="text-foreground font-bold">{previewDecartCost != null ? `${previewDecartCost} cr` : "—"}</span>
                        </div>
                        <div className="h-px" style={{ background: "hsl(222 40% 14%)" }} />
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Net profit</span>
                          <span className="font-bold" style={{ color: previewProfit != null && previewProfit >= 0 ? "#26de81" : "#fc5c65" }}>
                            {previewProfit != null ? `${previewProfit} cr` : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Margin</span>
                          <span className="font-bold" style={{ color: "hsl(187 100% 52%)" }}>
                            {previewMargin != null ? `${previewMargin}%` : "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Quick metric row */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                    {[
                      { label: "Billing Rate",           value: previewRate != null ? `${previewRate} cr/s` : "—" },
                      { label: "Decart Base Cost",        value: `${activeCostRate} cr/s` },
                      { label: "Profit per Hr Streamed",  value: previewRate != null ? `${Math.round((previewRate - activeCostRate) * 3600)} cr` : "—" },
                      { label: "Margin",                  value: previewMargin != null ? `${previewMargin}%` : "—" },
                    ].map(m => (
                      <div key={m.label} className="rounded-lg px-3 py-2 text-center"
                        style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 12%)" }}>
                        <p className="text-[9px] text-muted-foreground mb-1 uppercase tracking-wider">{m.label}</p>
                        <p className="font-bold text-foreground">{m.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ════════ PROFIT OPTIMIZER ════════ */}
            {tab === "control" && (
              <ProfitOptimizerPanel
                billingRate={currentRate ?? undefined}
                showCurve
                showKeyTable={false}
                simulationSec={3600}
              />
            )}

            {/* ════════ PER-KEY MONITOR ════════ */}
            {tab === "keys" && (
              <div className="space-y-4">
                <div className="rounded-lg p-4" style={{ background: "hsl(222 44% 5%)", border: "1px solid hsl(187 100% 52% / 0.15)" }}>
                  <p className="text-xs font-mono" style={{ color: "hsl(187 100% 52%)" }}>
                    <strong>Per-Key Billing Monitor.</strong> Source: CUSTOM (license override) → SUB-ADMIN (sub-admin rate) → GLOBAL (system default). Revenue = wallet_used × billing_rate.
                    Real stream remaining = wallet_remaining × 2.3 / billing_rate. Click <strong>SET</strong> on any row to set a custom rate for that key.
                  </p>
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: "hsl(222 44% 6%)" }}>
                          {["Licence Key","Source","Effective Rate","Wallet Used","Wallet Rem","Real Stream Rem","Revenue","Decart Cost","Profit","Margin","Live","Action"].map(h => (
                            <th key={h} className="px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-right first:text-left last:text-center">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {keys.length === 0 ? (
                          <tr><td colSpan={12} className="text-center py-12 text-muted-foreground font-mono text-sm">No licence keys found</td></tr>
                        ) : keys.map(k => {
                          const rate       = k.effectiveRate;
                          const realRemSec = realStreamRemaining(k.remainingSeconds, rate);
                          const revenue    = Math.round(k.usedSeconds * rate * 100) / 100;
                          const realUsed   = rate > 0 ? k.usedSeconds * activeCostRate / rate : k.usedSeconds;
                          const cost       = Math.round(realUsed * activeCostRate * 100) / 100;
                          const profit     = Math.round((revenue - cost) * 100) / 100;
                          const marginPct  = margin(rate);
                          const isEditing  = editingKeyId === k.licenseKeyId;
                          const isSaving   = savingKeyId === k.licenseKeyId;
                          return (
                            <tr key={k.licenseKeyId} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}
                              className={k.isLive ? "bg-green-400/[0.02]" : ""}>
                              <td className="px-3 py-2.5 font-mono text-foreground whitespace-nowrap">
                                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${k.isActive ? "bg-green-400" : "bg-muted"}`} />
                                <span title={k.licenseKey}>{fmtKey(k.licenseKey)}</span>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                                  style={k.rateSource === "custom"
                                    ? { background: "hsl(187 100% 52% / 0.12)", color: "hsl(187 100% 52%)" }
                                    : k.rateSource === "sub_admin"
                                    ? { background: "hsl(271 76% 53% / 0.12)", color: "hsl(271 76% 75%)" }
                                    : { background: "hsl(222 40% 14%)", color: "hsl(215 20% 55%)" }}>
                                  {k.rateSource === "custom" ? "CUSTOM" : k.rateSource === "sub_admin" ? "SUB-ADMIN" : "GLOBAL"}
                                </span>
                                {k.rateSource === "sub_admin" && k.subAdminBillingRate != null && (
                                  <span className="block text-[8px] font-mono mt-0.5" style={{ color: "hsl(271 76% 60%)" }}>
                                    {k.subAdminUsername ?? ""} ({k.subAdminBillingRate} cr/s)
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-foreground">{rate} cr/s</td>
                              <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmtSec(k.usedSeconds)}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmtSec(k.remainingSeconds)}</td>
                              <td className="px-3 py-2.5 text-right font-mono"
                                style={{ color: k.remainingSeconds > 0 ? "#26de81" : "#fc5c65" }}>
                                {fmtSec(realRemSec)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono" style={{ color: "hsl(187 100% 52%)" }}>
                                {revenue} cr
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                                {cost} cr
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono"
                                style={{ color: profit >= 0 ? "#26de81" : "#fc5c65" }}>
                                {profit >= 0 ? `+${profit}` : profit} cr
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono"
                                style={{ color: marginPct > 0 ? "#26de81" : "#fc5c65" }}>
                                {marginPct}%
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                {k.isLive
                                  ? <span className="inline-flex items-center gap-1 text-[10px] font-mono text-green-400">
                                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />LIVE
                                    </span>
                                  : <span className="text-[10px] font-mono text-muted-foreground">idle</span>}
                              </td>
                              {/* ── Inline Rate Editor ── */}
                              <td className="px-3 py-2 text-center">
                                {isEditing ? (
                                  <div className="flex items-center gap-1 justify-center">
                                    <input
                                      type="number" min="0.1" max="100" step="0.1"
                                      value={editRateVal}
                                      onChange={e => setEditRateVal(e.target.value)}
                                      className="w-14 rounded px-1 py-0.5 text-xs font-mono font-bold focus:outline-none"
                                      style={{ background: "hsl(222 44% 8%)", border: "1px solid hsl(187 100% 52% / 0.4)", color: "hsl(187 100% 52%)" }}
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => saveCustomRate(k.licenseKeyId)}
                                      disabled={isSaving}
                                      className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors disabled:opacity-40"
                                      style={{ background: "hsl(187 100% 52% / 0.15)", color: "hsl(187 100% 52%)", border: "1px solid hsl(187 100% 52% / 0.3)" }}>
                                      {isSaving ? "…" : "✓"}
                                    </button>
                                    <button
                                      onClick={() => setEditingKeyId(null)}
                                      disabled={isSaving}
                                      className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors">
                                      ✕
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 justify-center">
                                    <button
                                      onClick={() => { setEditingKeyId(k.licenseKeyId); setEditRateVal(String(rate)); }}
                                      className="px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors"
                                      style={{ background: "hsl(222 40% 10%)", color: "hsl(215 20% 65%)", border: "1px solid hsl(222 40% 18%)" }}>
                                      SET
                                    </button>
                                    {k.rateSource === "custom" && (
                                      <button
                                        onClick={() => revertToGlobal(k.licenseKeyId)}
                                        disabled={isSaving}
                                        title="Revert to global rate"
                                        className="px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors disabled:opacity-40"
                                        style={{ background: "rgba(252,92,101,0.08)", color: "#fc5c65", border: "1px solid rgba(252,92,101,0.2)" }}>
                                        {isSaving ? "…" : "↩"}
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ════════ CHANGE LOG ════════ */}
            {tab === "audit" && (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                <div className="flex items-center justify-between px-4 py-3"
                  style={{ background: "hsl(222 44% 6%)", borderBottom: "1px solid hsl(222 40% 11%)" }}>
                  <p className="text-sm font-mono font-bold text-foreground flex items-center gap-2">
                    <RotateCcw className="w-4 h-4" /> Billing Rate Change History
                  </p>
                  <button onClick={loadAudit} disabled={auditLoading}
                    className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
                    <RefreshCw className={`w-4 h-4 ${auditLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>
                {auditLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : auditRows.length === 0 ? (
                  <div className="py-12 text-center">
                    <CheckCircle2 className="w-7 h-7 mx-auto mb-3 text-muted-foreground opacity-40" />
                    <p className="text-sm font-mono text-muted-foreground">No rate changes recorded yet</p>
                  </div>
                ) : auditRows.map(row => (
                  <div key={row.id} className="flex items-start gap-4 px-4 py-4"
                    style={{ borderTop: "1px solid hsl(222 40% 11%)" }}>
                    <div className="flex items-center gap-2 shrink-0 font-mono text-sm">
                      <span className="text-muted-foreground">{row.previousRate} cr/s</span>
                      <ArrowRight className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="font-bold text-foreground">{row.newRate} cr/s</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono ml-1"
                        style={{ background: "hsl(187 100% 52% / 0.1)", color: "hsl(187 100% 52%)" }}>
                        {margin(row.previousRate)}% → {margin(row.newRate)}% margin
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-foreground">
                        {row.changedByEmail ?? <span className="text-muted-foreground">Unknown admin</span>}
                      </p>
                      <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{fmtDate(row.createdAt)}</p>
                      {row.note && <p className="text-[10px] font-mono text-muted-foreground mt-0.5 italic">{row.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ════════ RUNTIME ESTIMATOR ════════ */}
            {tab === "estimator" && (() => {
              const estRateNum   = parseFloat(estRate) || (currentRate ?? 4);
              const estMinsNum   = Math.max(1, parseFloat(estWalletMins) || 60);
              const estSecs      = estMinsNum * 60;
              const estRealSec   = estRateNum > 0 ? Math.round(estSecs * activeCostRate / estRateNum) : estSecs;
              const estRealMin   = Math.round(estRealSec / 60 * 10) / 10;
              const estRevenue   = Math.round(estSecs * estRateNum * 100) / 100;
              const estCost      = Math.round(estRealSec * activeCostRate * 100) / 100;
              const estProfit    = Math.round((estRevenue - estCost) * 100) / 100;
              const estMarginPct = estRateNum > 0 ? Math.round(((estRateNum - activeCostRate) / estRateNum) * 1000) / 10 : 0;
              const estDrainSpd  = estRateNum > 0 ? Math.round(estRateNum / activeCostRate * 1000) / 1000 : 1;
              const estProfitHr  = Math.round((estRateNum - activeCostRate) * 3600);
              return (
                <div className="space-y-6">
                  <div className="rounded-lg p-4" style={{ background: "hsl(187 100% 52% / 0.06)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
                    <p className="text-xs font-mono" style={{ color: "hsl(187 100% 52%)" }}>
                      <strong>Runtime Estimator</strong> — Enter any billing rate + wallet allocation to preview real stream time, profit, and efficiency before committing.
                    </p>
                  </div>

                  {/* Inputs */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl p-5 space-y-3" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                      <p className="text-xs font-mono font-bold text-foreground uppercase tracking-wider">Billing Rate</p>
                      <div className="flex items-center gap-3">
                        <input type="number" min="0.1" max="100" step="0.1"
                          value={estRate || String(currentRate ?? 4)}
                          onChange={e => setEstRate(e.target.value)}
                          className="flex-1 rounded-lg px-3 py-2 text-lg font-mono font-bold focus:outline-none"
                          style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 20%)", color: "hsl(187 100% 52%)" }} />
                        <span className="text-sm font-mono text-muted-foreground">cr/s</span>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {PROFILES.map(p => (
                          <button key={p.id} onClick={() => setEstRate(String(p.rate))}
                            className="px-2 py-1 rounded text-[10px] font-mono font-bold transition-colors"
                            style={Math.abs(estRateNum - p.rate) < 0.05
                              ? { background: `${p.color}20`, color: p.color, border: `1px solid ${p.color}50` }
                              : { background: "hsl(222 44% 4%)", color: "hsl(215 20% 55%)", border: "1px solid hsl(222 40% 18%)" }}>
                            {p.label} {p.rate}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl p-5 space-y-3" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                      <p className="text-xs font-mono font-bold text-foreground uppercase tracking-wider">Wallet Allocation</p>
                      <div className="flex items-center gap-3">
                        <input type="number" min="1" max="99999" step="1"
                          value={estWalletMins}
                          onChange={e => setEstWalletMins(e.target.value)}
                          className="flex-1 rounded-lg px-3 py-2 text-lg font-mono font-bold focus:outline-none"
                          style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 20%)", color: "hsl(var(--foreground))" }} />
                        <span className="text-sm font-mono text-muted-foreground">min</span>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {[30, 60, 120, 240, 480].map(m => (
                          <button key={m} onClick={() => setEstWalletMins(String(m))}
                            className="px-2 py-1 rounded text-[10px] font-mono font-bold transition-colors"
                            style={estMinsNum === m
                              ? { background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.3)" }
                              : { background: "hsl(222 44% 4%)", color: "hsl(215 20% 55%)", border: "1px solid hsl(222 40% 18%)" }}>
                            {m}m
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Results */}
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {[
                      { label: "Real Stream Time",    value: `${estRealMin}m`,      color: "hsl(187 100% 52%)" },
                      { label: "Wallet Minutes",       value: `${estMinsNum}m`,      color: "hsl(var(--foreground))" },
                      { label: "Revenue",              value: `${estRevenue} cr`,    color: "#26de81" },
                      { label: "Decart Cost",          value: `${estCost} cr`,       color: "hsl(0 84% 60%)" },
                      { label: "Net Profit",           value: `${estProfit} cr`,     color: estProfit >= 0 ? "#26de81" : "#fc5c65" },
                      { label: "Profit Margin",        value: `${estMarginPct}%`,    color: "hsl(187 100% 52%)" },
                    ].map(m => (
                      <div key={m.label} className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-2">{m.label}</p>
                        <p className="text-lg font-bold font-mono" style={{ color: m.color }}>{m.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Extra metrics */}
                  <div className="rounded-xl p-5 space-y-3" style={{ background: "hsl(222 44% 5%)", border: "1px solid hsl(222 40% 12%)" }}>
                    <p className="text-xs font-mono font-bold text-foreground uppercase tracking-wider">Efficiency Breakdown</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-sm">
                      <div className="space-y-1">
                        <p className="text-muted-foreground text-xs">Drain Speed</p>
                        <p className="font-bold text-foreground">{estDrainSpd}× faster than real time</p>
                        <p className="text-[10px] text-muted-foreground">at {estRateNum} cr/s ÷ {activeCostRate} base</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-muted-foreground text-xs">Profit per Hour Streamed</p>
                        <p className="font-bold" style={{ color: estProfitHr >= 0 ? "#26de81" : "#fc5c65" }}>{estProfitHr} cr/hr</p>
                        <p className="text-[10px] text-muted-foreground">({estRateNum} − {activeCostRate}) × 3600s</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-muted-foreground text-xs">Real Stream per Wallet-Hour</p>
                        <p className="font-bold text-foreground">{estRateNum > 0 ? Math.round(60 * activeCostRate / estRateNum * 10) / 10 : 60}m</p>
                        <p className="text-[10px] text-muted-foreground">60 × {activeCostRate} ÷ {estRateNum} cr/s</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ════════ TOKEN WINDOW ════════ */}
            {tab === "tokenwindow" && (
              <div className="space-y-6">

                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold font-mono text-foreground flex items-center gap-2">
                      <Shield className="w-4 h-4 text-primary" /> Token Window Control
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                      Per-key token duration · Controls how long each Decart streaming token is valid. Auto-renewed before expiry.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {twLastPoll && <span className="text-xs font-mono text-muted-foreground">{twLastPoll}</span>}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                      style={{ background: "rgba(38,222,129,0.1)", border: "1px solid rgba(38,222,129,0.3)" }}>
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-xs text-green-400 font-mono font-semibold">LIVE 5s</span>
                    </div>
                    <button onClick={fetchTwSessions} className="text-muted-foreground hover:text-foreground">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Live Session Monitor */}
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 14%)" }}>
                  <div className="flex items-center justify-between px-4 py-3"
                    style={{ background: "hsl(222 44% 6%)", borderBottom: "1px solid hsl(222 40% 11%)" }}>
                    <span className="text-xs font-mono font-bold text-foreground flex items-center gap-2">
                      <Radio className="w-3.5 h-3.5 text-green-400" /> Live Session Monitor
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                        style={{ background: "rgba(38,222,129,0.1)", color: "#26de81", border: "1px solid rgba(38,222,129,0.3)" }}>
                        {twSessions.length} active
                      </span>
                    </span>
                    {twSessionsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                  </div>
                  {twSessions.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground" style={{ background: "hsl(222 47% 4%)" }}>
                      <Radio className="w-8 h-8 mx-auto mb-3 opacity-20" />
                      <p className="text-sm font-mono">No active sessions</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto" style={{ background: "hsl(222 47% 4%)" }}>
                      <table className="w-full text-xs font-mono">
                        <thead>
                          <tr style={{ borderBottom: "1px solid hsl(222 40% 11%)" }}>
                            {["Session", "License Key", "API Key", "Token Window", "Elapsed", "Remaining", "Status", "Wallet"].map(h => (
                              <th key={h} className="px-3 py-2 text-left text-muted-foreground font-normal">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {twSessions.map(s => {
                            const pct = Math.min(100, Math.round(s.elapsedMinutes / s.tokenWindowMinutes * 100));
                            const statusColor = s.sessionStatus === "ACTIVE" ? "#26de81" : s.sessionStatus === "EXPIRED" ? "#fc5c65" : "hsl(215 20% 55%)";
                            return (
                              <tr key={s.sessionId} style={{ borderBottom: "1px solid hsl(222 40% 8%)" }}>
                                <td className="px-3 py-2 text-muted-foreground">#{s.sessionId}</td>
                                <td className="px-3 py-2">
                                  <span className="text-primary tracking-wider">{s.licenseKey}</span>
                                  {s.isNewKey && (
                                    <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold"
                                      style={{ background: "hsl(187 100% 52% / 0.1)", color: "hsl(187 100% 52%)", border: "1px solid hsl(187 100% 52% / 0.3)" }}>NEW</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-cyan-400">{s.apiKey}</td>
                                <td className="px-3 py-2 text-foreground font-bold">{s.tokenWindowMinutes}m</td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(222 40% 14%)" }}>
                                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pct > 85 ? "#fc5c65" : pct > 60 ? "#fed330" : "#26de81" }} />
                                    </div>
                                    <span style={{ color: pct > 85 ? "#fc5c65" : "hsl(var(--foreground))" }}>{s.elapsedMinutes.toFixed(1)}m</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2" style={{ color: s.remainingTokenMinutes < 2 ? "#fc5c65" : "#26de81" }}>
                                  {s.remainingTokenMinutes.toFixed(1)}m
                                </td>
                                <td className="px-3 py-2">
                                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                                    style={{ background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}40` }}>
                                    {s.sessionStatus}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {fmtSec(s.remainingWalletSeconds)} left
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Configuration Panels */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                  {/* 1 — Global Default */}
                  <div className="rounded-xl p-5 space-y-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                    <div className="flex items-center gap-2">
                      <Settings2 className="w-4 h-4 text-primary" />
                      <p className="text-sm font-bold font-mono text-foreground">Global Default</p>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">Fallback when no per-key or sub-admin override is set.</p>
                    <div>
                      {twGlobal !== null && (
                        <p className="text-xs text-muted-foreground font-mono mb-2">
                          Current: <span className="text-primary font-bold">{twGlobal} min</span>
                        </p>
                      )}
                      <div className="flex gap-2">
                        <input type="number" min="1" max="480" placeholder="minutes"
                          value={twGlobalInput} onChange={e => setTwGlobalInput(e.target.value)}
                          className="flex-1 rounded-md px-2 py-1.5 text-sm font-mono"
                          style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)", color: "hsl(var(--foreground))" }} />
                        <button onClick={saveGlobalTw} disabled={twGlobalSaving}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-mono font-bold transition-colors"
                          style={{ background: "hsl(187 100% 52% / 0.12)", color: "hsl(187 100% 52%)", border: "1px solid hsl(187 100% 52% / 0.4)" }}>
                          {twGlobalSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Save
                        </button>
                      </div>
                      <div className="flex gap-1 mt-2">
                        {[15, 30, 45, 60].map(m => (
                          <button key={m} onClick={() => setTwGlobalInput(String(m))}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                            style={twGlobalInput === String(m)
                              ? { background: "hsl(187 100% 52% / 0.15)", color: "hsl(187 100% 52%)", border: "1px solid hsl(187 100% 52% / 0.4)" }
                              : { background: "hsl(222 44% 4%)", color: "hsl(215 20% 55%)", border: "1px solid hsl(222 40% 18%)" }}>
                            {m}m
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 2 — Per-Key Override */}
                  <div className="rounded-xl p-5 space-y-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-cyan-400" />
                      <p className="text-sm font-bold font-mono text-foreground">Per-Key Override</p>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">Set token window for a specific license key (highest priority).</p>
                    <div className="space-y-2">
                      <input type="text" placeholder="LICENSE-KEY" value={twKeyInput} onChange={e => setTwKeyInput(e.target.value.toUpperCase())}
                        className="w-full rounded-md px-2 py-1.5 text-sm font-mono tracking-wider"
                        style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)", color: "hsl(var(--foreground))" }} />
                      <div className="flex gap-2">
                        <input type="number" min="1" max="480" placeholder="minutes"
                          value={twKeyMinutes} onChange={e => setTwKeyMinutes(e.target.value)}
                          className="flex-1 rounded-md px-2 py-1.5 text-sm font-mono"
                          style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)", color: "hsl(var(--foreground))" }} />
                        <button onClick={saveKeyTw} disabled={twKeySaving}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-mono font-bold transition-colors"
                          style={{ background: "hsl(187 100% 52% / 0.12)", color: "hsl(187 100% 52%)", border: "1px solid hsl(187 100% 52% / 0.4)" }}>
                          {twKeySaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Set
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 3 — Priority Chain Legend */}
                  <div className="rounded-xl p-5 space-y-3" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                    <div className="flex items-center gap-2">
                      <ArrowRight className="w-4 h-4 text-amber-400" />
                      <p className="text-sm font-bold font-mono text-foreground">Priority Chain</p>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">Token window resolved top-down, first match wins.</p>
                    {[
                      { rank: "1", label: "Per-Key Override",      color: "hsl(187 100% 52%)", desc: "set above" },
                      { rank: "2", label: "Sub-Admin Default",      color: "#fed330",           desc: "per sub-admin" },
                      { rank: "3", label: "Global Default",         color: "#26de81",           desc: "set above" },
                      { rank: "4", label: "System Fallback (15m)", color: "hsl(215 20% 55%)", desc: "hardcoded" },
                    ].map(r => (
                      <div key={r.rank} className="flex items-center gap-3">
                        <span className="w-5 h-5 rounded-full text-[10px] font-black font-mono flex items-center justify-center flex-shrink-0"
                          style={{ background: `${r.color}20`, color: r.color, border: `1px solid ${r.color}40` }}>
                          {r.rank}
                        </span>
                        <div>
                          <p className="text-xs font-mono font-bold text-foreground">{r.label}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">{r.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sub-Admin Token Windows */}
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 14%)" }}>
                  <div className="px-4 py-3 flex items-center gap-2"
                    style={{ background: "hsl(222 44% 6%)", borderBottom: "1px solid hsl(222 40% 11%)" }}>
                    <Users className="w-3.5 h-3.5 text-amber-400" />
                    <p className="text-xs font-mono font-bold text-foreground">Sub-Admin Default Token Windows</p>
                    {twSubAdminsLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />}
                  </div>
                  {twSubAdmins.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground text-xs font-mono"
                      style={{ background: "hsl(222 47% 4%)" }}>
                      {twSubAdminsLoading ? "Loading sub-admins…" : "No sub-admins found."}
                    </div>
                  ) : (
                    <div style={{ background: "hsl(222 47% 4%)" }}>
                      {twSubAdmins.map((sa, i) => (
                        <div key={sa.id} className="flex items-center gap-4 px-4 py-3"
                          style={{ borderBottom: i < twSubAdmins.length - 1 ? "1px solid hsl(222 40% 8%)" : "none" }}>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-mono font-bold text-foreground truncate">{sa.username ?? sa.email}</p>
                            <p className="text-[10px] font-mono text-muted-foreground">{sa.email}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {twSaEditId === sa.id ? (
                              <>
                                <input type="number" min="1" max="480" value={twSaEditVal} onChange={e => setTwSaEditVal(e.target.value)}
                                  className="w-20 rounded px-2 py-1 text-xs font-mono"
                                  style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 20%)", color: "hsl(var(--foreground))" }} />
                                <button onClick={() => saveSaTw(sa.id)} disabled={twSaSaving === sa.id}
                                  className="px-2 py-1 rounded text-[10px] font-mono font-bold"
                                  style={{ background: "hsl(187 100% 52% / 0.12)", color: "hsl(187 100% 52%)", border: "1px solid hsl(187 100% 52% / 0.3)" }}>
                                  {twSaSaving === sa.id ? "…" : "Save"}
                                </button>
                                <button onClick={() => setTwSaEditId(null)}
                                  className="px-2 py-1 rounded text-[10px] font-mono"
                                  style={{ color: "hsl(215 20% 55%)", border: "1px solid hsl(222 40% 18%)" }}>
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="text-xs font-mono font-bold"
                                  style={{ color: sa.defaultTokenWindowMinutes ? "#fed330" : "hsl(215 20% 45%)" }}>
                                  {sa.defaultTokenWindowMinutes ? `${sa.defaultTokenWindowMinutes}m` : "—"}
                                </span>
                                <button onClick={() => { setTwSaEditId(sa.id); setTwSaEditVal(sa.defaultTokenWindowMinutes ? String(sa.defaultTokenWindowMinutes) : ""); }}
                                  className="px-2 py-1 rounded text-[10px] font-mono"
                                  style={{ color: "hsl(215 20% 55%)", border: "1px solid hsl(222 40% 18%)" }}>
                                  Edit
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
