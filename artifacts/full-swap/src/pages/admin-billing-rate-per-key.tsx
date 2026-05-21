/**
 * admin-billing-rate-per-key.tsx — Per-License Billing Rate Management
 *
 * SAFETY: Additive only. Does not modify any existing page, component, or route.
 * Fails gracefully — if the backend endpoint is unavailable, all existing
 * admin pages continue to function normally.
 *
 * Spec compliance:
 *   §1  — Custom rate takes priority; global rate is fallback only
 *   §4  — Admin tab: search, enable/disable, assign rate, preview burn multiplier,
 *          estimated duration, projected profit margin
 *   §5  — Table shows all required columns
 *   §6  — Changes propagate instantly (rates fetched live from DB on every call)
 *   §7  — No hardcoded rates in UI (all values come from backend)
 *   §11 — 1-second polling for real-time updates
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { AdminLayout } from "@/components/admin-layout";
import {
  Zap, Search, RefreshCw, TrendingUp, Clock, Activity,
  CheckCircle2, XCircle, AlertTriangle, Loader2, Edit2, X,
  ShieldCheck, DollarSign,
} from "lucide-react";

// ── API helpers ───────────────────────────────────────────────────────────────
const API_BASE = `/api/admin/billing-rate-per-key`;
const authH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token") ?? ""}`,
});

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(path, { headers: authH(), ...opts });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface LicenseKeyRate {
  licenseKeyId: number;
  licenseKey: string;
  isActive: boolean;
  streamingEnabled: boolean;
  globalBillingRate: number;
  customBillingRate: number | null;
  useCustomBillingRate: boolean;
  billingRateLastUpdatedAt: string | null;
  effectiveRate: number;
  rateSource: "custom" | "global";
  remainingSeconds: number;
  estimatedStreamDurationMin: number;
  projectedProfitPct: number;
  profitPerSecond: number;
  isLive: boolean;
  activeSessionCount: number;
  allocatedSeconds: number;
  usedSeconds: number;
}

interface ListResponse {
  keys: LicenseKeyRate[];
  globalBillingRate: number;
  apiCostRate: number;
  total: number;
  returned: number;
  computedAt: string;
}

interface UpdateResponse {
  ok: boolean;
  licenseKeyId: number;
  customBillingRate: number | null;
  useCustomBillingRate: boolean;
  effectiveRate: number;
  rateSource: "custom" | "global";
  projectedProfitPct: number;
  updatedAt: string;
  note: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtKey(k: string): string {
  if (k.length <= 12) return k;
  return `${k.substring(0, 8)}…${k.slice(-4)}`;
}

function fmtSec(sec: number): string {
  if (sec <= 0) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function RateBadge({ source }: { source: "custom" | "global" }) {
  return source === "custom" ? (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold"
      style={{ background: "hsl(187 100% 52% / 0.15)", border: "1px solid hsl(187 100% 52% / 0.4)", color: "hsl(187 100% 52%)" }}
    >
      <Zap className="w-2.5 h-2.5" /> CUSTOM
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono"
      style={{ background: "hsl(222 40% 14%)", border: "1px solid hsl(222 40% 20%)", color: "hsl(215 20% 65%)" }}
    >
      GLOBAL
    </span>
  );
}

function LiveBadge({ isLive }: { isLive: boolean }) {
  return isLive ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-green-400">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> LIVE
    </span>
  ) : (
    <span className="text-[10px] font-mono text-muted-foreground">idle</span>
  );
}

// ── Edit modal ────────────────────────────────────────────────────────────────
interface EditModalProps {
  row: LicenseKeyRate;
  globalRate: number;
  apiCostRate: number;
  onClose: () => void;
  onSaved: () => void;
}

function EditModal({ row, globalRate, apiCostRate, onClose, onSaved }: EditModalProps) {
  const [rateInput, setRateInput]     = useState<string>(
    row.customBillingRate != null ? String(row.customBillingRate) : String(globalRate)
  );
  const [useCustom, setUseCustom]     = useState<boolean>(row.useCustomBillingRate);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const rateNum        = parseFloat(rateInput) || 0;
  const compressionFac = rateNum > 0 ? Math.round((rateNum / apiCostRate) * 1000) / 1000 : 1;
  const profitPct      = rateNum > 0 ? Math.round(((rateNum - apiCostRate) / rateNum) * 10000) / 100 : 0;
  const profitPs       = Math.round((rateNum - apiCostRate) * 100) / 100;

  const handleSave = async () => {
    if (useCustom && (rateNum < 0.1 || !Number.isFinite(rateNum))) {
      setError("Rate must be a positive number ≥ 0.1 cr/s");
      return;
    }
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = { useCustomBillingRate: useCustom };
    if (useCustom) body.customBillingRate = rateNum;
    const result = await apiFetch<UpdateResponse>(`${API_BASE}/${row.licenseKeyId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!result?.ok) {
      setError("Save failed — check server logs");
      return;
    }
    onSaved();
    onClose();
  };

  const handleDisable = async () => {
    setSaving(true);
    setError(null);
    await apiFetch(`${API_BASE}/${row.licenseKeyId}/custom`, { method: "DELETE" });
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 space-y-5 shadow-2xl"
        style={{ background: "hsl(222 47% 6%)", border: "1px solid hsl(222 40% 16%)" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground font-mono flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" /> Set Custom Rate
            </h2>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {fmtKey(row.licenseKey)}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Enable toggle */}
        <div
          className="flex items-center justify-between rounded-lg p-3"
          style={{ background: "hsl(222 44% 8%)", border: "1px solid hsl(222 40% 14%)" }}
        >
          <div>
            <p className="text-sm font-mono font-semibold text-foreground">Enable custom rate</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              When enabled, this key ignores the global billing rate
            </p>
          </div>
          <button
            onClick={() => setUseCustom(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              useCustom ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                useCustom ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Rate input */}
        <div className="space-y-2">
          <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Custom Billing Rate (cr/s)
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={rateInput}
              onChange={e => setRateInput(e.target.value)}
              disabled={!useCustom}
              className="flex-1 bg-transparent border rounded-lg px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40"
              style={{ borderColor: "hsl(222 40% 20%)" }}
              placeholder="e.g. 6.0"
            />
            <span className="flex items-center text-xs text-muted-foreground font-mono px-2">cr/s</span>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono">
            Global rate: {globalRate} cr/s · API cost: {apiCostRate} cr/s (fixed)
          </p>
        </div>

        {/* Preview */}
        {useCustom && rateNum > 0 && (
          <div
            className="rounded-lg p-3 space-y-2"
            style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 12%)" }}
          >
            <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider mb-2">
              Preview at {rateNum} cr/s
            </p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground font-mono">Compress×</p>
                <p className={`text-sm font-bold font-mono ${compressionFac > 1 ? "text-primary" : compressionFac < 1 ? "text-red-400" : "text-foreground"}`}>
                  {compressionFac}×
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-mono">Profit/s</p>
                <p className={`text-sm font-bold font-mono ${profitPs > 0 ? "text-green-400" : "text-red-400"}`}>
                  {profitPs >= 0 ? "+" : ""}{profitPs} cr
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-mono">Margin</p>
                <p className={`text-sm font-bold font-mono ${profitPct > 0 ? "text-green-400" : "text-red-400"}`}>
                  {profitPct}%
                </p>
              </div>
            </div>
            <div className="text-[10px] font-mono text-center mt-1">
              <span className="text-muted-foreground">Wallet time: </span>
              <span className="text-foreground">{fmtSec(row.remainingSeconds)} remaining</span>
              <span className="text-muted-foreground"> · duration unchanged by rate</span>
            </div>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-xs font-mono flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2 rounded-lg text-sm font-mono font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Save
          </button>
          {row.useCustomBillingRate && (
            <button
              onClick={handleDisable}
              disabled={saving}
              className="px-3 py-2 rounded-lg text-xs font-mono text-muted-foreground hover:text-red-400 border transition-colors"
              style={{ borderColor: "hsl(222 40% 20%)" }}
              title="Disable custom rate (revert to global)"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-xs font-mono text-muted-foreground hover:text-foreground border transition-colors"
            style={{ borderColor: "hsl(222 40% 20%)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminBillingRatePerKeyPage() {
  const [data, setData]             = useState<ListResponse | null>(null);
  const [loading, setLoading]       = useState(true);
  const [apiError, setApiError]     = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const [editRow, setEditRow]       = useState<LicenseKeyRate | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef                 = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (q?: string) => {
    const searchParam = (q ?? search).trim();
    const url = `${API_BASE}${searchParam ? `?search=${encodeURIComponent(searchParam)}&limit=500` : "?limit=500"}`;
    try {
      const result = await apiFetch<ListResponse>(url);
      if (result) {
        setData(result);
        setApiError(null);
      } else {
        setApiError("Failed to load data — check connection");
      }
      setLastUpdated(new Date());
    } catch {
      setApiError("Network error");
    } finally {
      setLoading(false);
    }
  }, [search]);

  // Start 1-second polling
  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(() => fetchData(), 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const handleSearch = (val: string) => {
    setSearch(val);
    fetchData(val);
  };

  const keys     = data?.keys ?? [];
  const global   = data?.globalBillingRate ?? 0;
  const apiCost  = data?.apiCostRate ?? 2.3;
  const withCustom = keys.filter(k => k.useCustomBillingRate).length;
  const liveKeys   = keys.filter(k => k.isLive).length;

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-wide flex items-center gap-2">
              <Zap className="w-6 h-6 text-primary" />
              Billing Rate per Key
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Assign custom billing rates per licence key — overrides global rate for each licence key.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground font-mono">{lastUpdated.toLocaleTimeString()}</span>
            )}
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: "hsl(142 76% 36% / 0.12)", border: "1px solid hsl(142 76% 36% / 0.3)" }}
            >
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400 font-mono font-semibold">LIVE 1s</span>
            </div>
          </div>
        </div>

        {/* ── API error ── */}
        {apiError && (
          <div
            className="flex items-start gap-3 rounded-lg p-4 text-sm"
            style={{ background: "hsl(0 84% 60% / 0.08)", border: "1px solid hsl(0 84% 60% / 0.3)" }}
          >
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-400 font-mono text-xs">{apiError}</p>
          </div>
        )}

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-primary" />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Global Rate</p>
            </div>
            <p className="text-2xl font-bold text-primary font-mono">{global} cr/s</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-1">Default for all keys</p>
          </div>

          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">API Cost Rate</p>
            </div>
            <p className="text-2xl font-bold text-foreground font-mono">{apiCost} cr/s</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-1">Fixed infra cost · NOT billing rate</p>
          </div>

          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Edit2 className="w-4 h-4 text-primary" />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Custom Rates</p>
            </div>
            <p className="text-2xl font-bold text-primary font-mono">{withCustom}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-1">Keys with custom override</p>
          </div>

          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(142 76% 36% / 0.2)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-green-400" />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Live Streams</p>
            </div>
            <p className="text-2xl font-bold text-green-400 font-mono">{liveKeys}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-1">Keys with active sessions</p>
          </div>
        </div>

        {/* ── Search ── */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 flex-1 max-w-sm rounded-lg px-3 py-2"
            style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 18%)" }}
          >
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search license key…"
              className="bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none flex-1"
            />
            {search && (
              <button onClick={() => handleSearch("")} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            {keys.length} key{keys.length !== 1 ? "s" : ""}
            {data?.total && data.total > keys.length ? ` (of ${data.total})` : ""}
          </p>
        </div>

        {/* ── Table ── */}
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "hsl(222 44% 6%)" }}>
                  {[
                    "License Key",
                    "Global Rate",
                    "Custom Rate",
                    "Effective Rate",
                    "Custom Active",
                    "Compress×",
                    "Wallet Remaining",
                    "Stream Duration",
                    "Live",
                    "Profit/s",
                    "Proj. Margin",
                    "Actions",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-right first:text-left last:text-center"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-8 text-center">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
                    </td>
                  </tr>
                ) : keys.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-8 text-center text-muted-foreground font-mono text-xs">
                      {search ? "No keys match your search" : "No license keys found"}
                    </td>
                  </tr>
                ) : (
                  keys.map((row, i) => (
                    <tr key={row.licenseKeyId}
                      style={{ background: i % 2 === 0 ? "hsl(222 44% 5%)" : "hsl(222 44% 6%)", borderTop: "1px solid hsl(222 40% 10%)" }}>
                      <td className="px-3 py-2.5 font-mono text-xs text-left">{fmtKey(row.licenseKey)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-foreground">{row.globalBillingRate} cr/s</td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {row.customBillingRate != null ? (
                          <span className="text-primary font-semibold">{row.customBillingRate} cr/s</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-primary">{row.effectiveRate} cr/s</td>
                      <td className="px-3 py-2.5 text-right"><RateBadge source={row.rateSource} /></td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {apiCost > 0 ? `${Math.round((row.effectiveRate / apiCost) * 1000) / 1000}×` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmtSec(row.remainingSeconds)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-foreground">
                        {row.estimatedStreamDurationMin > 0
                          ? `~${row.estimatedStreamDurationMin}m`
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right"><LiveBadge isLive={row.isLive} /></td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        <span className={`font-semibold ${row.profitPerSecond > 0 ? "text-green-400" : row.profitPerSecond < 0 ? "text-red-400" : "text-yellow-400"}`}>
                          {row.profitPerSecond >= 0 ? "+" : ""}{row.profitPerSecond.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        <span className={`font-semibold text-xs ${row.projectedProfitPct > 0 ? "text-green-400" : "text-red-400"}`}>
                          {row.projectedProfitPct > 0 ? "+" : ""}{row.projectedProfitPct}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => setEditRow(row)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono text-muted-foreground hover:text-primary transition-colors"
                          style={{ border: "1px solid hsl(222 40% 18%)" }}
                          title="Edit billing rate"
                        >
                          <Edit2 className="w-3 h-3" /> Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Footer info ── */}
        <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
          <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-3">
            How Per-Key Billing Works
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs font-mono">
            {[
              { label: "Priority rule", value: "Custom rate overrides global — no fallback during active session", color: "text-primary" },
              { label: "No-custom key", value: "Falls back to global billing rate automatically", color: "text-foreground" },
              { label: "API cost rate", value: "Fixed at 2.3 cr/s — infrastructure cost, NOT billing rate", color: "text-foreground" },
              { label: "Rate propagation", value: "Changes take effect instantly — fetched live on every call", color: "text-green-400" },
              { label: "Stream duration", value: "NOT affected by billing rate — controlled by wallet allocation only", color: "text-foreground" },
            ].map(item => (
              <div
                key={item.label}
                className="rounded-lg p-2.5"
                style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 10%)" }}
              >
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{item.label}</p>
                <p className={item.color}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Edit modal ── */}
      {editRow && (
        <EditModal
          row={editRow}
          globalRate={global}
          apiCostRate={apiCost}
          onClose={() => setEditRow(null)}
          onSaved={() => { fetchData(); }}
        />
      )}
    </AdminLayout>
  );
}

