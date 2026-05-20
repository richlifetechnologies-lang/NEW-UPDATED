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
 *   margin %         = (billing_rate - 2.3) / billing_rate × 100
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, CheckCircle2,
  Clock, Loader2, RefreshCw, RotateCcw, Save,
  Timer, TrendingUp, Wifi, Zap, DollarSign,
} from "lucide-react";

const COST_RATE = 2.3; // Decart API fixed cost — never changes

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
  effectiveRate: number; usedSeconds: number;
  remainingSeconds: number;
  isLive: boolean; activeSessionCount: number; rateSource: string;
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
function margin(rate: number): number {
  return rate > 0 ? Math.round(((rate - COST_RATE) / rate) * 1000) / 10 : 0;
}
/** Real streaming minutes a wallet-hour yields at this billing rate */
function realMinPerWalletHour(rate: number): number {
  return rate > 0 ? Math.round((60 * COST_RATE / rate) * 10) / 10 : 60;
}
/** Real streaming seconds remaining from wallet seconds remaining */
function realStreamRemaining(walletSec: number, rate: number): number {
  return rate > 0 ? Math.round(walletSec * COST_RATE / rate) : walletSec;
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

type TabId = "control" | "keys" | "audit";

export default function AdminBillingPage() {
  const { toast } = useToast();
  const [tab, setTab]             = useState<TabId>("control");
  const [rateInfo, setRateInfo]   = useState<RateInfo | null>(null);
  const [brkData, setBrkData]     = useState<BrkResponse | null>(null);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [inputRate, setInputRate] = useState<string>("");
  const [saving, setSaving]       = useState(false);
  const [loading, setLoading]     = useState(true);
  const [lastPoll, setLastPoll]   = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    const realSec = k.effectiveRate > 0 ? k.usedSeconds * COST_RATE / k.effectiveRate : k.usedSeconds;
    return a + realSec * COST_RATE;
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

  // Preview metrics for the "Rate Impact" panel
  const previewMargin     = previewRate != null ? margin(previewRate)              : null;
  const previewRealMin    = previewRate != null ? realMinPerWalletHour(previewRate): null;
  const previewProfit60   = previewRate != null
    ? Math.round((previewRate - COST_RATE) * 3600 * 100) / 100  // credits profit per wallet-hour
    : null;
  const previewDecartCost60 = previewRate != null && previewRealMin != null
    ? Math.round(previewRealMin * 60 * COST_RATE * 100) / 100  // Decart credits for 1 wallet-hour
    : null;

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: "control", label: "Rate Control",   icon: Zap      },
    { id: "keys",    label: "Per-Key Monitor",icon: Activity  },
    { id: "audit",   label: "Change Log",     icon: RotateCcw},
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
                sub={currentRate != null ? `${Math.round((currentRate - COST_RATE) * 100) / 100} cr/s profit` : ""}
                color={currentRate != null && currentRate > COST_RATE ? "#26de81" : "#fc5c65"}
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
                    <span className="text-muted-foreground">Decart Cost: <span className="text-foreground font-bold">{COST_RATE} cr/s fixed</span></span>
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
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <p className="text-xs font-mono font-bold uppercase tracking-wider" style={{ color: "hsl(187 100% 52%)" }}>
                      Rate Impact Preview — {inputProfile?.label ?? "Loading…"} ({previewRate} cr/s)
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Wallet → Real Stream */}
                    <div className="rounded-lg p-4 space-y-3" style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 12%)" }}>
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">60 Wallet-Minutes gives →</p>
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="text-3xl font-black font-mono text-foreground">60<span className="text-lg">m</span></p>
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
                          {previewRate != null ? `${Math.round(previewRate / COST_RATE * 1000) / 1000}× faster` : "—"}
                        </span> than real time at {COST_RATE} cr/s base
                      </p>
                    </div>

                    {/* Profit breakdown */}
                    <div className="rounded-lg p-4 space-y-3" style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 12%)" }}>
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Per 60 Wallet-Minutes Sold</p>
                      <div className="space-y-2 font-mono text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Revenue charged</span>
                          <span className="text-foreground font-bold">{previewRate != null ? `${Math.round(previewRate * 3600)} cr` : "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Decart API cost</span>
                          <span className="text-foreground font-bold">{previewDecartCost60 != null ? `${previewDecartCost60} cr` : "—"}</span>
                        </div>
                        <div className="h-px" style={{ background: "hsl(222 40% 14%)" }} />
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Net profit</span>
                          <span className="font-bold" style={{ color: previewProfit60 != null && previewProfit60 >= 0 ? "#26de81" : "#fc5c65" }}>
                            {previewProfit60 != null ? `${previewProfit60} cr` : "—"}
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
                      { label: "Billing Rate",          value: previewRate != null ? `${previewRate} cr/s`                                               : "—" },
                      { label: "Decart Base Cost",       value: `${COST_RATE} cr/s`                                                                        },
                      { label: "Profit per Hr Streamed", value: previewRate != null ? `${Math.round((previewRate - COST_RATE) * 3600)} cr`                : "—" },
                      { label: "Margin",                 value: previewMargin != null ? `${previewMargin}%`                                               : "—" },
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

            {/* ════════ PER-KEY MONITOR ════════ */}
            {tab === "keys" && (
              <div className="space-y-4">
                <div className="rounded-lg p-4" style={{ background: "hsl(222 44% 5%)", border: "1px solid hsl(187 100% 52% / 0.15)" }}>
                  <p className="text-xs font-mono" style={{ color: "hsl(187 100% 52%)" }}>
                    <strong>Per-Key Billing Monitor.</strong> Revenue = wallet_used × billing_rate. Decart cost = real_stream_sec × 2.3.
                    Real stream remaining = wallet_remaining × 2.3 / billing_rate.
                  </p>
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: "hsl(222 44% 6%)" }}>
                          {["Licence Key","Source","Rate","Wallet Used","Wallet Rem","Real Stream Rem","Revenue","Decart Cost","Profit","Margin","Live"].map(h => (
                            <th key={h} className="px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-right first:text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {keys.length === 0 ? (
                          <tr><td colSpan={11} className="text-center py-12 text-muted-foreground font-mono text-sm">No licence keys found</td></tr>
                        ) : keys.map(k => {
                          const rate      = k.effectiveRate;
                          const realRemSec = realStreamRemaining(k.remainingSeconds, rate);
                          const revenue   = Math.round(k.usedSeconds * rate * 100) / 100;
                          const realUsed  = rate > 0 ? k.usedSeconds * COST_RATE / rate : k.usedSeconds;
                          const cost      = Math.round(realUsed * COST_RATE * 100) / 100;
                          const profit    = Math.round((revenue - cost) * 100) / 100;
                          const marginPct = margin(rate);
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
                                    : { background: "hsl(222 40% 14%)", color: "hsl(215 20% 55%)" }}>
                                  {k.rateSource === "custom" ? "CUSTOM" : "GLOBAL"}
                                </span>
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
          </>
        )}
      </div>
    </AdminLayout>
  );
}
