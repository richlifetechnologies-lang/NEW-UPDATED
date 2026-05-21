/**
 * admin-control-center.tsx — Control Center
 *
 * 4 tabs:
 *   1. Usage Cap     — global daily usage cap per key (admin-enabled)
 *   2. Profit Target — enter margin % → derive required billing rate
 *   3. Session Log   — paginated session history with billing metrics
 *   4. Wallet Expiry — global idle-expiry rule (admin-enabled)
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, CheckCircle2,
  Clock, DollarSign, Loader2, RefreshCw, Save, Shield,
  Timer, TrendingUp, Wifi, Zap, CalendarClock, Target,
  ChevronLeft, ChevronRight, MessageSquare, Mail, Phone,
} from "lucide-react";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

type ContactInfo = { message: string; telegram: string; email: string; whatsapp: string };

const COST_RATE = 2.3;

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

const fmtSec = (s: number) => {
  if (s <= 0) return "0s";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
};
const fmtKey = (k: string) => k.length > 18 ? `${k.slice(0, 8)}…${k.slice(-6)}` : k;
const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const margin = (r: number) => r <= 0 ? 0 : Math.round(((r - COST_RATE) / r) * 10000) / 100;

// ── Types ─────────────────────────────────────────────────────────────────────
interface CCSettings {
  usageCapEnabled: boolean; usageCapMinutes: number;
  walletExpiryEnabled: boolean; walletExpiryDays: number;
}
interface CapKey {
  licenseKeyId: number; licenseKey: string; isActive: boolean;
  effectiveRate: number; todaySeconds: number; todaySessions: number;
  capSeconds: number; capMinutes: number; capUsedPct: number;
  capReached: boolean; isLive: boolean; allocatedSeconds: number; usedSeconds: number;
}
interface ExpiryKey {
  licenseKeyId: number; licenseKey: string; isActive: boolean;
  effectiveRate: number; allocatedSeconds: number; usedSeconds: number;
  remainingSeconds: number; lastUsedAt: string | null;
  idleDays: number; isExpired: boolean; daysUntilExpiry: number | null; isLive: boolean;
}
interface SessionRow {
  sessionId: string; licenseKey: string | null; licenseKeyId: number | null;
  decartKeyLabel: string | null; status: string;
  startedAt: string | null; stoppedAt: string | null;
  durationSeconds: number; realStreamSeconds: number;
  style: string | null; billingRate: number;
  revenue: number; cost: number; profit: number; marginPct: number;
}
interface SessionLogResp { sessions: SessionRow[]; total: number; offset: number; limit: number; }
interface CapResp  { keys: CapKey[];    settings: CCSettings; }
interface ExpiryResp { keys: ExpiryKey[]; settings: CCSettings; }

type TabId = "cap" | "profit" | "sessions" | "expiry" | "contact";

// ── Small stat card ───────────────────────────────────────────────────────────
function SC({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub?: string; color?: string; icon: any;
}) {
  return (
    <div className="rounded-xl p-4 space-y-1"
      style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 12%)" }}>
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className="text-xl font-bold font-mono" style={{ color: color ?? "hsl(var(--foreground))" }}>{value}</p>
      {sub && <p className="text-[10px] font-mono text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Toggle row ────────────────────────────────────────────────────────────────
function Toggle({ enabled, onChange, label, sub }: {
  enabled: boolean; onChange: (v: boolean) => void; label: string; sub?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-xl"
      style={{ background: "hsl(222 44% 5%)", border: `1px solid ${enabled ? "hsl(187 100% 52% / 0.3)" : "hsl(222 40% 14%)"}` }}>
      <div>
        <p className="text-sm font-mono font-bold text-foreground">{label}</p>
        {sub && <p className="text-xs font-mono text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <button onClick={() => onChange(!enabled)}
        className="shrink-0 w-10 h-5 rounded-full transition-all duration-300 relative"
        style={{ background: enabled ? "hsl(187 100% 52%)" : "hsl(222 40% 20%)" }}>
        <span className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-300"
          style={{ left: enabled ? "calc(100% - 18px)" : "2px" }} />
      </button>
    </div>
  );
}

export default function AdminControlCenterPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<TabId>("cap");

  // Settings
  const [settings, setSettings] = useState<CCSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Usage Cap tab
  const [capData, setCapData]   = useState<CapResp | null>(null);
  const [capLoading, setCapLoading] = useState(false);
  const [capMinInput, setCapMinInput] = useState("");

  // Session Log tab
  const [sessions, setSessions] = useState<SessionLogResp | null>(null);
  const [sessLoading, setSessLoading] = useState(false);
  const [sessPage, setSessPage] = useState(0);
  const SESS_LIMIT = 50;

  // Wallet Expiry tab
  const [expiryData, setExpiryData] = useState<ExpiryResp | null>(null);
  const [expiryLoading, setExpiryLoading] = useState(false);
  const [expiryDaysInput, setExpiryDaysInput] = useState("");

  // Profit Target tab
  const [targetMargin, setTargetMargin] = useState("50");
  const [targetProfit, setTargetProfit] = useState("");

  // Contact Info tab
  const [contactInfo, setContactInfo] = useState<ContactInfo>({ message: "", telegram: "", email: "", whatsapp: "" });
  const [contactDraft, setContactDraft] = useState<ContactInfo>({ message: "", telegram: "", email: "", whatsapp: "" });
  const [contactLoading, setContactLoading] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load settings ────────────────────────────────────────────────────────────
  const loadSettings = useCallback(async () => {
    const s = await apiFetch<CCSettings>("/api/admin/control-center/settings");
    if (s) {
      setSettings(s);
      setCapMinInput(v => v === "" ? String(s.usageCapMinutes) : v);
      setExpiryDaysInput(v => v === "" ? String(s.walletExpiryDays) : v);
    }
  }, []);

  // ── Save a settings patch ─────────────────────────────────────────────────────
  const savePatch = async (patch: Partial<CCSettings>) => {
    setSavingSettings(true);
    const res = await fetch("/api/admin/control-center/settings", {
      method: "PUT", headers: authH(), body: JSON.stringify(patch),
    });
    setSavingSettings(false);
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      if (d.settings) setSettings(d.settings);
      toast({ title: "Settings saved" });
    } else {
      const d = await res.json().catch(() => ({}));
      toast({ title: "Failed to save", description: d.error ?? "Unknown error", variant: "destructive" });
    }
  };

  // ── Load usage cap data ────────────────────────────────────────────────────────
  const loadCaps = useCallback(async () => {
    setCapLoading(true);
    const d = await apiFetch<CapResp>("/api/admin/control-center/usage-caps");
    if (d) setCapData(d);
    setCapLoading(false);
  }, []);

  // ── Load session log ──────────────────────────────────────────────────────────
  const loadSessions = useCallback(async (page: number) => {
    setSessLoading(true);
    const d = await apiFetch<SessionLogResp>(
      `/api/admin/control-center/session-log?limit=${SESS_LIMIT}&offset=${page * SESS_LIMIT}`
    );
    if (d) setSessions(d);
    setSessLoading(false);
  }, []);

  // ── Load wallet expiry data ───────────────────────────────────────────────────
  const loadExpiry = useCallback(async () => {
    setExpiryLoading(true);
    const d = await apiFetch<ExpiryResp>("/api/admin/control-center/wallet-expiry");
    if (d) setExpiryData(d);
    setExpiryLoading(false);
  }, []);

  // ── Load contact settings ─────────────────────────────────────────────────────
  const loadContact = useCallback(async () => {
    setContactLoading(true);
    const d = await apiFetch<ContactInfo>("/api/admin/contact-settings");
    if (d) { setContactInfo(d); setContactDraft(d); }
    setContactLoading(false);
  }, []);

  const saveContact = async () => {
    setContactSaving(true);
    const res = await fetch("/api/admin/contact-settings", {
      method: "PUT", headers: authH(), body: JSON.stringify(contactDraft),
    });
    setContactSaving(false);
    if (res.ok) {
      setContactInfo(contactDraft);
      toast({ title: "Contact info saved", description: "Login page updated successfully." });
    } else {
      toast({ title: "Failed to save", variant: "destructive" });
    }
  };

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (tab === "cap")      { loadCaps();       timerRef.current = setInterval(loadCaps, 5000); }
    if (tab === "sessions") { loadSessions(sessPage); }
    if (tab === "expiry")   { loadExpiry(); }
    if (tab === "contact")  { loadContact(); }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [tab, loadCaps, loadSessions, loadExpiry, loadContact, sessPage]);

  // ── Profit Target math ────────────────────────────────────────────────────────
  const tm = parseFloat(targetMargin);
  // margin% = (rate - 2.3) / rate × 100  →  rate = 2.3 / (1 - m/100)
  const rateFromMargin = Number.isFinite(tm) && tm < 100
    ? Math.round((COST_RATE / (1 - tm / 100)) * 1000) / 1000 : null;
  // From profit per wallet-hour: profit_per_sec = rate - 2.3  →  rate = profit + 2.3
  const tp = parseFloat(targetProfit);
  const rateFromProfit = Number.isFinite(tp) && tp >= 0
    ? Math.round((tp / 3600 + COST_RATE) * 1000) / 1000 : null;

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: "cap",      label: "Usage Cap",      icon: Shield       },
    { id: "profit",   label: "Profit Target",  icon: Target       },
    { id: "sessions", label: "Session Log",    icon: Activity     },
    { id: "expiry",   label: "Wallet Expiry",  icon: CalendarClock},
    { id: "contact",  label: "Contact Info",   icon: MessageSquare},
  ];

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 lg:p-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Zap className="w-6 h-6 text-primary" />
              Control Center
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Usage caps · Profit targeting · Session replay · Wallet expiry management
            </p>
          </div>
          <button onClick={loadSettings} className="text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 border-b border-border overflow-x-auto">
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

        {/* ════════ USAGE CAP ════════ */}
        {tab === "cap" && (
          <div className="space-y-5">
            {/* Global toggle + config */}
            <div className="rounded-xl p-5 space-y-4"
              style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 13%)" }}>
              <p className="text-sm font-bold font-mono text-foreground">Global Daily Usage Cap</p>
              <p className="text-xs text-muted-foreground font-mono">
                When enabled, each licence key's streaming today is compared against the cap.
                Keys at or over the cap are flagged below. Enforcement (blocking) is applied
                at the session/heartbeat level once the cap is reached.
              </p>
              <Toggle
                enabled={settings?.usageCapEnabled ?? false}
                label={settings?.usageCapEnabled ? "Usage Cap — ACTIVE" : "Usage Cap — Disabled"}
                sub="Toggle to enable/disable the daily usage cap globally"
                onChange={v => savePatch({ usageCapEnabled: v })}
              />
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 rounded-lg px-3 py-2"
                  style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 18%)" }}>
                  <span className="text-[10px] font-mono text-muted-foreground">Cap per key per day:</span>
                  <input type="number" min="1" max="99999" step="1"
                    value={capMinInput}
                    onChange={e => setCapMinInput(e.target.value)}
                    className="w-16 bg-transparent text-sm font-mono font-bold text-foreground focus:outline-none"
                    style={{ color: "hsl(187 100% 52%)" }} />
                  <span className="text-[10px] font-mono text-muted-foreground">minutes</span>
                </div>
                <button
                  onClick={() => {
                    const v = parseInt(capMinInput, 10);
                    if (!v || v < 1) return;
                    savePatch({ usageCapMinutes: v });
                  }}
                  disabled={savingSettings}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono font-bold transition-all"
                  style={{ background: "hsl(187 100% 52% / 0.12)", color: "hsl(187 100% 52%)", border: "1px solid hsl(187 100% 52% / 0.3)" }}>
                  {savingSettings ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save Cap
                </button>
              </div>
            </div>

            {/* Per-key status table */}
            {capLoading && !capData ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : capData && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <SC label="Cap Limit" value={`${settings?.usageCapMinutes ?? "—"}m/day`}
                    sub="per licence key" color="hsl(187 100% 52%)" icon={Shield} />
                  <SC label="At Cap Today"
                    value={String(capData.keys.filter(k => k.capReached).length)}
                    color="#fc5c65" icon={AlertTriangle}
                    sub={settings?.usageCapEnabled ? "cap active" : "cap disabled"} />
                  <SC label="Live Now"
                    value={String(capData.keys.filter(k => k.isLive).length)}
                    color="#26de81" icon={Wifi} sub="active streams" />
                  <SC label="Total Keys"
                    value={String(capData.keys.length)} icon={BarChart3} />
                </div>

                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: "hsl(222 44% 6%)" }}>
                          {["Licence Key","Today Used","Cap","Progress","Sessions Today","Wallet Used","Status","Live"].map(h => (
                            <th key={h} className="px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-right first:text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {capData.keys.length === 0 ? (
                          <tr><td colSpan={8} className="text-center py-12 text-muted-foreground font-mono text-sm">No keys found</td></tr>
                        ) : capData.keys.map(k => (
                          <tr key={k.licenseKeyId} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}
                            className={k.capReached ? "bg-red-400/[0.03]" : k.isLive ? "bg-green-400/[0.02]" : ""}>
                            <td className="px-3 py-2.5 font-mono text-foreground whitespace-nowrap">
                              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${k.isActive ? "bg-green-400" : "bg-muted"}`} />
                              <span title={k.licenseKey}>{fmtKey(k.licenseKey)}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono"
                              style={{ color: k.capReached ? "#fc5c65" : "hsl(var(--foreground))" }}>
                              {fmtSec(k.todaySeconds)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                              {fmtSec(k.capSeconds)}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <div className="flex items-center gap-2 justify-end">
                                <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(222 40% 14%)" }}>
                                  <div className="h-full rounded-full transition-all"
                                    style={{
                                      width: `${k.capUsedPct}%`,
                                      background: k.capReached ? "#fc5c65" : k.capUsedPct > 75 ? "#fed330" : "#26de81",
                                    }} />
                                </div>
                                <span className="font-mono text-[10px] text-muted-foreground w-8 text-right">
                                  {k.capUsedPct}%
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{k.todaySessions}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmtSec(k.usedSeconds)}</td>
                            <td className="px-3 py-2.5 text-right">
                              {k.capReached
                                ? <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(252,92,101,0.12)", color: "#fc5c65" }}>CAP HIT</span>
                                : <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "hsl(222 40% 14%)", color: "hsl(215 20% 55%)" }}>OK</span>}
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
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ════════ PROFIT TARGET ════════ */}
        {tab === "profit" && (
          <div className="space-y-5">
            <div className="rounded-xl p-5 space-y-4"
              style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
              <p className="text-sm font-bold font-mono text-foreground flex items-center gap-2">
                <Target className="w-4 h-4" style={{ color: "hsl(187 100% 52%)" }} />
                Profit Target Calculator
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                Enter your target profit margin % OR target profit credits per wallet-hour.
                The system calculates the minimum billing rate you need to hit that target
                against the fixed Decart API cost of {COST_RATE} cr/s.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* From margin % */}
              <div className="rounded-xl p-5 space-y-4"
                style={{ background: "hsl(222 44% 5%)", border: "1px solid hsl(222 40% 13%)" }}>
                <p className="text-xs font-mono font-bold text-muted-foreground uppercase tracking-wider">
                  From Target Margin %
                </p>
                <div className="flex items-center gap-2 rounded-lg px-3 py-2"
                  style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 18%)" }}>
                  <span className="text-[10px] font-mono text-muted-foreground">Target margin:</span>
                  <input type="number" min="0" max="99.9" step="0.1"
                    value={targetMargin}
                    onChange={e => setTargetMargin(e.target.value)}
                    className="w-14 bg-transparent text-sm font-mono font-bold text-foreground focus:outline-none"
                    style={{ color: "hsl(187 100% 52%)" }} />
                  <span className="text-[10px] font-mono text-muted-foreground">%</span>
                </div>
                {rateFromMargin != null ? (
                  <div className="space-y-3">
                    <div className="rounded-lg px-4 py-3 text-center"
                      style={{ background: "hsl(187 100% 52% / 0.06)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
                      <p className="text-[10px] font-mono text-muted-foreground mb-1">Required Billing Rate</p>
                      <p className="text-3xl font-black font-mono" style={{ color: "hsl(187 100% 52%)" }}>
                        {rateFromMargin} <span className="text-base">cr/s</span>
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      {[
                        { label: "Margin",          value: `${margin(rateFromMargin)}%` },
                        { label: "Decart Cost",      value: `${COST_RATE} cr/s` },
                        { label: "Profit/sec",       value: `${Math.round((rateFromMargin - COST_RATE) * 100) / 100} cr/s` },
                        { label: "Profit/wallet-hr", value: `${Math.round((rateFromMargin - COST_RATE) * 3600)} cr` },
                      ].map(m => (
                        <div key={m.label} className="rounded-lg px-2 py-1.5 text-center"
                          style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 12%)" }}>
                          <p className="text-[9px] text-muted-foreground mb-0.5">{m.label}</p>
                          <p className="font-bold text-foreground">{m.value}</p>
                        </div>
                      ))}
                    </div>
                    {rateFromMargin < COST_RATE && (
                      <div className="flex items-center gap-2 text-xs font-mono p-3 rounded-lg"
                        style={{ background: "rgba(252,92,101,0.08)", border: "1px solid rgba(252,92,101,0.25)", color: "#fc5c65" }}>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        This rate is below Decart cost (2.3 cr/s) — you will lose money.
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs font-mono text-muted-foreground">Enter a margin between 0 and 99.9%</p>
                )}
              </div>

              {/* From profit credits per wallet-hour */}
              <div className="rounded-xl p-5 space-y-4"
                style={{ background: "hsl(222 44% 5%)", border: "1px solid hsl(222 40% 13%)" }}>
                <p className="text-xs font-mono font-bold text-muted-foreground uppercase tracking-wider">
                  From Target Profit per Wallet-Hour
                </p>
                <div className="flex items-center gap-2 rounded-lg px-3 py-2"
                  style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 18%)" }}>
                  <span className="text-[10px] font-mono text-muted-foreground">Target profit:</span>
                  <input type="number" min="0" step="1"
                    value={targetProfit}
                    onChange={e => setTargetProfit(e.target.value)}
                    placeholder="e.g. 2500"
                    className="w-20 bg-transparent text-sm font-mono font-bold text-foreground focus:outline-none"
                    style={{ color: "#26de81" }} />
                  <span className="text-[10px] font-mono text-muted-foreground">cr/wallet-hr</span>
                </div>
                {rateFromProfit != null ? (
                  <div className="space-y-3">
                    <div className="rounded-lg px-4 py-3 text-center"
                      style={{ background: "rgba(38,222,129,0.06)", border: "1px solid rgba(38,222,129,0.2)" }}>
                      <p className="text-[10px] font-mono text-muted-foreground mb-1">Required Billing Rate</p>
                      <p className="text-3xl font-black font-mono text-green-400">
                        {rateFromProfit} <span className="text-base">cr/s</span>
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      {[
                        { label: "Margin",          value: `${margin(rateFromProfit)}%` },
                        { label: "Decart Cost",      value: `${COST_RATE} cr/s` },
                        { label: "Net Profit/sec",   value: `${Math.round((rateFromProfit - COST_RATE) * 100) / 100} cr/s` },
                        { label: "Net Profit/hr",    value: `${Math.round((rateFromProfit - COST_RATE) * 3600)} cr` },
                      ].map(m => (
                        <div key={m.label} className="rounded-lg px-2 py-1.5 text-center"
                          style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 12%)" }}>
                          <p className="text-[9px] text-muted-foreground mb-0.5">{m.label}</p>
                          <p className="font-bold text-foreground">{m.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs font-mono text-muted-foreground">
                    Enter target profit credits per wallet-hour (e.g. 2500)
                  </p>
                )}
              </div>
            </div>

            {/* Comparison table for preset rates */}
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
              <div className="px-4 py-3 font-mono text-xs font-bold text-muted-foreground uppercase tracking-wider"
                style={{ background: "hsl(222 44% 6%)", borderBottom: "1px solid hsl(222 40% 11%)" }}>
                Rate Comparison Table — All Common Profiles
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: "hsl(222 44% 6%)" }}>
                    {["Rate","Margin %","Profit/sec","Profit/wallet-hr","Real Stream per 60 wallet-min","Breakeven?"].map(h => (
                      <th key={h} className="px-3 py-2.5 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-right first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[2.3, 3, 4, 5, 6, 8, 10, 12, 15].map(r => {
                    const m = margin(r);
                    const profitSec  = Math.round((r - COST_RATE) * 100) / 100;
                    const profitHr   = Math.round((r - COST_RATE) * 3600);
                    const realMin60  = Math.round(60 * COST_RATE / r * 10) / 10;
                    return (
                      <tr key={r} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}
                        className={r === rateFromMargin || r === rateFromProfit ? "bg-primary/5" : ""}>
                        <td className="px-3 py-2.5 font-mono font-bold text-foreground">{r} cr/s</td>
                        <td className="px-3 py-2.5 text-right font-mono"
                          style={{ color: m > 0 ? "#26de81" : m < 0 ? "#fc5c65" : "hsl(215 20% 55%)" }}>
                          {m}%
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono"
                          style={{ color: profitSec > 0 ? "hsl(187 100% 52%)" : "#fc5c65" }}>
                          {profitSec > 0 ? `+${profitSec}` : profitSec} cr/s
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono"
                          style={{ color: profitHr > 0 ? "#26de81" : "#fc5c65" }}>
                          {profitHr > 0 ? `+${profitHr}` : profitHr} cr
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                          {realMin60}m real
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {r === COST_RATE
                            ? <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "hsl(222 40% 14%)", color: "hsl(215 20% 55%)" }}>BREAKEVEN</span>
                            : r > COST_RATE
                              ? <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(38,222,129,0.1)", color: "#26de81" }}>PROFIT</span>
                              : <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(252,92,101,0.1)", color: "#fc5c65" }}>LOSS</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ════════ SESSION LOG ════════ */}
        {tab === "sessions" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="rounded-lg p-4 flex-1"
                style={{ background: "hsl(222 44% 5%)", border: "1px solid hsl(187 100% 52% / 0.15)" }}>
                <p className="text-xs font-mono" style={{ color: "hsl(187 100% 52%)" }}>
                  <strong>Session Replay Log.</strong> All sessions ordered newest-first. Revenue = wallet_seconds × billing_rate.
                  Cost = real_stream_sec × 2.3. Profit = revenue − cost. Real stream sec = wallet_sec × 2.3 / rate.
                </p>
              </div>
              <button onClick={() => loadSessions(sessPage)} disabled={sessLoading}
                className="text-muted-foreground hover:text-foreground transition-colors">
                <RefreshCw className={`w-4 h-4 ${sessLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {sessions && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SC label="Total Sessions"   value={String(sessions.total)}    icon={Activity}  />
                <SC label="Showing"          value={`${sessions.sessions.length} sessions`} icon={BarChart3} />
                <SC label="Total Revenue"
                  value={`${Math.round(sessions.sessions.reduce((a,s) => a + s.revenue, 0) * 100) / 100} cr`}
                  color="hsl(187 100% 52%)" icon={DollarSign} />
                <SC label="Total Profit"
                  value={`${Math.round(sessions.sessions.reduce((a,s) => a + s.profit, 0) * 100) / 100} cr`}
                  color="#26de81" icon={TrendingUp} />
              </div>
            )}

            {sessLoading && !sessions ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : sessions && (
              <>
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: "hsl(222 44% 6%)" }}>
                          {["Session ID","Licence Key","Status","Started","Stopped","Wallet Sec","Real Stream","Rate","Revenue","Cost","Profit","Margin"].map(h => (
                            <th key={h} className="px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-right first:text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sessions.sessions.length === 0 ? (
                          <tr><td colSpan={12} className="text-center py-12 text-muted-foreground font-mono text-sm">No sessions found</td></tr>
                        ) : sessions.sessions.map(s => (
                          <tr key={s.sessionId} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}
                            className={s.status === "active" ? "bg-green-400/[0.02]" : ""}>
                            <td className="px-3 py-2.5 font-mono text-muted-foreground whitespace-nowrap">
                              {s.sessionId.slice(0, 12)}…
                            </td>
                            <td className="px-3 py-2.5 font-mono text-foreground whitespace-nowrap">
                              {s.licenseKey ? fmtKey(s.licenseKey) : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                                style={s.status === "active"
                                  ? { background: "rgba(38,222,129,0.1)", color: "#26de81" }
                                  : s.status === "expired"
                                    ? { background: "rgba(252,92,101,0.1)", color: "#fc5c65" }
                                    : { background: "hsl(222 40% 14%)", color: "hsl(215 20% 55%)" }}>
                                {s.status.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground whitespace-nowrap">
                              {fmtDate(s.startedAt)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground whitespace-nowrap">
                              {s.stoppedAt ? fmtDate(s.stoppedAt) : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-foreground">
                              {fmtSec(s.durationSeconds)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                              {fmtSec(s.realStreamSeconds)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                              {s.billingRate} cr/s
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono" style={{ color: "hsl(187 100% 52%)" }}>
                              {s.revenue} cr
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                              {s.cost} cr
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono"
                              style={{ color: s.profit >= 0 ? "#26de81" : "#fc5c65" }}>
                              {s.profit >= 0 ? `+${s.profit}` : s.profit} cr
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono"
                              style={{ color: s.marginPct > 0 ? "#26de81" : "#fc5c65" }}>
                              {s.marginPct}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                  <span>{sessions.offset + 1}–{Math.min(sessions.offset + sessions.sessions.length, sessions.total)} of {sessions.total}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSessPage(p => Math.max(0, p - 1))}
                      disabled={sessPage === 0}
                      className="p-1.5 rounded hover:bg-muted transition-colors disabled:opacity-30">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span>Page {sessPage + 1} / {Math.ceil(sessions.total / SESS_LIMIT)}</span>
                    <button onClick={() => setSessPage(p => p + 1)}
                      disabled={(sessPage + 1) * SESS_LIMIT >= sessions.total}
                      className="p-1.5 rounded hover:bg-muted transition-colors disabled:opacity-30">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ════════ WALLET EXPIRY ════════ */}
        {tab === "expiry" && (
          <div className="space-y-5">
            <div className="rounded-xl p-5 space-y-4"
              style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 13%)" }}>
              <p className="text-sm font-bold font-mono text-foreground">Global Wallet Auto-Expiry</p>
              <p className="text-xs text-muted-foreground font-mono">
                When enabled, any licence key that has not been used for more than the configured number
                of days is marked as expired below. The expiry is advisory — it flags idle keys so
                you can take action (e.g. deactivate, reclaim wallet minutes, notify the user).
              </p>
              <Toggle
                enabled={settings?.walletExpiryEnabled ?? false}
                label={settings?.walletExpiryEnabled ? "Wallet Expiry — ACTIVE" : "Wallet Expiry — Disabled"}
                sub="Toggle to enable/disable global wallet expiry monitoring"
                onChange={v => savePatch({ walletExpiryEnabled: v })}
              />
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 rounded-lg px-3 py-2"
                  style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 18%)" }}>
                  <span className="text-[10px] font-mono text-muted-foreground">Expire after:</span>
                  <input type="number" min="1" max="9999" step="1"
                    value={expiryDaysInput}
                    onChange={e => setExpiryDaysInput(e.target.value)}
                    className="w-14 bg-transparent text-sm font-mono font-bold text-foreground focus:outline-none"
                    style={{ color: "#fed330" }} />
                  <span className="text-[10px] font-mono text-muted-foreground">days idle</span>
                </div>
                <button
                  onClick={() => {
                    const v = parseInt(expiryDaysInput, 10);
                    if (!v || v < 1) return;
                    savePatch({ walletExpiryDays: v });
                  }}
                  disabled={savingSettings}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono font-bold transition-all"
                  style={{ background: "rgba(254,211,48,0.1)", color: "#fed330", border: "1px solid rgba(254,211,48,0.3)" }}>
                  {savingSettings ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save Expiry
                </button>
              </div>
            </div>

            {expiryLoading && !expiryData ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : expiryData && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <SC label="Expiry Window"
                    value={`${settings?.walletExpiryDays ?? "—"} days`}
                    sub="idle = expired" color="#fed330" icon={CalendarClock} />
                  <SC label="Expired Keys"
                    value={String(expiryData.keys.filter(k => k.isExpired).length)}
                    color="#fc5c65" icon={AlertTriangle}
                    sub={settings?.walletExpiryEnabled ? "expiry active" : "expiry disabled"} />
                  <SC label="At Risk (< 7 days)"
                    value={String(expiryData.keys.filter(k => !k.isExpired && k.daysUntilExpiry != null && k.daysUntilExpiry < 7).length)}
                    color="#fed330" icon={Clock} />
                  <SC label="Total Keys"
                    value={String(expiryData.keys.length)} icon={BarChart3} />
                </div>

                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: "hsl(222 44% 6%)" }}>
                          {["Licence Key","Last Used","Idle Days","Days Until Expiry","Wallet Used","Wallet Rem","Rate","Status","Live"].map(h => (
                            <th key={h} className="px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-right first:text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {expiryData.keys.length === 0 ? (
                          <tr><td colSpan={9} className="text-center py-12 text-muted-foreground font-mono text-sm">No keys found</td></tr>
                        ) : expiryData.keys.map(k => (
                          <tr key={k.licenseKeyId} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}
                            className={k.isExpired ? "bg-red-400/[0.03]" : ""}>
                            <td className="px-3 py-2.5 font-mono text-foreground whitespace-nowrap">
                              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${k.isActive ? "bg-green-400" : "bg-muted"}`} />
                              <span title={k.licenseKey}>{fmtKey(k.licenseKey)}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground whitespace-nowrap">
                              {fmtDate(k.lastUsedAt)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono"
                              style={{ color: k.isExpired ? "#fc5c65" : k.idleDays > (settings?.walletExpiryDays ?? 30) * 0.8 ? "#fed330" : "hsl(var(--foreground))" }}>
                              {k.idleDays}d
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono"
                              style={{ color: k.isExpired ? "#fc5c65" : k.daysUntilExpiry != null && k.daysUntilExpiry < 7 ? "#fed330" : "#26de81" }}>
                              {k.isExpired ? "EXPIRED" : k.daysUntilExpiry != null ? `${k.daysUntilExpiry}d` : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmtSec(k.usedSeconds)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmtSec(k.remainingSeconds)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{k.effectiveRate} cr/s</td>
                            <td className="px-3 py-2.5 text-right">
                              {k.isExpired
                                ? <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(252,92,101,0.12)", color: "#fc5c65" }}>EXPIRED</span>
                                : k.daysUntilExpiry != null && k.daysUntilExpiry < 7
                                  ? <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(254,211,48,0.1)", color: "#fed330" }}>AT RISK</span>
                                  : <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "hsl(222 40% 14%)", color: "hsl(215 20% 55%)" }}>OK</span>}
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
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        {/* ════════ CONTACT INFO ════════ */}
        {tab === "contact" && (
          <div className="space-y-6">
            {contactLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Info banner */}
                <div className="rounded-xl p-4 flex items-start gap-3"
                  style={{ background: "hsl(187 100% 52% / 0.06)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
                  <MessageSquare className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-mono font-bold text-foreground">Login Page Contact Info</p>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">
                      These details appear at the bottom of the login page so users know how to reach you for license keys.
                      Changes take effect immediately for all new visitors.
                    </p>
                  </div>
                </div>

                {/* Form fields */}
                <div className="rounded-xl p-5 space-y-5"
                  style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 13%)" }}>

                  {/* Message */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      <MessageSquare className="w-3 h-3" />
                      Intro Message
                    </label>
                    <input
                      type="text"
                      value={contactDraft.message}
                      onChange={e => setContactDraft(d => ({ ...d, message: e.target.value }))}
                      placeholder="Need a license key? Contact us via:"
                      className="w-full rounded-lg px-3 py-2.5 text-sm font-mono bg-transparent focus:outline-none"
                      style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 18%)", color: "hsl(var(--foreground))" }}
                    />
                    <p className="text-[10px] font-mono text-muted-foreground">The text shown above the contact links on the login page.</p>
                  </div>

                  {/* Telegram */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3" style={{ color: "#2AABEE" }}>
                        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.782-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                      </svg>
                      Telegram Username
                    </label>
                    <input
                      type="text"
                      value={contactDraft.telegram}
                      onChange={e => setContactDraft(d => ({ ...d, telegram: e.target.value }))}
                      placeholder="@rich_life2k15"
                      className="w-full rounded-lg px-3 py-2.5 text-sm font-mono bg-transparent focus:outline-none"
                      style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 18%)", color: "hsl(187 100% 52%)" }}
                    />
                  </div>

                  {/* Email */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      <Mail className="w-3 h-3" />
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={contactDraft.email}
                      onChange={e => setContactDraft(d => ({ ...d, email: e.target.value }))}
                      placeholder="loveoflots06@gmail.com"
                      className="w-full rounded-lg px-3 py-2.5 text-sm font-mono bg-transparent focus:outline-none"
                      style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 18%)", color: "hsl(187 100% 52%)" }}
                    />
                  </div>

                  {/* WhatsApp */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      <WhatsAppIcon className="w-3 h-3" />
                      <span style={{ color: "#25D366" }}>WhatsApp Number</span>
                    </label>
                    <input
                      type="text"
                      value={contactDraft.whatsapp}
                      onChange={e => setContactDraft(d => ({ ...d, whatsapp: e.target.value }))}
                      placeholder="+1 234 567 8900"
                      className="w-full rounded-lg px-3 py-2.5 text-sm font-mono bg-transparent focus:outline-none"
                      style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 18%)", color: "#25D366" }}
                    />
                    <p className="text-[10px] font-mono text-muted-foreground">Leave blank to hide the WhatsApp link on the login page.</p>
                  </div>
                </div>

                {/* Live preview */}
                <div className="rounded-xl p-5 space-y-3"
                  style={{ background: "hsl(222 44% 5%)", border: "1px solid hsl(222 40% 14%)" }}>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Live Preview — Login Page Footer</p>
                  <div className="space-y-1.5 text-center py-2">
                    <p className="text-xs text-muted-foreground">{contactDraft.message || "—"}</p>
                    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
                      {contactDraft.telegram && (
                        <span className="flex items-center gap-1 text-xs">
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" style={{ color: "#2AABEE" }}>
                            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.782-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                          </svg>
                          <span className="font-mono" style={{ color: "hsl(187 100% 52%)" }}>{contactDraft.telegram}</span>
                        </span>
                      )}
                      {contactDraft.email && (
                        <span className="flex items-center gap-1 text-xs">
                          <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="font-mono" style={{ color: "hsl(187 100% 52%)" }}>{contactDraft.email}</span>
                        </span>
                      )}
                      {contactDraft.whatsapp && (
                        <span className="flex items-center gap-1 text-xs">
                          <WhatsAppIcon className="w-3.5 h-3.5" />
                          <span className="font-mono" style={{ color: "#25D366" }}>{contactDraft.whatsapp}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Save button */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <button
                    onClick={() => setContactDraft(contactInfo)}
                    className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Reset changes
                  </button>
                  <button
                    onClick={saveContact}
                    disabled={contactSaving}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-mono font-bold transition-all"
                    style={{ background: "hsl(187 100% 52%)", color: "#000", boxShadow: "0 0 18px hsl(187 100% 52% / 0.35)", opacity: contactSaving ? 0.7 : 1 }}>
                    {contactSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {contactSaving ? "Saving..." : "Save Contact Info"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </AdminLayout>
  );
}
