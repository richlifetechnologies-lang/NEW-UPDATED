import { useState, useEffect, useCallback, useRef } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Power, PowerOff, KeyRound, Eye, EyeOff,
  Activity, ChevronDown, ChevronUp, RefreshCw, AlertTriangle,
  AlertCircle, TrendingDown, Clock, Zap, Settings2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface KeyCreditStatus {
  id: number;
  label: string;
  isActive: boolean;
  totalCreditsLoaded: number;
  creditsUsed: number;
  creditsRemaining: number;
  thresholdPct: number;
  lastTopupAt: string | null;
  activeSessionCount: number;
  estimatedRemainingSeconds: number | null;
  warningLevel: "ok" | "low" | "critical";
}

interface SessionRecord {
  sessionId: string;
  licenseKeyId: number | null;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number;
  creditsConsumed: number;
  status: string;
}

interface GlobalSettings {
  globalThresholdPct: number;
  useGlobalThreshold: boolean;
}

interface DecartKey {
  id: number;
  label: string;
  apiKeyPreview: string;
  apiSecretPreview: string | null;
  isActive: boolean;
  maxLicenseKeys: number | null;
  assignedLicenseKeys: number;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAuthHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token")}`,
  };
}

function fmtSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function creditPct(used: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WarningBadge({ level }: { level: "ok" | "low" | "critical" }) {
  if (level === "ok") return null;
  if (level === "critical") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-red-950 text-red-400 border border-red-700 animate-pulse">
        <AlertCircle className="w-3 h-3" />
        CRITICAL — TOP UP REQUIRED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-yellow-950 text-yellow-400 border border-yellow-700">
      <AlertTriangle className="w-3 h-3" />
      LOW BALANCE
    </span>
  );
}

function CreditBar({ used, total, level }: { used: number; total: number; level: "ok" | "low" | "critical" }) {
  const pct = creditPct(used, total);
  const barColor =
    level === "critical"
      ? "bg-red-500"
      : level === "low"
      ? "bg-yellow-500"
      : "bg-emerald-500";

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>Used: <strong className="text-slate-200">{used.toLocaleString()}</strong> credits</span>
        <span>Total: <strong className="text-slate-200">{total.toLocaleString()}</strong></span>
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs mt-1">
        <span className="text-slate-500">{pct}% used</span>
        <span className={level === "ok" ? "text-emerald-400" : level === "low" ? "text-yellow-400" : "text-red-400"}>
          {(total - used).toLocaleString()} remaining
        </span>
      </div>
    </div>
  );
}

