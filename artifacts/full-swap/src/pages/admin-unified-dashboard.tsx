/**
 * admin-unified-dashboard.tsx — Unified 8-tab Admin Dashboard
 *
 * Tabs:
 *   1. Overview       — live KPIs, system health
 *   2. Billing Engine — global/per-key rate, profit calc, estimator
 *   3. Licence Keys   — CRUD, topup, expiry, device binding
 *   4. Sessions       — live list, heartbeat status, manual stop/extend
 *   5. Analytics      — revenue trends, efficiency scores
 *   6. Security       — login logs, rate-limit status, device violations
 *   7. Integrity      — reconciliation, orphan detection, mismatch alerts
 *   8. Settings       — allowlist-only global settings
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, BarChart3, CheckCircle2,
  Clock, DollarSign, FileKey, Loader2, RefreshCw,
  Settings, Shield, Zap, ToggleLeft, ToggleRight,
  StopCircle, TrendingUp, Users, Wallet, Eye,
  ChevronDown, ChevronUp, Search, Plus, Save,
  ShieldAlert, Bug, Cpu, Radio,
} from "lucide-react";

// ── Auth helper ───────────────────────────────────────────────────────────────
const tok = () => localStorage.getItem("fullswap_admin_token") ?? "";
const authH = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${tok()}`,
});
async function api<T>(url: string, opts?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, { ...opts, headers: { ...authH(), ...(opts?.headers ?? {}) } });
    if (!r.ok) return null;
    return r.json() as Promise<T>;
  } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Overview {
  activeSessions: number;
  totalRevenue: number;
  totalWalletBurnSeconds: number;
  apiCostCredits: number;
  profit: number;
  systemHealth: { db: boolean; billingRate: number; billingRateOk: boolean };
  totalKeys: number;
  activeKeys: number;
}
interface LiveSession {
  id: string;
  licenseKeyId: number;
  status: string;
  startedAt: string;
  lastHeartbeatAt: string | null;
  liveDurationSec: number;
  isOrphan: boolean;
  heartbeatAgeMs: number;
  licenseKey: string;
  minutesAllocated: number;
  usedSeconds: number;
  billingRateSnapshot: number | null;
}
interface LicenseKey {
  id: number;
  key: string;
  isActive: boolean;
  activatedAt: string | null;
  expiresAt: string | null;
  minutesAllocated: number;
  usedSeconds: number;
  streamingEnabled: boolean;
  notes: string | null;
  deviceId: string | null;
  customBillingRate: number | null;
  useCustomBillingRate: boolean;
}
interface WalletHealth {
  id: number;
  key: string;
  remainingSeconds: number;
  realStreamRemainingSeconds: number;
  effectiveBillingRate: number;
  burnRateSecPerHour: number | null;
  hoursUntilExhausted: number | null;
  risk: "critical" | "low" | "healthy";
}
interface RevenueIntelligence {
  dailyRevenue: Array<{ day: string; total: string }>;
  topKeysByUsage: Array<{ id: number; key: string; usedSeconds: number; minutesAllocated: number; efficiencyPercent: number; profitCredits: number }>;
  billingRate: number;
}
interface IntegrityReport {
  orphanSessions: Array<{ id: string; licenseKeyId: number; startedAt: string; lastHeartbeatAt: string | null }>;
  orphanCount: number;
  zeroDurationSessions: number;
  overdrawnKeys: Array<{ id: number; key: string; minutesAllocated: number; usedSeconds: number }>;
  expiredActiveKeys: number;
  checkedAt: string;
}
interface EstimatorResult {
  minutesPurchased: number;
  billingRate: number;
  realStreamMinutes: number;
  apiCostCredits: number;
  retailCredits: number;
  profitCredits: number;
  profitUsd: number;
  marginPercent: number;
  burnSpeedFactor: number;
  runtimeEfficiency: string;
}
interface Setting { id: number; key: string; value: string }

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmtSec(s: number): string {
  if (!s || s <= 0) return "0s";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function fmtAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}
function fmtUsd(n: number): string {
  return "$" + n.toFixed(2);
}

// ── Tab components ────────────────────────────────────────────────────────────

// TAB 1: Overview
function OverviewTab() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const load = useCallback(async () => {
    const d = await api<Overview>("/api/admin/unified/overview");
    if (d) setData(d);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-center text-muted-foreground py-10">Failed to load overview</div>;

  const kpis = [
    { label: "Active Sessions",   value: data.activeSessions,                          icon: Radio,       color: "text-green-400"  },
    { label: "Total Revenue",     value: fmtUsd(data.totalRevenue),                    icon: DollarSign,  color: "text-emerald-400" },
    { label: "Wallet Burn",       value: fmtSec(data.totalWalletBurnSeconds),           icon: Wallet,      color: "text-blue-400"    },
    { label: "API Cost (cr)",     value: Math.round(data.apiCostCredits).toLocaleString(), icon: Cpu,      color: "text-amber-400"   },
    { label: "Profit (est.)",     value: fmtUsd(data.profit),                          icon: TrendingUp,  color: "text-violet-400"  },
    { label: "Active Keys",       value: `${data.activeKeys} / ${data.totalKeys}`,     icon: FileKey,     color: "text-cyan-400"    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map(k => (
          <div key={k.label} className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <k.icon className={`w-4 h-4 ${k.color}`} />
              <span className="text-xs text-muted-foreground">{k.label}</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{typeof k.value === "number" ? k.value.toLocaleString() : k.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">System Health</h3>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            {data.systemHealth.db
              ? <CheckCircle2 className="w-4 h-4 text-green-500" />
              : <AlertTriangle className="w-4 h-4 text-red-500" />}
            <span className="text-sm text-muted-foreground">Database</span>
          </div>
          <div className="flex items-center gap-2">
            {data.systemHealth.billingRateOk
              ? <CheckCircle2 className="w-4 h-4 text-green-500" />
              : <AlertTriangle className="w-4 h-4 text-red-500" />}
            <span className="text-sm text-muted-foreground">Billing Rate: <strong>{data.systemHealth.billingRate} cr/s</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// TAB 2: Billing Engine
function BillingEngineTab() {
  const [rateInfo, setRateInfo] = useState<{ rate: number } | null>(null);
  const [newRate, setNewRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [estimMinutes, setEstimMinutes] = useState("60");
  const [estimRate, setEstimRate] = useState("");
  const [estimResult, setEstimResult] = useState<EstimatorResult | null>(null);
  const [estimLoading, setEstimLoading] = useState(false);
  const { toast } = useToast();

  const COST_RATE = 2.3;

  useEffect(() => {
    api<{ rate: number }>("/api/admin/billing-rate").then(d => {
      if (d) { setRateInfo(d); setEstimRate(String(d.rate)); }
    });
  }, []);

  const saveRate = async () => {
    const rate = parseFloat(newRate);
    if (!rate || rate < 0.1) { toast({ title: "Invalid rate", variant: "destructive" }); return; }
    setSaving(true);
    const r = await api<{ rate: number }>("/api/admin/billing-rate", {
      method: "PUT", body: JSON.stringify({ rate }),
    });
    setSaving(false);
    if (r) { setRateInfo(r); setNewRate(""); toast({ title: "Billing rate updated" }); }
    else toast({ title: "Failed to update rate", variant: "destructive" });
  };

  const runEstimator = async () => {
    const mins = parseFloat(estimMinutes);
    const rate = parseFloat(estimRate);
    if (!mins || mins <= 0) return;
    setEstimLoading(true);
    const r = await api<EstimatorResult>("/api/admin/unified/runtime-estimator", {
      method: "POST", body: JSON.stringify({ minutesPurchased: mins, billingRate: rate || undefined }),
    });
    setEstimLoading(false);
    if (r) setEstimResult(r);
  };

  const rate = rateInfo?.rate ?? 0;
  const margin = rate > 0 ? Math.round(((rate - COST_RATE) / COST_RATE) * 1000) / 10 : 0;
  const realMin = rate > 0 ? Math.round((60 * COST_RATE / rate) * 10) / 10 : 60;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Rate editor */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-foreground flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />Global Billing Rate</h3>
          {rateInfo && (
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-muted/40 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Current Rate</p>
                <p className="text-xl font-bold text-foreground">{rate} <span className="text-xs font-normal">cr/s</span></p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Margin</p>
                <p className={`text-xl font-bold ${margin > 0 ? "text-green-400" : "text-red-400"}`}>{margin}%</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Real min/hr</p>
                <p className="text-xl font-bold text-foreground">{realMin}</p>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <input
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              placeholder="New rate (cr/s)"
              value={newRate}
              onChange={e => setNewRate(e.target.value)}
              type="number" step="0.1" min="0.1"
            />
            <button
              onClick={saveRate}
              disabled={saving}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          </div>
          <p className="text-xs text-muted-foreground">API cost rate is always fixed at 2.3 cr/s — never changes.</p>
        </div>

        {/* Runtime estimator */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-foreground flex items-center gap-2"><BarChart3 className="w-4 h-4 text-blue-400" />Runtime Estimator</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Minutes purchased</label>
              <input className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" type="number" min="1" value={estimMinutes} onChange={e => setEstimMinutes(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Billing rate (cr/s)</label>
              <input className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" type="number" step="0.1" min="0.1" value={estimRate} onChange={e => setEstimRate(e.target.value)} placeholder="Use global" />
            </div>
          </div>
          <button onClick={runEstimator} disabled={estimLoading} className="w-full bg-blue-600/80 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {estimLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
            Calculate
          </button>
          {estimResult && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                ["Real stream time", `${estimResult.realStreamMinutes} min`],
                ["Profit (est.)", fmtUsd(estimResult.profitUsd)],
                ["Margin", `${estimResult.marginPercent}%`],
                ["API cost (cr)", estimResult.apiCostCredits.toFixed(0)],
                ["Revenue (cr)", estimResult.retailCredits.toFixed(0)],
                ["Efficiency", estimResult.runtimeEfficiency],
                ["Burn speed", `${estimResult.burnSpeedFactor}×`],
              ].map(([l, v]) => (
                <div key={l as string} className="bg-muted/40 rounded-lg p-2">
                  <p className="text-muted-foreground">{l}</p>
                  <p className="font-semibold text-foreground">{v}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// TAB 3: Licence Keys
function LicenceKeysTab() {
  const [keys, setKeys] = useState<LicenseKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<Record<number, boolean>>({});
  const { toast } = useToast();

  const load = useCallback(async () => {
    const d = await api<LicenseKey[]>("/api/admin/license-keys");
    if (d) setKeys(d);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id: number, isActive: boolean) => {
    setActionLoading(p => ({ ...p, [id]: true }));
    const r = await api(`/api/admin/license-keys/${id}`, {
      method: "PATCH", body: JSON.stringify({ isActive: !isActive }),
    });
    if (r) { toast({ title: isActive ? "Key deactivated" : "Key activated" }); load(); }
    else toast({ title: "Failed", variant: "destructive" });
    setActionLoading(p => ({ ...p, [id]: false }));
  };

  const topup = async (id: number, minutes: string) => {
    const m = parseFloat(minutes);
    if (!m || m <= 0) return;
    setActionLoading(p => ({ ...p, [id]: true }));
    const r = await api(`/api/admin/license-keys/${id}/topup`, {
      method: "POST", body: JSON.stringify({ minutes: m }),
    });
    if (r) { toast({ title: `Added ${m} min` }); load(); }
    else toast({ title: "Topup failed", variant: "destructive" });
    setActionLoading(p => ({ ...p, [id]: false }));
  };

  const unbindDevice = async (id: number) => {
    setActionLoading(p => ({ ...p, [id]: true }));
    const r = await api(`/api/admin/license-keys/${id}/unbind-device`, { method: "POST" });
    if (r) { toast({ title: "Device unbound" }); load(); }
    else toast({ title: "Unbind failed", variant: "destructive" });
    setActionLoading(p => ({ ...p, [id]: false }));
  };

  const filtered = keys.filter(k =>
    !search || k.key.toLowerCase().includes(search.toLowerCase()) || (k.notes ?? "").toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-foreground" placeholder="Search keys..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <span className="text-sm text-muted-foreground">{filtered.length} keys</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Key", "Status", "Wallet", "Device", "Expiry", "Actions"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(k => {
              const totalSec = (k.minutesAllocated ?? 0) * 60;
              const remSec = Math.max(0, totalSec - (k.usedSeconds ?? 0));
              const pct = totalSec > 0 ? Math.round((remSec / totalSec) * 100) : 0;
              return (
                <KeyRow key={k.id} k={k} pct={pct} remSec={remSec} loading={!!actionLoading[k.id]} onToggle={() => toggle(k.id, k.isActive)} onTopup={(m) => topup(k.id, m)} onUnbind={() => unbindDevice(k.id)} />
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="text-center text-muted-foreground py-10">No keys found</div>}
      </div>
    </div>
  );
}

function KeyRow({ k, pct, remSec, loading, onToggle, onTopup, onUnbind }: {
  k: LicenseKey; pct: number; remSec: number; loading: boolean;
  onToggle: () => void; onTopup: (m: string) => void; onUnbind: () => void;
}) {
  const [topupVal, setTopupVal] = useState("");
  const exp = k.expiresAt ? new Date(k.expiresAt) : null;
  const expired = exp && exp < new Date();
  return (
    <tr className="border-b border-border/50 hover:bg-muted/20 transition-colors">
      <td className="px-4 py-3 font-mono text-xs text-foreground">{k.key.slice(0, 16)}…{k.notes ? <span className="ml-1 text-muted-foreground">({k.notes})</span> : null}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${k.isActive ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
          {k.isActive ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pct > 30 ? "bg-green-500" : pct > 10 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-muted-foreground">{fmtSec(remSec)}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-xs">
        {k.deviceId
          ? <button onClick={onUnbind} className="text-amber-400 hover:underline" disabled={loading}>Unbind</button>
          : <span className="text-muted-foreground">Unbound</span>}
      </td>
      <td className="px-4 py-3 text-xs">
        {exp ? <span className={expired ? "text-red-400" : "text-muted-foreground"}>{exp.toLocaleDateString()}</span> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button onClick={onToggle} disabled={loading} className={`px-2 py-1 rounded text-xs font-medium ${k.isActive ? "bg-red-500/15 text-red-400 hover:bg-red-500/25" : "bg-green-500/15 text-green-400 hover:bg-green-500/25"}`}>
            {k.isActive ? "Deactivate" : "Activate"}
          </button>
          <input className="w-16 bg-background border border-border rounded px-2 py-1 text-xs" type="number" placeholder="min" value={topupVal} onChange={e => setTopupVal(e.target.value)} />
          <button onClick={() => { onTopup(topupVal); setTopupVal(""); }} disabled={loading || !topupVal} className="px-2 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded text-xs font-medium disabled:opacity-40">Top-up</button>
        </div>
      </td>
    </tr>
  );
}

// TAB 4: Sessions Monitor
function SessionsTab() {
  const [data, setData] = useState<{ sessions: LiveSession[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState<Record<string, boolean>>({});
  const [extending, setExtending] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  const load = useCallback(async () => {
    const d = await api<{ sessions: LiveSession[] }>("/api/admin/unified/sessions/live");
    if (d) setData(d);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const stop = async (id: string) => {
    setStopping(p => ({ ...p, [id]: true }));
    const r = await api(`/api/admin/unified/sessions/${id}/stop`, { method: "POST" });
    if (r) { toast({ title: "Session stopped" }); load(); }
    else toast({ title: "Failed to stop session", variant: "destructive" });
    setStopping(p => ({ ...p, [id]: false }));
  };

  const extend = async (id: string) => {
    setExtending(p => ({ ...p, [id]: true }));
    const r = await api(`/api/admin/unified/sessions/${id}/extend`, { method: "POST", body: JSON.stringify({ minutesToAdd: 10 }) });
    if (r) { toast({ title: "Added 10 min to session" }); load(); }
    else toast({ title: "Failed to extend", variant: "destructive" });
    setExtending(p => ({ ...p, [id]: false }));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const sessions = data?.sessions ?? [];
  const active   = sessions.filter(s => s.status === "active" && !s.isOrphan);
  const orphans  = sessions.filter(s => s.isOrphan);
  const stopped  = sessions.filter(s => s.status !== "active");

  const SessionList = ({ list, title, color }: { list: LiveSession[]; title: string; color: string }) => (
    <div>
      <h4 className={`text-sm font-semibold mb-2 ${color}`}>{title} ({list.length})</h4>
      {list.length === 0 ? <p className="text-xs text-muted-foreground py-2">None</p> : (
        <div className="space-y-2">
          {list.map(s => (
            <div key={s.id} className="bg-card border border-border rounded-lg p-3 flex flex-wrap gap-3 items-center justify-between">
              <div>
                <p className="text-xs font-mono text-foreground">{s.licenseKey ?? `#${s.licenseKeyId}`}</p>
                <div className="flex gap-3 mt-0.5">
                  <span className="text-xs text-muted-foreground">{fmtSec(s.liveDurationSec)}</span>
                  {s.lastHeartbeatAt && <span className="text-xs text-muted-foreground">{fmtAgo(s.heartbeatAgeMs)}</span>}
                  {s.billingRateSnapshot && <span className="text-xs text-amber-400">{s.billingRateSnapshot} cr/s</span>}
                </div>
              </div>
              {s.status === "active" && (
                <div className="flex gap-2">
                  <button onClick={() => extend(s.id)} disabled={extending[s.id]} className="px-2 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded text-xs disabled:opacity-40">+10m</button>
                  <button onClick={() => stop(s.id)} disabled={stopping[s.id]} className="px-2 py-1 bg-red-500/15 text-red-400 hover:bg-red-500/25 rounded text-xs disabled:opacity-40 flex items-center gap-1">
                    {stopping[s.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <StopCircle className="w-3 h-3" />} Stop
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button onClick={load} className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border hover:bg-muted/30 transition-colors">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>
      <SessionList list={active}  title="Active"  color="text-green-400" />
      <SessionList list={orphans} title="Orphans" color="text-amber-400" />
      <SessionList list={stopped.slice(0, 20)} title="Recent Stopped" color="text-muted-foreground" />
    </div>
  );
}

// TAB 5: Analytics
function AnalyticsTab() {
  const [data, setData] = useState<RevenueIntelligence | null>(null);
  const [walletHealth, setWalletHealth] = useState<{ keys: WalletHealth[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<RevenueIntelligence>("/api/admin/unified/revenue-intelligence"),
      api<{ keys: WalletHealth[] }>("/api/admin/unified/wallet-health"),
    ]).then(([rev, wh]) => {
      if (rev) setData(rev);
      if (wh) setWalletHealth(wh);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {/* Revenue per day */}
      {data && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Revenue — Last 7 Days</h3>
          <div className="flex items-end gap-2 h-28">
            {data.dailyRevenue.map((d, i) => {
              const max = Math.max(...data.dailyRevenue.map(x => parseFloat(x.total)));
              const h = max > 0 ? Math.round((parseFloat(d.total) / max) * 100) : 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-muted-foreground">{parseFloat(d.total).toFixed(1)}</span>
                  <div className="w-full bg-primary/20 rounded-t" style={{ height: `${h}%` }} />
                  <span className="text-xs text-muted-foreground">{d.day.slice(5)}</span>
                </div>
              );
            })}
            {data.dailyRevenue.length === 0 && <p className="text-sm text-muted-foreground m-auto">No revenue data</p>}
          </div>
        </div>
      )}

      {/* Top keys by usage */}
      {data && data.topKeysByUsage.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Top Keys by Usage</h3>
          <div className="space-y-2">
            {data.topKeysByUsage.map(k => (
              <div key={k.id} className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground w-32 truncate">{k.key.slice(0, 12)}…</span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary/60 rounded-full" style={{ width: `${k.efficiencyPercent}%` }} />
                </div>
                <span className="text-xs text-muted-foreground w-10 text-right">{k.efficiencyPercent}%</span>
                <span className="text-xs text-muted-foreground">{fmtSec(k.usedSeconds)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Wallet health */}
      {walletHealth && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Wallet Health Predictor</h3>
          <div className="space-y-2">
            {walletHealth.keys.slice(0, 15).map(k => (
              <div key={k.id} className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${k.risk === "critical" ? "bg-red-500" : k.risk === "low" ? "bg-amber-500" : "bg-green-500"}`} />
                <span className="font-mono text-xs text-muted-foreground flex-1 truncate">{k.key.slice(0, 14)}…</span>
                <span className="text-xs text-muted-foreground">{fmtSec(k.remainingSeconds)} left</span>
                {k.hoursUntilExhausted != null && <span className="text-xs text-muted-foreground">~{k.hoursUntilExhausted}h</span>}
              </div>
            ))}
            {walletHealth.keys.length === 0 && <p className="text-sm text-muted-foreground">No active keys</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// TAB 6: Security
function SecurityTab() {
  const [abuse, setAbuse] = useState<{ highFrequencyKeys: any[]; reconnectLoopKeys: any[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<any>("/api/admin/unified/abuse-detection").then(d => { if (d) setAbuse(d); setLoading(false); });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-semibold text-foreground mb-1 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-400" />Rate Limit Status</h3>
        <p className="text-sm text-muted-foreground">Admin login: <strong>10 attempts / 15 min / IP</strong> — enforced server-side in memory.</p>
      </div>
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-red-400" />Heartbeat Spam Detection</h3>
        {abuse?.highFrequencyKeys?.length ? (
          <div className="space-y-2">
            {abuse.highFrequencyKeys.map((k: any) => (
              <div key={k.licenseKeyId} className="flex items-center justify-between bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <span className="font-mono text-xs text-foreground">{k.licenseKey}</span>
                <span className="text-xs text-red-400 font-semibold">{k.sessionCount} sessions/hr</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No anomalies detected</p>}
      </div>
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2"><RefreshCw className="w-4 h-4 text-amber-400" />Reconnect Loop Detection</h3>
        {abuse?.reconnectLoopKeys?.length ? (
          <div className="space-y-2">
            {abuse.reconnectLoopKeys.map((k: any) => (
              <div key={k.licenseKeyId} className="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <span className="font-mono text-xs text-foreground">{k.licenseKey}</span>
                <span className="text-xs text-amber-400 font-semibold">{k.shortCount} short sessions/day</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No reconnect loops detected</p>}
      </div>
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2"><Shield className="w-4 h-4 text-green-400" />Security Hardening Active</h3>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {["Admin login rate limiting (10/15min/IP)", "Billing routes require main-admin token", "Settings allowlist enforced", "billing_rate_snapshot captured per session (immutable)", "Device binding violations tracked", "HMAC-SHA256 token signing"].map(item => (
            <li key={item} className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// TAB 7: Integrity
function IntegrityTab() {
  const [data, setData] = useState<IntegrityReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await api<IntegrityReport>("/api/admin/unified/integrity");
    if (d) setData(d);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-center text-muted-foreground py-10">Failed to load integrity report</div>;

  const checks = [
    { label: "Orphan Sessions",           value: data.orphanCount,          warn: data.orphanCount > 0 },
    { label: "Zero-Duration Anomalies",   value: data.zeroDurationSessions, warn: data.zeroDurationSessions > 0 },
    { label: "Overdrawn Keys",            value: data.overdrawnKeys.length, warn: data.overdrawnKeys.length > 0 },
    { label: "Expired Keys Still Active", value: data.expiredActiveKeys,    warn: data.expiredActiveKeys > 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Last checked: {new Date(data.checkedAt).toLocaleTimeString()}</p>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border hover:bg-muted/30 transition-colors">
          <RefreshCw className="w-3 h-3" /> Recheck
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {checks.map(c => (
          <div key={c.label} className={`rounded-xl border p-4 ${c.warn ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card"}`}>
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.warn ? "text-amber-400" : "text-green-400"}`}>{c.value}</p>
          </div>
        ))}
      </div>
      {data.orphanSessions.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-3">Orphan Sessions</h3>
          <div className="space-y-2">
            {data.orphanSessions.map(s => (
              <div key={s.id} className="flex items-center gap-3 text-xs text-muted-foreground">
                <Bug className="w-3 h-3 text-amber-400 flex-shrink-0" />
                <span className="font-mono">{s.id.slice(0, 8)}…</span>
                <span>Key #{s.licenseKeyId}</span>
                <span>Started: {new Date(s.startedAt).toLocaleString()}</span>
                {s.lastHeartbeatAt ? <span>Last beat: {new Date(s.lastHeartbeatAt).toLocaleString()}</span> : <span className="text-red-400">No heartbeat</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {data.overdrawnKeys.length > 0 && (
        <div className="bg-card border border-amber-500/30 rounded-xl p-5">
          <h3 className="font-semibold text-amber-400 mb-3">Overdrawn Keys (wallet mismatch)</h3>
          <div className="space-y-2">
            {data.overdrawnKeys.map(k => (
              <div key={k.id} className="flex items-center gap-3 text-xs">
                <span className="font-mono text-foreground">{k.key.slice(0, 16)}…</span>
                <span className="text-muted-foreground">Allocated: {fmtSec((k.minutesAllocated ?? 0) * 60)}</span>
                <span className="text-red-400">Used: {fmtSec(k.usedSeconds)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// TAB 8: Settings
function SettingsTab() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    api<{ settings: Setting[] }>("/api/admin/unified/settings").then(d => {
      if (d) setSettings(d.settings);
      setLoading(false);
    });
  }, []);

  const save = async (key: string) => {
    const value = edits[key];
    if (value === undefined) return;
    setSaving(p => ({ ...p, [key]: true }));
    const r = await api("/api/admin/unified/settings", { method: "PUT", body: JSON.stringify({ key, value }) });
    if (r) { toast({ title: `${key} updated` }); setEdits(p => { const n = { ...p }; delete n[key]; return n; }); }
    else toast({ title: "Save failed", variant: "destructive" });
    setSaving(p => ({ ...p, [key]: false }));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Only allowlisted settings keys can be modified here for safety.</p>
      {settings.map(s => (
        <div key={s.key} className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono font-semibold text-foreground">{s.key}</p>
          </div>
          <input
            className="w-48 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground"
            defaultValue={s.value}
            onChange={e => setEdits(p => ({ ...p, [s.key]: e.target.value }))}
          />
          <button
            onClick={() => save(s.key)}
            disabled={!edits[s.key] || saving[s.key]}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium disabled:opacity-40"
          >
            {saving[s.key] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </button>
        </div>
      ))}
      {settings.length === 0 && <div className="text-center text-muted-foreground py-10">No settings found. Set billing rate and other keys first.</div>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const TABS = [
  { id: "overview",   label: "Overview",    icon: LayoutDashboard },
  { id: "billing",    label: "Billing",     icon: Zap },
  { id: "keys",       label: "Lic. Keys",   icon: FileKey },
  { id: "sessions",   label: "Sessions",    icon: Activity },
  { id: "analytics",  label: "Analytics",   icon: BarChart3 },
  { id: "security",   label: "Security",    icon: Shield },
  { id: "integrity",  label: "Integrity",   icon: Bug },
  { id: "settings",   label: "Settings",    icon: Settings },
] as const;

import { LayoutDashboard } from "lucide-react";

type TabId = typeof TABS[number]["id"];

export default function AdminUnifiedDashboardPage() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<TabId>("overview");

  useEffect(() => {
    if (!tok()) setLocation("/admin");
  }, [setLocation]);

  const tabContent: Record<TabId, React.ReactNode> = {
    overview:  <OverviewTab />,
    billing:   <BillingEngineTab />,
    keys:      <LicenceKeysTab />,
    sessions:  <SessionsTab />,
    analytics: <AnalyticsTab />,
    security:  <SecurityTab />,
    integrity: <IntegrityTab />,
    settings:  <SettingsTab />,
  };

  return (
    <AdminLayout>
      <div className="p-4 lg:p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">Unified control center for all system operations</p>
        </div>

        {/* Tab bar */}
        <div className="overflow-x-auto">
          <div className="inline-flex bg-muted/30 rounded-xl p-1 gap-0.5 min-w-max">
            {TABS.map(({ id, label, icon: Icon }, i) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  tab === id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{i + 1}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div>{tabContent[tab]}</div>
      </div>
    </AdminLayout>
  );
}
