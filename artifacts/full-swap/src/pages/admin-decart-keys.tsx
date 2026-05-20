/**
 * admin-decart-keys.tsx — Decart API Key Pool · Infrastructure Control Center
 * READ ONLY monitoring + admin CRUD actions.
 * Burn = real seconds only. TCE NEVER affects Decart calculations.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, BarChart3, ChevronDown, ChevronUp,
  Clock, DollarSign, Eye, EyeOff, Key, Loader2, Plus,
  RefreshCw, Search, Settings2, Trash2, Wifi, X, Zap,
  Power, PowerOff, Shield,
} from "lucide-react";

const COST_RATE = 2.3;

function authH() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token") ?? ""}`,
  };
}

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...opts, headers: { ...authH(), ...(opts?.headers ?? {}) } });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface DecartKey {
  id: number; label: string; apiKey: string; apiSecret: string;
  isActive: boolean; maxUsers: number | null; usageLoad: number | null;
  healthStatus: string | null; createdAt: string; updatedAt: string | null;
  assignedLicenseKey: string | null; assignmentStatus: string | null;
  totalCreditsLoaded: number; creditsBaseline: number; thresholdPct: number;
  lastTopupAt: string | null;
}
interface DecartKeyStatus {
  id: number; label: string; isActive: boolean; maxUsers: number | null;
  usageLoad: number | null; healthStatus: string | null;
  totalCreditsLoaded: number; creditsBaseline: number; thresholdPct: number;
  lastTopupAt: string | null; assignedLicenseKey: string | null;
  activeSessionCount: number; estimatedRemainingSeconds: number | null;
  activeBillingRate: number; warningLevel: string;
}
interface LicenseKey {
  licenseKeyId: number; licenseKey: string; isActive: boolean;
  effectiveRate: number; rateSource: string; compressionFactor: number;
  usedSeconds: number; displaySecondsUsed: number; displaySecondsRemaining: number;
  remainingSeconds: number; profitPerSecond: number; projectedProfitPct: number;
  isLive: boolean; activeSessionCount: number; allocatedSeconds: number;
}
interface ActiveSession {
  id: string; licenseKeyId: number | null; status: string;
  startedAt: string; lastHeartbeatAt: string | null; durationSeconds: number | null;
  decartKeyId: number | null;
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
function maskKey(k: string): string {
  if (!k || k.length < 8) return "••••••••";
  return `${k.slice(0, 4)}${"•".repeat(Math.max(0, k.length - 8))}${k.slice(-4)}`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return "—"; }
}
function healthColor(h: string | null): string {
  if (h === "healthy") return "#26de81";
  if (h === "low" || h === "warning") return "#fed330";
  if (h === "critical" || h === "error" || h === "overloaded") return "#fc5c65";
  return "hsl(215 20% 55%)";
}
function driftHealth(pct: number): "good" | "warn" | "crit" {
  if (pct < 2) return "good";
  if (pct < 5) return "warn";
  return "crit";
}
function driftFg(h: "good" | "warn" | "crit"): string {
  return h === "good" ? "#26de81" : h === "warn" ? "#fed330" : "#fc5c65";
}
function driftBg(h: "good" | "warn" | "crit"): string {
  return h === "good" ? "rgba(38,222,129,0.1)" : h === "warn" ? "rgba(254,211,48,0.1)" : "rgba(252,92,101,0.1)";
}
function driftBdr(h: "good" | "warn" | "crit"): string {
  return h === "good" ? "rgba(38,222,129,0.3)" : h === "warn" ? "rgba(254,211,48,0.3)" : "rgba(252,92,101,0.3)";
}

function SCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub?: string; color?: string; icon: any;
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color: color ?? "hsl(215 20% 55%)" }} />
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className="text-xl font-bold font-mono" style={{ color: color ?? "hsl(var(--foreground))" }}>{value}</p>
      {sub && <p className="text-[10px] font-mono text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

// ── Add Key Form ──────────────────────────────────────────────────────────────
function AddKeyForm({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ label: "", apiKey: "", apiSecret: "", maxUsers: "" });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.label.trim() || !form.apiKey.trim()) {
      toast({ title: "Label and API Key are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/admin/decart-keys", {
      method: "POST",
      headers: authH(),
      body: JSON.stringify({
        label: form.label.trim(),
        apiKey: form.apiKey.trim(),
        apiSecret: form.apiSecret.trim() || "",
        maxUsers: form.maxUsers ? parseInt(form.maxUsers, 10) : null,
      }),
    });
    setSaving(false);
    if (res.ok) { toast({ title: "Decart key added" }); onSave(); }
    else toast({ title: "Failed to add key", variant: "destructive" });
  };

  const inp = "w-full bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none";
  const wrap = "rounded-lg px-3 py-2 flex-1" + " " + "border";

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(var(--primary) / 0.3)" }}>
      <p className="text-sm font-bold font-mono text-foreground">Add Decart API Key</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { key: "label" as const, label: "Label", ph: "e.g. Primary Key" },
          { key: "apiKey" as const, label: "API Key", ph: "sk-..." },
          { key: "apiSecret" as const, label: "API Secret (optional)", ph: "secret..." },
          { key: "maxUsers" as const, label: "Max Streams (optional)", ph: "e.g. 5" },
        ].map(({ key, label, ph }) => (
          <div key={key}>
            <p className="text-[10px] font-mono text-muted-foreground mb-1 uppercase tracking-wider">{label}</p>
            <div className="rounded-lg px-3 py-2" style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 18%)" }}>
              <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={ph} type={key === "apiSecret" ? "password" : "text"}
                className="w-full bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <button onClick={submit} disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-mono font-medium transition-colors disabled:opacity-50"
          style={{ background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.3)" }}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin inline-block mr-1" /> : null}
          Add Key
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-mono text-muted-foreground hover:text-foreground transition-colors"
          style={{ border: "1px solid hsl(222 40% 18%)" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AdminDecartKeysPage() {
  const { toast } = useToast();
  const [keys, setKeys]               = useState<DecartKey[]>([]);
  const [statuses, setStatuses]       = useState<DecartKeyStatus[]>([]);
  const [licKeys, setLicKeys]         = useState<LicenseKey[]>([]);
  const [sessions, setSessions]       = useState<ActiveSession[]>([]);
  const [loading, setLoading]         = useState(true);
  const [lastPoll, setLastPoll]       = useState("");
  const [showAdd, setShowAdd]         = useState(false);
  const [expanded, setExpanded]       = useState<Set<number>>(new Set());
  const [showKey, setShowKey]         = useState<Set<number>>(new Set());
  const [filterHealth, setFilterHealth] = useState<string>("all");
  const [search, setSearch]           = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    const [keysRes, statRes, licRes, sessRes] = await Promise.all([
      apiFetch<{ keys: DecartKey[] }>("/api/admin/decart-keys"),
      apiFetch<{ statuses: DecartKeyStatus[] }>("/api/admin/decart-credits"),
      apiFetch<{ keys: LicenseKey[] }>("/api/admin/billing-rate-per-key?limit=500"),
      apiFetch<{ sessions: ActiveSession[] }>("/api/admin/sessions"),
    ]);
    if (keysRes && Array.isArray(keysRes.keys)) setKeys(keysRes.keys);
    if (statRes && Array.isArray(statRes.statuses)) setStatuses(statRes.statuses);
    if (licRes && Array.isArray(licRes.keys)) setLicKeys(licRes.keys);
    if (sessRes && Array.isArray(sessRes.sessions)) setSessions(sessRes.sessions);
    setLastPoll(new Date().toLocaleTimeString());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, 4000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchAll]);

  // Enriched key data
  const enriched = keys.map(dk => {
    const stat = statuses.find(s => s.id === dk.id);
    const assignedLics = licKeys.filter(lk => {
      const dkAssigned = String(dk.assignedLicenseKey ?? "");
      return dkAssigned && lk.licenseKey === dkAssigned;
    });
    const activeSess = sessions.filter(s => s.decartKeyId === dk.id && s.status === "active");
    const totalUsedSec = licKeys.reduce((a, k) => a + k.usedSeconds, 0);
    const expectedBurn  = Math.round(totalUsedSec * COST_RATE * 100) / 100;
    const creditsUsed   = Math.max(0, dk.totalCreditsLoaded - dk.creditsBaseline);
    const burnDrift     = expectedBurn > 0 ? Math.round(Math.abs((creditsUsed - expectedBurn) / expectedBurn) * 10000) / 100 : 0;
    const maxU          = dk.maxUsers ?? 0;
    const activeStreams  = activeSess.length;
    const loadPct       = maxU > 0 ? Math.min(100, Math.round((activeStreams / maxU) * 100)) : 0;
    const overloaded    = maxU > 0 && activeStreams >= maxU;
    const driftH        = driftHealth(burnDrift);
    const liveRealSec   = activeSess.reduce((a, s) => {
      if (!s.startedAt) return a;
      try { return a + Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000); }
      catch { return a; }
    }, 0);
    const estRemaining  = stat?.estimatedRemainingSeconds ?? null;

    return {
      ...dk, stat, assignedLics, activeSess, expectedBurn, creditsUsed,
      burnDrift, loadPct, overloaded, driftH, liveRealSec, estRemaining, activeStreams,
    };
  });

  // Summary
  const totalKeys     = enriched.length;
  const activeDecart  = enriched.filter(k => k.isActive).length;
  const totalStreams   = enriched.reduce((a, k) => a + k.activeStreams, 0);
  const totalBurn     = Math.round(enriched.reduce((a, k) => a + k.creditsUsed, 0) * 100) / 100;
  const totalExpected = Math.round(enriched.reduce((a, k) => a + k.expectedBurn, 0) * 100) / 100;
  const driftAlerts   = enriched.filter(k => k.driftH !== "good").length;
  const totalBalance  = enriched.reduce((a, k) => a + k.totalCreditsLoaded, 0);
  const overloaded    = enriched.filter(k => k.overloaded).length;
  const totalCapacity = enriched.reduce((a, k) => a + (k.maxUsers ?? 0), 0);
  const poolPct       = totalCapacity > 0 ? Math.round((totalStreams / totalCapacity) * 100) : 0;

  // Filtered
  const filtered = enriched.filter(k => {
    if (filterHealth !== "all") {
      if (filterHealth === "overloaded" && !k.overloaded) return false;
      if (filterHealth === "drift" && k.driftH === "good") return false;
      if (filterHealth === "healthy" && k.driftH !== "good") return false;
    }
    if (search && !k.label.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const toggle      = (id: number) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleShow  = (id: number) => setShowKey(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleActive = async (id: number, currentlyActive: boolean) => {
    const ep = currentlyActive ? `/api/admin/decart-keys/${id}/deactivate` : `/api/admin/decart-keys/${id}/activate`;
    const res = await fetch(ep, { method: "POST", headers: authH() });
    if (res.ok) { toast({ title: currentlyActive ? "Key deactivated" : "Key activated" }); fetchAll(); }
    else toast({ title: "Failed to update key", variant: "destructive" });
  };

  const deleteKey = async (id: number, label: string) => {
    if (!confirm(`Delete Decart key "${label}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/decart-keys/${id}`, { method: "DELETE", headers: authH() });
    if (res.ok) { toast({ title: "Key deleted" }); fetchAll(); }
    else toast({ title: "Failed to delete key", variant: "destructive" });
  };

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 lg:p-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Key className="w-6 h-6 text-primary" />
              Decart API Pool
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Infrastructure control center · Live burn monitoring · Manual key assignment only
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastPoll && <span className="text-xs text-muted-foreground font-mono">{lastPoll}</span>}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: "rgba(38,222,129,0.1)", border: "1px solid rgba(38,222,129,0.3)" }}>
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400 font-mono font-semibold">LIVE 4s</span>
            </div>
            <button onClick={fetchAll} className="text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={() => setShowAdd(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono transition-colors"
              style={{ background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.3)" }}>
              <Plus className="w-3.5 h-3.5" /> Add Key
            </button>
          </div>
        </div>

        {showAdd && <AddKeyForm onSave={() => { setShowAdd(false); fetchAll(); }} onCancel={() => setShowAdd(false)} />}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <SCard label="Total Decart Keys"    value={`${activeDecart}/${totalKeys}`} sub="active / total"        color="hsl(var(--foreground))" icon={Key} />
              <SCard label="Active Streams"        value={String(totalStreams)}            sub="live right now"        color="hsl(142 76% 36%)"       icon={Wifi} />
              <SCard label="Pool Capacity"         value={`${poolPct}%`}                  sub={`${totalStreams}/${totalCapacity} slots`} color={poolPct > 80 ? "hsl(0 84% 60%)" : poolPct > 50 ? "#fed330" : "hsl(142 76% 36%)"} icon={BarChart3} />
              <SCard label="Drift Alerts"          value={String(driftAlerts)}            sub="burn drift detected"   color={driftAlerts > 0 ? "#fed330" : "hsl(215 20% 55%)"} icon={AlertTriangle} />
              <SCard label="Overloaded Keys"       value={String(overloaded)}             sub="at max capacity"       color={overloaded > 0 ? "hsl(0 84% 60%)" : "hsl(215 20% 55%)"} icon={Zap} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <SCard label="Total Credit Balance"  value={String(totalBalance)}           sub="manual credits loaded" color="hsl(var(--foreground))" icon={DollarSign} />
              <SCard label="Total Expected Burn"   value={`${totalExpected} cr`}          sub="wallet.used_seconds × 2.3" color="hsl(215 20% 55%)" icon={Clock} />
              <SCard label="Total Actual Burn"     value={`${totalBurn} cr`}              sub="credits consumed"      color="hsl(215 20% 55%)"       icon={Activity} />
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 rounded-lg px-3 py-2"
                style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 18%)" }}>
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by label…"
                  className="bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none w-40" />
                {search && <button onClick={() => setSearch("")}><X className="w-3.5 h-3.5 text-muted-foreground" /></button>}
              </div>
              {(["all", "healthy", "drift", "overloaded"] as const).map(f => (
                <button key={f} onClick={() => setFilterHealth(f)}
                  className="px-3 py-2 rounded-lg text-xs font-mono border transition-colors capitalize"
                  style={filterHealth === f
                    ? { background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.3)" }
                    : { color: "hsl(215 20% 55%)", border: "1px solid hsl(222 40% 18%)" }}>
                  {f === "all" ? "All Keys" : f}
                </button>
              ))}
            </div>

            {/* Key Cards */}
            <div className="space-y-4">
              {filtered.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground font-mono text-sm">No keys match filter</div>
              ) : filtered.map(dk => {
                const isExp = expanded.has(dk.id);
                const isShow = showKey.has(dk.id);
                const dH = dk.driftH;
                return (
                  <div key={dk.id} className="rounded-xl overflow-hidden"
                    style={{ background: "hsl(222 44% 6%)", border: `1px solid ${dk.overloaded ? "rgba(252,92,101,0.4)" : driftBdr(dH)}` }}>

                    {/* Key Header */}
                    <div className="p-4 flex items-start justify-between flex-wrap gap-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">
                          <div className={`w-2.5 h-2.5 rounded-full ${dk.isActive ? "bg-green-400" : "bg-red-400"}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-mono font-bold text-foreground">{dk.label}</p>
                            {dk.overloaded && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded animate-pulse"
                                style={{ background: "rgba(252,92,101,0.15)", color: "#fc5c65", border: "1px solid rgba(252,92,101,0.4)" }}>
                                OVERLOADED
                              </span>
                            )}
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded"
                              style={{ background: dk.isActive ? "rgba(38,222,129,0.1)" : "rgba(252,92,101,0.1)", color: dk.isActive ? "#26de81" : "#fc5c65", border: `1px solid ${dk.isActive ? "rgba(38,222,129,0.3)" : "rgba(252,92,101,0.3)"}` }}>
                              {dk.healthStatus?.toUpperCase() ?? (dk.isActive ? "ACTIVE" : "INACTIVE")}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-muted-foreground">
                            <span>{isShow ? dk.apiKey : maskKey(dk.apiKey)}</span>
                            <button onClick={() => toggleShow(dk.id)} className="text-muted-foreground hover:text-foreground transition-colors">
                              {isShow ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Right actions */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => toggleActive(dk.id, dk.isActive)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-mono border transition-colors"
                          style={dk.isActive
                            ? { background: "rgba(252,92,101,0.08)", color: "#fc5c65", border: "1px solid rgba(252,92,101,0.25)" }
                            : { background: "rgba(38,222,129,0.08)", color: "#26de81", border: "1px solid rgba(38,222,129,0.25)" }}>
                          {dk.isActive ? <><PowerOff className="w-3 h-3" />Deactivate</> : <><Power className="w-3 h-3" />Activate</>}
                        </button>
                        <button onClick={() => deleteKey(dk.id, dk.label)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-mono border transition-colors"
                          style={{ background: "rgba(252,92,101,0.06)", color: "hsl(215 20% 55%)", border: "1px solid hsl(222 40% 18%)" }}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                        <button onClick={() => toggle(dk.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-mono border transition-colors text-muted-foreground hover:text-foreground"
                          style={{ border: "1px solid hsl(222 40% 18%)" }}>
                          {isExp ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {isExp ? "Collapse" : "Details"}
                        </button>
                      </div>
                    </div>

                    {/* Metrics Strip */}
                    <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {[
                        { label: "Active Streams", value: `${dk.activeStreams}${dk.maxUsers != null ? "/" + dk.maxUsers : ""}`, color: dk.overloaded ? "#fc5c65" : "#26de81" },
                        { label: "Load %",         value: `${dk.loadPct}%`,                color: dk.loadPct > 80 ? "#fc5c65" : dk.loadPct > 50 ? "#fed330" : "#26de81" },
                        { label: "Credits Loaded", value: String(dk.totalCreditsLoaded),   color: undefined },
                        { label: "Expected Burn",  value: `${dk.expectedBurn} cr`,         color: undefined },
                        { label: "Burn Drift",     value: `${dk.burnDrift}%`,              color: driftFg(dH) },
                        { label: "Est. Remaining", value: dk.estRemaining ? fmtSec(dk.estRemaining) : "—", color: undefined },
                      ].map(m => (
                        <div key={m.label} className="rounded-lg px-3 py-2" style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 11%)" }}>
                          <p className="text-[10px] font-mono text-muted-foreground mb-0.5">{m.label}</p>
                          <p className="text-sm font-bold font-mono" style={{ color: m.color ?? "hsl(var(--foreground))" }}>{m.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Burn Drift Bar */}
                    <div className="px-4 pb-4">
                      <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                        <span className="text-muted-foreground">Burn Drift</span>
                        <span style={{ color: driftFg(dH) }}>{dk.burnDrift}% {dH === "good" ? "🟢" : dH === "warn" ? "🟡" : "🔴"}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(222 44% 4%)" }}>
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, dk.burnDrift * 4)}%`, background: driftFg(dH) }} />
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExp && (
                      <div style={{ borderTop: "1px solid hsl(222 40% 11%)" }}>
                        {/* Active Sessions for this key */}
                        {dk.activeSess.length > 0 && (
                          <div className="p-4 space-y-2">
                            <p className="text-xs font-mono font-bold text-muted-foreground uppercase tracking-wider mb-3">
                              Live Streams ({dk.activeSess.length})
                            </p>
                            {dk.activeSess.map(s => {
                              const elapsed = s.startedAt
                                ? Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000)
                                : 0;
                              const hbAge = s.lastHeartbeatAt
                                ? Math.floor((Date.now() - new Date(s.lastHeartbeatAt).getTime()) / 1000)
                                : null;
                              const streamH = hbAge != null && hbAge > 120 ? "stale" : "healthy";
                              return (
                                <div key={s.id} className="flex items-center gap-4 px-3 py-2 rounded-lg flex-wrap text-xs font-mono"
                                  style={{ background: "hsl(222 44% 4%)", border: `1px solid ${streamH === "stale" ? "rgba(252,92,101,0.2)" : "rgba(38,222,129,0.15)"}` }}>
                                  <div className="flex items-center gap-1.5">
                                    <span className={`w-1.5 h-1.5 rounded-full ${streamH === "stale" ? "bg-red-400" : "bg-green-400 animate-pulse"}`} />
                                    <span className="text-muted-foreground text-[10px]">{String(s.id).slice(0, 10)}…</span>
                                  </div>
                                  <div><p className="text-[9px] text-muted-foreground">Duration</p><p className="text-foreground">{fmtSec(elapsed)}</p></div>
                                  <div><p className="text-[9px] text-muted-foreground">Real Seconds</p><p className="text-foreground">{fmtSec(elapsed)}</p></div>
                                  <div><p className="text-[9px] text-muted-foreground">Last HB</p><p style={{ color: streamH === "stale" ? "#fc5c65" : "#26de81" }}>{hbAge != null ? `${hbAge}s ago` : "—"}</p></div>
                                  <div><p className="text-[9px] text-muted-foreground">Health</p>
                                    <p style={{ color: streamH === "stale" ? "#fc5c65" : "#26de81" }}>{streamH === "stale" ? "🔴 STALE" : "🟢 HEALTHY"}</p></div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Assigned License Keys */}
                        <div className="p-4" style={{ borderTop: dk.activeSess.length > 0 ? "1px solid hsl(222 40% 11%)" : "none" }}>
                          <p className="text-xs font-mono font-bold text-muted-foreground uppercase tracking-wider mb-3">
                            Assigned Licence Keys
                          </p>
                          {dk.assignedLics.length === 0 ? (
                            <p className="text-xs text-muted-foreground font-mono">
                              {dk.assignedLicenseKey
                                ? `Assigned to: ${dk.assignedLicenseKey}`
                                : "No licence keys directly assigned to this Decart key"}
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {dk.assignedLics.map(lk => {
                                const rev  = Math.round(lk.usedSeconds * lk.effectiveRate * 100) / 100;
                                const cost = Math.round(lk.usedSeconds * COST_RATE * 100) / 100;
                                const prof = Math.round((rev - cost) * 100) / 100;
                                return (
                                  <div key={lk.licenseKeyId} className="flex items-center gap-4 flex-wrap px-3 py-2 rounded-lg text-xs font-mono"
                                    style={{ background: "hsl(222 44% 4%)", border: "1px solid hsl(222 40% 11%)" }}>
                                    <div className="flex items-center gap-1.5">
                                      <span className={`w-1.5 h-1.5 rounded-full ${lk.isLive ? "bg-green-400 animate-pulse" : lk.isActive ? "bg-green-400/40" : "bg-muted"}`} />
                                      <span className="text-foreground font-bold" title={lk.licenseKey}>{fmtKey(lk.licenseKey)}</span>
                                    </div>
                                    <div><p className="text-[9px] text-muted-foreground">Rate</p><p className="text-foreground">{lk.effectiveRate} cr/s</p></div>
                                    <div><p className="text-[9px] text-muted-foreground">Compress×</p><p style={{ color: lk.compressionFactor !== 1 ? "hsl(187 100% 52%)" : "hsl(215 20% 55%)" }}>{lk.compressionFactor}×</p></div>
                                    <div><p className="text-[9px] text-muted-foreground">Real Used</p><p className="text-foreground">{fmtSec(lk.usedSeconds)}</p></div>
                                    <div><p className="text-[9px] text-muted-foreground">Display Used</p><p className="text-primary">{fmtSec(lk.displaySecondsUsed)}</p></div>
                                    <div><p className="text-[9px] text-muted-foreground">Revenue</p><p className="text-green-400">{rev > 0 ? rev : "—"}</p></div>
                                    <div><p className="text-[9px] text-muted-foreground">Cost</p><p className="text-red-400/70">{cost > 0 ? cost : "—"}</p></div>
                                    <div><p className="text-[9px] text-muted-foreground">Profit</p>
                                      <p style={{ color: prof > 0 ? "#26de81" : prof < 0 ? "#fc5c65" : "hsl(215 20% 55%)" }}>
                                        {prof !== 0 ? (prof > 0 ? `+${prof}` : String(prof)) : "—"}
                                      </p>
                                    </div>
                                    <div className="ml-auto">
                                      {lk.isLive
                                        ? <span className="text-[10px] font-mono text-green-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />LIVE</span>
                                        : <span className="text-[10px] font-mono text-muted-foreground">idle</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Meta */}
                        <div className="px-4 pb-4 flex gap-4 text-[10px] font-mono text-muted-foreground flex-wrap"
                          style={{ borderTop: "1px solid hsl(222 40% 11%)" }}>
                          <span>Created: {fmtDate(dk.createdAt)}</span>
                          {dk.lastTopupAt && <span>Last Top-up: {fmtDate(dk.lastTopupAt)}</span>}
                          {dk.assignedLicenseKey && <span>Assigned to: <span className="text-foreground">{fmtKey(dk.assignedLicenseKey)}</span></span>}
                          <span>Max Streams: {dk.maxUsers ?? "unlimited"}</span>
                          <span>Threshold: {dk.thresholdPct}%</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