function UsageHistoryPanel({ keyId }: { keyId: number }) {
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0); // force re-render every second for live duration

  const fetchHistory = useCallback(() => {
    fetch(`/api/admin/decart-keys/${keyId}/usage-history?limit=20`, {
      headers: getAuthHeaders(),
    })
      .then((r) => r.json())
      .then((data) => { setHistory(data); setLoading(false); })
      .catch(() => { setHistory([]); setLoading(false); });
  }, [keyId]);

  // Initial load + auto-refresh every 10 seconds
  useEffect(() => {
    fetchHistory();
    const pollInterval = setInterval(fetchHistory, 10_000);
    return () => clearInterval(pollInterval);
  }, [fetchHistory]);

  // Tick every second so active session durations update live
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);

  const hasActive = history.some((s) => s.status === "active");

  if (loading) return <div className="text-xs text-slate-500 py-2">Loading history…</div>;
  if (history.length === 0) return <div className="text-xs text-slate-500 py-2">No sessions recorded yet for this key.</div>;

  return (
    <div className="overflow-x-auto mt-2">
      {hasActive && (
        <div className="flex items-center gap-1.5 mb-2 text-xs text-emerald-400">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Live session in progress — credits updating every 10s
        </div>
      )}
      <table className="w-full text-xs text-slate-300">
        <thead>
          <tr className="border-b border-slate-700 text-slate-500">
            <th className="text-left py-1 pr-3">Session ID</th>
            <th className="text-left py-1 pr-3">Started</th>
            <th className="text-left py-1 pr-3">Duration</th>
            <th className="text-right py-1 pr-3">Credits</th>
            <th className="text-left py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {history.map((s) => {
            const isActive = s.status === "active";
            // For active sessions compute live elapsed time client-side between polls
            const liveDur = isActive
              ? Math.max(s.durationSeconds, Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000))
              : s.durationSeconds;
            // Suppress unused tick warning — it forces re-render for live clock
            void tick;
            return (
              <tr key={s.sessionId} className={`border-b border-slate-800 ${isActive ? "bg-emerald-950/20" : "hover:bg-slate-800/40"}`}>
                <td className="py-1 pr-3 font-mono text-slate-400">{s.sessionId.slice(0, 8)}…</td>
                <td className="py-1 pr-3">{fmtDate(s.startedAt)}</td>
                <td className="py-1 pr-3 tabular-nums">{fmtSeconds(liveDur)}</td>
                <td className="py-1 pr-3 text-right font-semibold tabular-nums text-slate-200">
                  {(liveDur * 2).toLocaleString()}
                </td>
                <td className="py-1">
                  {isActive ? (
                    <span className="flex items-center gap-1 text-emerald-300">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      LIVE
                    </span>
                  ) : (
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                      s.status === "stopped" ? "bg-slate-700 text-slate-300" : "bg-red-900 text-red-300"
                    }`}>
                      {s.status}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminDecartKeysPage() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<DecartKey[]>([]);
  const [creditStatuses, setCreditStatuses] = useState<Record<number, KeyCreditStatus>>({});
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({ globalThresholdPct: 15, useGlobalThreshold: false });
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Add key form
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newApiSecret, setNewApiSecret] = useState("");
  const [newMaxUsers, setNewMaxUsers] = useState("");
  const [adding, setAdding] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<number, boolean>>({});

  // Per-key expanded state
  const [expandedHistory, setExpandedHistory] = useState<Record<number, boolean>>({});
  const [showThresholdFor, setShowThresholdFor] = useState<number | null>(null);
  const [showTopupFor, setShowTopupFor] = useState<number | null>(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [newThreshold, setNewThreshold] = useState("");

  // Global settings panel
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [globalThresholdInput, setGlobalThresholdInput] = useState("");

  // Auto-refresh
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/decart-keys", { headers: getAuthHeaders() });
      if (res.ok) setKeys(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  const fetchCreditStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/decart-keys/credit-status", { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const byId: Record<number, KeyCreditStatus> = {};
        (data.keys as KeyCreditStatus[]).forEach((k) => { byId[k.id] = k; });
        setCreditStatuses(byId);
        setGlobalSettings(data.globalSettings ?? { globalThresholdPct: 15, useGlobalThreshold: false });
      }
    } catch { /* silent */ }
  }, []);

  // Bug #1: Refresh button handler — shows spinner and prevents duplicate calls
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([fetchKeys(), fetchCreditStatus()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchKeys, fetchCreditStatus]);

  useEffect(() => {
    fetchKeys();
    fetchCreditStatus();
    // Auto-refresh credit status every 15s
    refreshIntervalRef.current = setInterval(fetchCreditStatus, 15_000);
    return () => { if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current); };
  }, [fetchKeys, fetchCreditStatus]);

  const addKey = async () => {
    if (!newLabel.trim() || !newApiKey.trim() || !newApiSecret.trim()) {
      toast({ title: "Label, API Key, and Secret Key are required", variant: "destructive" });
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/admin/decart-keys", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          label: newLabel.trim(), apiKey: newApiKey.trim(),
          apiSecret: newApiSecret.trim(), maxUsers: newMaxUsers ? parseInt(newMaxUsers) : null,
        }),
      });
      if (res.ok) {
        toast({ title: "API key added" });
        setNewLabel(""); setNewApiKey(""); setNewApiSecret(""); setNewMaxUsers(""); setShowAdd(false);
        fetchKeys(); fetchCreditStatus();
      } else {
        const err = await res.json();
        toast({ title: err.error || "Failed to add key", variant: "destructive" });
      }
    } catch { toast({ title: "Network error", variant: "destructive" }); }
    setAdding(false);
  };

  const toggleActive = async (id: number, currentlyActive: boolean) => {
    await fetch(`/api/admin/decart-keys/${id}`, {
      method: "PUT", headers: getAuthHeaders(),
      body: JSON.stringify({ isActive: !currentlyActive }),
    });
    fetchKeys();
    toast({ title: currentlyActive ? "Key deactivated" : "Key activated" });
  };

  const deleteKey = async (id: number, label: string) => {
    if (!confirm(`Delete API key "${label}"? All credit history and sessions will be removed.`)) return;
    try {
      const res = await fetch(`/api/admin/decart-keys/${id}`, { method: "DELETE", headers: getAuthHeaders() });
      if (res.ok) {
        toast({ title: "Key deleted" });
        await Promise.all([fetchKeys(), fetchCreditStatus()]);
      } else {
        const err = await res.json();
        toast({ title: err.error || "Failed to delete key", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
  };

  const submitTopup = async (keyId: number) => {
    const credits = parseInt(topupAmount);
    if (!credits || credits <= 0) { toast({ title: "Enter a valid credit amount", variant: "destructive" }); return; }
    const res = await fetch(`/api/admin/decart-keys/${keyId}/topup`, {
      method: "POST", headers: getAuthHeaders(),
      body: JSON.stringify({ credits }),
    });
    if (res.ok) {
      toast({ title: `${credits.toLocaleString()} credits added` });
      setShowTopupFor(null); setTopupAmount("");
      fetchCreditStatus();
    } else {
      toast({ title: "Top-up failed", variant: "destructive" });
    }
  };

  const submitThreshold = async (keyId: number) => {
    const pct = parseInt(newThreshold);
    if (isNaN(pct) || pct < 0 || pct > 100) { toast({ title: "Enter 0–100", variant: "destructive" }); return; }
    await fetch(`/api/admin/decart-keys/${keyId}/threshold`, {
      method: "PUT", headers: getAuthHeaders(),
      body: JSON.stringify({ thresholdPct: pct }),
    });
    toast({ title: "Threshold updated" });
    setShowThresholdFor(null); setNewThreshold("");
    fetchCreditStatus();
  };

  const saveGlobalSettings = async () => {
    const pct = parseInt(globalThresholdInput);
    if (isNaN(pct) || pct < 0 || pct > 100) { toast({ title: "Enter 0–100", variant: "destructive" }); return; }
    await fetch("/api/admin/decart-credit-settings", {
      method: "PUT", headers: getAuthHeaders(),
      body: JSON.stringify({ globalThresholdPct: pct, useGlobalThreshold: globalSettings.useGlobalThreshold }),
    });
    toast({ title: "Global settings saved" });
    setShowGlobalSettings(false);
    fetchCreditStatus();
  };

  const warningCount = Object.values(creditStatuses).filter((s) => s.warningLevel !== "ok").length;

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-violet-400" />
              Decart API Keys
              {warningCount > 0 && (
                <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-bold bg-red-950 text-red-400 border border-red-700">
                  {warningCount} warning{warningCount > 1 ? "s" : ""}
                </span>
              )}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">Credit balance tracking · 2 credits/sec billing</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setShowGlobalSettings(!showGlobalSettings); setGlobalThresholdInput(String(globalSettings.globalThresholdPct)); }}>
              <Settings2 className="w-3.5 h-3.5 mr-1.5" /> Global Settings
            </Button>
            <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Key
            </Button>
          </div>
        </div>

        {/* Global Settings Panel */}
        {showGlobalSettings && (
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200">Global Credit Warning Settings</h3>
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-400 w-48">Global threshold %</label>
              <Input
                type="number" min={0} max={100}
                value={globalThresholdInput}
                onChange={(e) => setGlobalThresholdInput(e.target.value)}
                className="w-24 h-8 text-sm"
                placeholder="15"
              />
              <span className="text-xs text-slate-500">Warn when remaining drops below this % of total</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-400 w-48">Override per-key thresholds</label>
              <input
                type="checkbox"
                checked={globalSettings.useGlobalThreshold}
                onChange={(e) =>
                  setGlobalSettings({ ...globalSettings, useGlobalThreshold: e.target.checked })
                }
                className="w-4 h-4"
              />
              <span className="text-xs text-slate-500">Apply global % to all keys (ignores per-key settings)</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveGlobalSettings}>Save</Button>
              <Button variant="outline" size="sm" onClick={() => setShowGlobalSettings(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Add Key Form */}
        {showAdd && (
          <div className="rounded-lg border border-violet-800/40 bg-slate-900 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200">Add New Decart API Key</h3>
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Label (e.g. Key-A)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className="h-8 text-sm" />
              <Input placeholder="Max license keys (optional)" type="number" value={newMaxUsers} onChange={(e) => setNewMaxUsers(e.target.value)} className="h-8 text-sm" />
              <Input placeholder="API Key" value={newApiKey} onChange={(e) => setNewApiKey(e.target.value)} className="h-8 text-sm font-mono" />
              <Input placeholder="API Secret" value={newApiSecret} onChange={(e) => setNewApiSecret(e.target.value)} className="h-8 text-sm font-mono" type="password" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={addKey} disabled={adding}>{adding ? "Adding…" : "Add Key"}</Button>
              <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Key Cards */}
        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : keys.length === 0 ? (
          <div className="text-sm text-slate-500 py-8 text-center">No API keys added yet.</div>
        ) : (
          <div className="space-y-4">
            {keys.map((key) => {
              const cs = creditStatuses[key.id];
              const historyOpen = expandedHistory[key.id] ?? false;

              return (
                <div
                  key={key.id}
                  className={`rounded-xl border bg-slate-900 p-5 space-y-4 ${
                    cs?.warningLevel === "critical"
                      ? "border-red-700/60"
                      : cs?.warningLevel === "low"
                      ? "border-yellow-700/50"
                      : "border-slate-700/50"
                  }`}
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${key.isActive ? "bg-emerald-400" : "bg-slate-600"}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="font-semibold text-slate-100 text-sm">{key.label}</h2>
                          <span className="text-xs text-slate-600 font-mono">#{key.id}</span>
                          <span className="text-xs font-semibold text-cyan-400 border border-cyan-800/50 bg-cyan-950/30 rounded px-1.5 py-0.5 flex items-center gap-1">
                            <KeyRound className="w-2.5 h-2.5" />{key.assignedLicenseKeys} key{key.assignedLicenseKeys !== 1 ? "s" : ""}
                          </span>
                          {cs && <WarningBadge level={cs.warningLevel} />}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 font-mono">
                          {showSecrets[key.id] ? key.apiKeyPreview : "••••••••••••••••"}
                          <button
                            onClick={() => setShowSecrets((p) => ({ ...p, [key.id]: !p[key.id] }))}
                            className="ml-2 text-slate-600 hover:text-slate-400"
                          >
                            {showSecrets[key.id] ? <EyeOff className="w-3 h-3 inline" /> : <Eye className="w-3 h-3 inline" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => toggleActive(key.id, key.isActive)}>
                        {key.isActive ? <Power className="w-3.5 h-3.5 text-emerald-400" /> : <PowerOff className="w-3.5 h-3.5 text-slate-500" />}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-red-400 hover:text-red-300" onClick={() => deleteKey(key.id, key.label)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Credit Bar */}
                  {cs && cs.totalCreditsLoaded > 0 && (
                    <CreditBar used={cs.creditsUsed} total={cs.totalCreditsLoaded} level={cs.warningLevel} />
                  )}
                  {cs && cs.totalCreditsLoaded === 0 && (
                    <div className="text-xs text-slate-500 bg-slate-800/50 rounded px-3 py-2">
                      No credits loaded. Use Top Up to set the initial balance.
                    </div>
                  )}

                  {/* Stats Row — 2 credits/sec = 120 credits/min → $0.01/credit → $72/hr */}
                  {cs && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-800/60 rounded-lg px-3 py-2">
                        <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1">
                          <Activity className="w-3 h-3" /> Active Sessions
                        </div>
                        <div className="text-lg font-bold text-slate-100">{cs.activeSessionCount}</div>
                      </div>
                      <div className="bg-slate-800/60 rounded-lg px-3 py-2">
                        <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1">
                          <Zap className="w-3 h-3" /> Available Credits
                        </div>
                        <div className={`text-lg font-bold ${
                          cs.warningLevel === "critical" ? "text-red-400" :
                          cs.warningLevel === "low" ? "text-yellow-400" : "text-emerald-400"
                        }`}>
                          {cs.creditsRemaining.toLocaleString()}
                        </div>
                        <div className="text-xs text-slate-600">÷ 120 = {(cs.creditsRemaining / 120).toFixed(1)} min available</div>
                      </div>
                      <div className="bg-slate-800/60 rounded-lg px-3 py-2">
                        <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Est. Stream Time
                        </div>
                        <div className="text-lg font-bold text-slate-100">
                          {fmtSeconds(Math.floor(cs.creditsRemaining / 2))}
                        </div>
                        <div className="text-xs text-slate-600">@ 2 credits/sec</div>
                      </div>
                      <div className="bg-slate-800/60 rounded-lg px-3 py-2">
                        <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1">
                          <TrendingDown className="w-3 h-3" /> Decart Balance Value
                        </div>
                        <div className="text-lg font-bold text-emerald-400">
                          ${(cs.creditsRemaining * 0.01).toFixed(2)}
                        </div>
                        <div className="text-xs text-slate-600">$0.01/credit · $72/hr</div>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-800">
                    {/* Top-up */}
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 text-emerald-400 border-emerald-800 hover:bg-emerald-950"
                      onClick={() => { setShowTopupFor(showTopupFor === key.id ? null : key.id); setTopupAmount(""); }}>
                      <Plus className="w-3 h-3" /> Top Up Credits
                    </Button>

                    {/* Threshold */}
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 text-slate-400 border-slate-700"
                      onClick={() => { setShowThresholdFor(showThresholdFor === key.id ? null : key.id); setNewThreshold(String(cs?.thresholdPct ?? 15)); }}>
                      <TrendingDown className="w-3 h-3" /> Threshold {cs ? `(${cs.thresholdPct}%)` : ""}
                    </Button>

                    {/* History */}
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 ml-auto text-slate-500"
                      onClick={() => setExpandedHistory((p) => ({ ...p, [key.id]: !p[key.id] }))}>
                      Usage History {historyOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </Button>
                  </div>

                  {/* Top-up inline form */}
                  {showTopupFor === key.id && (
                    <div className="flex items-center gap-2 mt-1 bg-emerald-950/30 border border-emerald-800/40 rounded-lg p-3">
                      <Input
                        type="number" min={1} placeholder="Credits to add (e.g. 10000)"
                        value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)}
                        className="h-8 text-sm w-52"
                      />
                      <span className="text-xs text-slate-500">÷ 120 = {topupAmount ? (parseInt(topupAmount) / 120).toFixed(1) : "0"} streaming minutes</span>
                      <Button size="sm" className="h-8 bg-emerald-700 hover:bg-emerald-600" onClick={() => submitTopup(key.id)}>Confirm Top Up</Button>
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => setShowTopupFor(null)}>Cancel</Button>
                    </div>
                  )}

                  {/* Threshold inline form */}
                  {showThresholdFor === key.id && (
                    <div className="flex items-center gap-2 mt-1 bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                      <span className="text-xs text-slate-400 w-48">Warn when remaining below:</span>
                      <Input
                        type="number" min={0} max={100} placeholder="15"
                        value={newThreshold} onChange={(e) => setNewThreshold(e.target.value)}
                        className="h-8 text-sm w-24"
                      />
                      <span className="text-xs text-slate-500">% of total credits</span>
                      <Button size="sm" className="h-8" onClick={() => submitThreshold(key.id)}>Save</Button>
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => setShowThresholdFor(null)}>Cancel</Button>
                    </div>
                  )}

                  {/* Usage History */}
                  {historyOpen && <UsageHistoryPanel keyId={key.id} />}

                  {cs && cs.lastTopupAt && (
                    <div className="text-xs text-slate-600">Last top-up: {fmtDate(cs.lastTopupAt)}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
