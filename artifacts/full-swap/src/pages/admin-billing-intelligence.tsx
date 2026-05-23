/**
 * admin-billing-intelligence.tsx — Billing Intelligence admin page.
 *
 * SAFETY: Additive only. Does not modify any existing page, component, or route.
 * Fails gracefully — if the backend endpoint is unavailable, all existing
 * admin pages continue to function normally.
 */

import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/admin-layout";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Ghost,
  Layers,
  RefreshCw,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { ProfitOptimizerPanel } from "@/components/profit-optimizer-panel";

// ── API helpers ───────────────────────────────────────────────────────────────
const API = (path: string) => `/api/admin/billing-intelligence${path}`;
const authH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token") ?? ""}`,
});

async function apiFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(API(path), { headers: authH() });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Summary {
  billingRate: number;
  activeSessions: number;
  orphanSessions: number;
  duplicateSessions: number;
  ghostSessions: number;
  reconnectLoopAlerts: number;
  totals: {
    totalSessions: number;
    totalComputeSeconds: number;
    totalBillingSeconds: number;
    totalActualApiCredits: number;
    totalRetailCredits: number;
    totalProfitMarginCredits: number;
    averageEffectiveCreditsPerSec: number;
  };
}

interface BillingSession {
  sessionId: string;
  licenseKey: string | null;
  licenseKeyId: number | null;
  decartKeyId: number | null;
  decartKeyLabel: string | null;
  status: string;
  startedAt: string;
  stoppedAt: string | null;
  billingStartedAt: string | null;
  lastHeartbeatAt: string | null;
  style: string | null;
  packageLabel: string | null;
  computeSeconds: number;
  billingSeconds: number;
  actualApiCredits: number;
  retailSeconds: number;
  retailCreditsCharged: number;
  billingRateAtQuery: number;
  effectiveCreditsPerSec: number;
  profitMarginCredits: number;
  settlementSource: string;
  sessionCloseReason: string | null;
  isGhostSession: boolean;
  anomalyFlag: string | null;
}

interface SessionsResp {
  sessions: BillingSession[];
  billingRate: number;
  count: number;
}

interface GhostData {
  zeroFrameSessions: any[];
  duplicateActiveSessions: any[];
  reconnectLoops: any[];
  staleSessions: any[];
  frozenSessions: any[];
  generatedAt: string;
}

interface SessionDetail {
  session: {
    sessionId: string;
    licenseKey: string | null;
    decartKeyLabel: string | null;
    status: string;
    style: string | null;
    packageLabel: string | null;
    minutesAllocated: number | null;
    startedAt: string;
    stoppedAt: string | null;
    billingStartedAt: string | null;
    lastHeartbeatAt: string | null;
    lastDeductedAt: string | null;
  };
  metrics: {
    computeSeconds: number;
    billingSeconds: number;
    actualApiCredits: number;
    retailSeconds: number;
    retailCreditsCharged: number;
    profitMarginCredits: number;
    effectiveCreditsPerSec: number;
    billingRateAtQuery: number;
    settlementSource: string;
    anomalyFlag: string | null;
  };
  timeline: Array<{ event: string; ts: string; note?: string }>;
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmtSec(s: number) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r > 0 ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function fmtTs(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusColor(status: string) {
  if (status === "active") return "text-green-400 bg-green-500/10 border-green-500/20";
  if (status === "stopped") return "text-slate-400 bg-slate-500/10 border-slate-500/20";
  return "text-amber-400 bg-amber-500/10 border-amber-500/20";
}

function profitColor(p: number) {
  if (p > 0) return "text-emerald-400";
  if (p < 0) return "text-red-400";
  return "text-slate-400";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCards({ data }: { data: Summary }) {
  const t = data.totals;
  const cards = [
    {
      label: "Total Retail Credits Charged",
      value: t.totalRetailCredits.toLocaleString(),
      sub: `${Math.round(t.totalRetailCredits / 300)} min retail`,
      icon: <Zap className="w-4 h-4 text-yellow-400" />,
    },
    {
      label: "Total Actual API Credits Used",
      value: t.totalActualApiCredits.toLocaleString(),
      sub: `${Math.round(t.totalActualApiCredits / 300)} min Decart cost`,
      icon: <Activity className="w-4 h-4 text-blue-400" />,
    },
    {
      label: "Total Estimated Profit",
      value: t.totalProfitMarginCredits.toLocaleString(),
      sub: t.totalProfitMarginCredits >= 0 ? "surplus" : "deficit",
      icon: <TrendingUp className="w-4 h-4 text-emerald-400" />,
      highlight: t.totalProfitMarginCredits >= 0 ? "text-emerald-400" : "text-red-400",
    },
    {
      label: "Avg Effective Credits/sec",
      value: t.averageEffectiveCreditsPerSec.toFixed(2),
      sub: `billing rate: ${data.billingRate} cr/s`,
      icon: <Clock className="w-4 h-4 text-purple-400" />,
    },
    {
      label: "Active Sessions",
      value: data.activeSessions,
      sub: `${data.orphanSessions} orphan`,
      icon: <Activity className="w-4 h-4 text-green-400" />,
    },
    {
      label: "Orphan Sessions",
      value: data.orphanSessions,
      sub: "no heartbeat >2min",
      icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
      highlight: data.orphanSessions > 0 ? "text-amber-400" : undefined,
    },
    {
      label: "Duplicate Sessions",
      value: data.duplicateSessions,
      sub: "same license, >1 active",
      icon: <AlertTriangle className="w-4 h-4 text-red-400" />,
      highlight: data.duplicateSessions > 0 ? "text-red-400" : undefined,
    },
    {
      label: "Reconnect Loop Alerts",
      value: data.reconnectLoopAlerts,
      sub: ">3 sessions/license in 10min",
      icon: <RefreshCw className="w-4 h-4 text-orange-400" />,
      highlight: data.reconnectLoopAlerts > 0 ? "text-orange-400" : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">{c.icon}{c.label}</div>
          <div className={`text-2xl font-bold font-mono ${c.highlight ?? "text-slate-100"}`}>
            {typeof c.value === "number" ? c.value.toLocaleString() : c.value}
          </div>
          <div className="text-xs text-slate-600">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

function SessionDetailModal({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<SessionDetail>(`/session/${sessionId}`).then((d) => {
      setData(d);
      setLoading(false);
    });
  }, [sessionId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 sticky top-0 bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-200">Session Detail</h2>
          <button onClick={onClose} className="p-1 rounded text-slate-500 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
        ) : !data ? (
          <div className="p-8 text-center text-sm text-slate-500">Failed to load session detail.</div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Identity */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Identity</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-800 rounded-lg p-3">
                  <div className="text-slate-500 mb-1">Session ID</div>
                  <div className="font-mono text-slate-200 break-all">{data.session.sessionId}</div>
                </div>
                <div className="bg-slate-800 rounded-lg p-3">
                  <div className="text-slate-500 mb-1">License Key</div>
                  <div className="font-mono text-slate-200">{data.session.licenseKey ?? "—"}</div>
                </div>
                <div className="bg-slate-800 rounded-lg p-3">
                  <div className="text-slate-500 mb-1">Status</div>
                  <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${statusColor(data.session.status)}`}>
                    {data.session.status}
                  </span>
                </div>
                <div className="bg-slate-800 rounded-lg p-3">
                  <div className="text-slate-500 mb-1">Decart Key</div>
                  <div className="text-slate-200">{data.session.decartKeyLabel ?? "—"}</div>
                </div>
              </div>
            </section>

            {/* Metrics */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Billing Metrics</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ["Actual Compute Time", fmtSec(data.metrics.computeSeconds)],
                  ["Retail Stream Time", fmtSec(data.metrics.billingSeconds)],
                  ["Actual API Credits", data.metrics.actualApiCredits.toLocaleString()],
                  ["Retail Credits Charged", data.metrics.retailCreditsCharged.toLocaleString()],
                  ["Profit Margin", data.metrics.profitMarginCredits.toLocaleString() + " cr"],
                  ["Effective cr/s", data.metrics.effectiveCreditsPerSec.toFixed(2)],
                  ["Settlement Source", data.metrics.settlementSource],
                  ["Billing Rate", `${data.metrics.billingRateAtQuery} cr/s`],
                ].map(([label, val]) => (
                  <div key={label} className="bg-slate-800 rounded-lg p-3">
                    <div className="text-slate-500 mb-1">{label}</div>
                    <div className={`font-mono font-semibold ${label === "Profit Margin" ? profitColor(data.metrics.profitMarginCredits) : "text-slate-200"}`}>
                      {val}
                    </div>
                  </div>
                ))}
              </div>
              {data.metrics.anomalyFlag && (
                <div className="flex items-center gap-2 bg-red-950/30 border border-red-800/40 rounded-lg p-3 text-xs text-red-400">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Anomaly: {data.metrics.anomalyFlag}
                </div>
              )}
            </section>

            {/* Billing lifecycle timeline */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Billing Lifecycle</h3>
              <div className="space-y-1.5">
                {data.timeline.map((ev, i) => (
                  <div key={i} className="flex items-start gap-3 text-xs">
                    <div className="mt-0.5 w-2 h-2 rounded-full bg-slate-600 shrink-0" />
                    <div>
                      <span className="text-slate-300 font-medium">{ev.event.replace(/_/g, " ")}</span>
                      <span className="text-slate-600 ml-2">{fmtTs(ev.ts)}</span>
                      {ev.note && <div className="text-slate-500 mt-0.5">{ev.note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Raw timestamps */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Timestamps</h3>
              <div className="grid grid-cols-1 gap-1 text-xs font-mono">
                {[
                  ["started_at", data.session.startedAt],
                  ["billing_started_at", data.session.billingStartedAt],
                  ["last_heartbeat_at", data.session.lastHeartbeatAt],
                  ["last_deducted_at", data.session.lastDeductedAt],
                  ["stopped_at", data.session.stoppedAt],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="text-slate-600 w-40 shrink-0">{label}</span>
                    <span className="text-slate-400">{fmtTs(val)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Session table ─────────────────────────────────────────────────────────────
function SessionsTable({ billingRate }: { billingRate: number }) {
  const [data, setData] = useState<SessionsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("stopped");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch<SessionsResp>(`/sessions?status=${statusFilter}&limit=100`);
    setData(res);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const sessions = data?.sessions ?? [];

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-slate-500">Status filter:</span>
        {["all", "active", "stopped", "expired"].map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              statusFilter === f
                ? "bg-yellow-600/20 border-yellow-500 text-yellow-300"
                : "border-slate-700 text-slate-500 hover:text-slate-300"
            }`}
          >
            {f}
          </button>
        ))}
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No sessions found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/60">
                  {[
                    "Session ID", "License Key", "Status", "Started",
                    "Compute Time", "Retail Time",
                    "Actual API Cr", "Retail Cr",
                    "Profit", "eff cr/s",
                    "Anomaly",
                  ].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.sessionId}
                    onClick={() => setSelectedSession(s.sessionId)}
                    className="border-b border-slate-800 last:border-0 hover:bg-slate-800/40 cursor-pointer"
                  >
                    <td className="px-3 py-2.5 font-mono text-slate-400">
                      {s.sessionId.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-400">
                      {s.licenseKey ? `${s.licenseKey.slice(0, 8)}…` : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${statusColor(s.status)}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                      {new Date(s.startedAt).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-300">
                      {fmtSec(s.computeSeconds)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-yellow-400">
                      {fmtSec(s.billingSeconds)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-blue-400">
                      {s.actualApiCredits.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-yellow-400">
                      {s.retailCreditsCharged.toLocaleString()}
                    </td>
                    <td className={`px-3 py-2.5 font-mono font-semibold ${profitColor(s.profitMarginCredits)}`}>
                      {s.profitMarginCredits > 0 ? "+" : ""}{s.profitMarginCredits.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-purple-400">
                      {s.effectiveCreditsPerSec.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5">
                      {s.anomalyFlag ? (
                        <span className="flex items-center gap-1 text-red-400">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span className="truncate max-w-[120px]">{s.anomalyFlag}</span>
                        </span>
                      ) : (
                        <span className="text-slate-700">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedSession && (
        <SessionDetailModal
          sessionId={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
}

// ── Ghost sessions panel ──────────────────────────────────────────────────────
function GhostSessionsPanel() {
  const [data, setData] = useState<GhostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    zero: true, dupe: true, reconnect: false, stale: false, frozen: false,
  });

  useEffect(() => {
    apiFetch<GhostData>("/ghost-sessions").then((d) => {
      setData(d);
      setLoading(false);
    });
  }, []);

  const toggle = (k: string) => setExpanded((prev) => ({ ...prev, [k]: !prev[k] }));

  if (loading) return <div className="p-8 text-center text-sm text-slate-500">Loading ghost session data…</div>;
  if (!data) return <div className="p-8 text-center text-sm text-slate-500">Failed to load ghost session data.</div>;

  const Section = ({
    id,
    title,
    count,
    color,
    children,
  }: {
    id: string;
    title: string;
    count: number;
    color: string;
    children: React.ReactNode;
  }) => (
    <div className="border border-slate-700 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800/60 text-left"
        onClick={() => toggle(id)}
      >
        {expanded[id] ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
        <span className="text-sm font-medium text-slate-200">{title}</span>
        <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${count > 0 ? color : "bg-slate-700 text-slate-500"}`}>
          {count}
        </span>
      </button>
      {expanded[id] && <div className="bg-slate-900 p-4">{children}</div>}
    </div>
  );

  const SimpleTable = ({ rows, cols }: { rows: any[]; cols: string[] }) => {
    const safeRows = Array.isArray(rows) ? rows : [];
    return safeRows.length === 0 ? (
      <p className="text-xs text-slate-600 text-center py-4">No entries detected.</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700">
              {cols.map((c) => (
                <th key={c} className="text-left px-3 py-2 text-slate-600 font-medium whitespace-nowrap capitalize">
                  {c.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {safeRows.map((row, i) => (
              <tr key={i} className="border-b border-slate-800 last:border-0">
                {cols.map((c) => (
                  <td key={c} className="px-3 py-2 font-mono text-slate-400 whitespace-nowrap">
                    {row[c] != null
                      ? typeof row[c] === "string" && row[c].includes("T")
                        ? fmtTs(row[c])
                        : String(row[c])
                      : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-600 flex items-center gap-2">
        <Ghost className="w-3.5 h-3.5" />
        Monitoring only — no auto-deletions or auto-bans. Generated at {fmtTs(data.generatedAt)}
      </div>

      <Section id="zero" title="Zero-Frame Sessions (billed with no billing anchor)" count={data.zeroFrameSessions.length} color="bg-red-900/40 text-red-400">
        <SimpleTable rows={data.zeroFrameSessions} cols={["id", "license_key", "status", "started_at", "stopped_at", "duration_seconds", "anomaly_type"]} />
      </Section>

      <Section id="dupe" title="Duplicate Active Sessions (same license, >1 active)" count={data.duplicateActiveSessions.length} color="bg-orange-900/40 text-orange-400">
        <SimpleTable rows={data.duplicateActiveSessions} cols={["id", "license_key", "status", "started_at", "last_heartbeat_at", "anomaly_type"]} />
      </Section>

      <Section id="reconnect" title="Reconnect Loop Alerts (>3 sessions/license in 10min)" count={data.reconnectLoops.length} color="bg-amber-900/40 text-amber-400">
        <SimpleTable rows={data.reconnectLoops} cols={["license_key", "session_count", "first_session", "last_session"]} />
      </Section>

      <Section id="stale" title="Stale/Orphan Sessions (active, no heartbeat >2min)" count={data.staleSessions.length} color="bg-yellow-900/40 text-yellow-400">
        <SimpleTable rows={data.staleSessions} cols={["id", "license_key", "started_at", "last_heartbeat_at", "secs_since_last_heartbeat", "anomaly_type"]} />
      </Section>

      <Section id="frozen" title="Deduction Freeze Anomalies (billing started, no deduction >45s)" count={data.frozenSessions.length} color="bg-purple-900/40 text-purple-400">
        <SimpleTable rows={data.frozenSessions} cols={["id", "license_key", "started_at", "billing_started_at", "last_deducted_at", "secs_since_last_deduction", "anomaly_type"]} />
      </Section>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
// ── Stream Ledger types ───────────────────────────────────────────────────────
interface BillingRateSnapshot {
  sessionId: string;
  billingRate: number;
  snapshotAt: string;
}

interface StreamRecord {
  streamGroupId: string;
  licenseKey: string | null;
  licenseKeyId: number | null;
  totalSessions: number;
  fragmentationCount: number;
  isActive: boolean;
  streamStartTime: string;
  streamEndTime: string;
  streamDurationSeconds: number;
  totalComputeSeconds: number;
  totalBillingSeconds: number;
  totalApiCreditsUsed: number;
  totalRetailCreditsCharged: number;
  profitInCredits: number;
  effectiveCreditsPerSecond: number;
  billingRateHistory: BillingRateSnapshot[];
  lastBillingRateUsed: number;
  currentBillingRate: number;
  sessionIds: string[];
}

interface StreamLedgerResponse {
  streams: StreamRecord[];
  currentBillingRate: number;
  totalStreams: number;
  activeStreams: number;
  computedAt: string;
}

// ── Stream Ledger Panel ───────────────────────────────────────────────────────
function StreamLedgerPanel() {
  const [data, setData] = useState<StreamLedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const path = activeOnly ? "/stream-ledger/live?active=true" : "/stream-ledger/live";
    const res = await apiFetch<StreamLedgerResponse>(path);
    if (res) {
      setData(res);
    } else {
      setError(true);
    }
    setLoading(false);
  }, [activeOnly]);

  useEffect(() => { load(); }, [load]);

  const rebuild = async () => {
    setRebuilding(true);
    setRebuildResult(null);
    try {
      const res = await fetch(API("/stream-ledger/rebuild"), {
        method: "POST",
        headers: authH(),
      });
      const json = await res.json();
      if (res.ok) {
        setRebuildResult(`Persisted ${json.upserted} stream groups (rate: ${json.billingRateUsed} cr/s)`);
        load();
      } else {
        setRebuildResult(`Rebuild failed: ${json.error}`);
      }
    } catch {
      setRebuildResult("Rebuild request failed");
    }
    setRebuilding(false);
  };

  const fmt = (n: number) => n.toLocaleString();
  const fmtDur = (s: number) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  return (
    <div className="space-y-5">
      {/* Banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-teal-800/40 bg-teal-950/20 p-4 text-xs text-teal-300">
        <Layers className="w-3.5 h-3.5 shrink-0 mt-0.5 text-teal-400" />
        <div>
          <span className="font-semibold">Stream Ledger — Dynamic Rate Aware: </span>
          Groups all sessions by license key and reconnect proximity (&lt;5 min gap = same stream).
          Billing rate is always fetched live from admin settings — never hardcoded.
          Detects credit leakage from session fragmentation.
          {data && (
            <span className="ml-1">
              Current rate: <strong className="text-teal-200">{data.currentBillingRate} cr/s</strong>
            </span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh Live
        </button>
        <button
          onClick={rebuild}
          disabled={rebuilding}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-teal-700 text-teal-400 hover:text-teal-200 transition-colors"
        >
          <Zap className={`w-3 h-3 ${rebuilding ? "animate-pulse" : ""}`} />
          {rebuilding ? "Rebuilding…" : "Rebuild & Persist"}
        </button>
        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={e => setActiveOnly(e.target.checked)}
            className="rounded"
          />
          Active streams only
        </label>
        {data && (
          <span className="text-xs text-slate-500 ml-auto">
            {data.totalStreams} streams · {data.activeStreams} active ·
            computed {new Date(data.computedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {rebuildResult && (
        <div className="text-xs rounded-lg border border-teal-700/40 bg-teal-950/20 px-4 py-2 text-teal-300">
          {rebuildResult}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-800/40 bg-red-950/20 p-6 text-center text-sm text-red-400">
          Failed to load stream ledger. Feature may be disabled or unavailable.
        </div>
      )}

      {loading && !data && (
        <div className="rounded-xl border border-slate-800 p-8 text-center text-sm text-slate-500">
          Loading stream groups…
        </div>
      )}

      {/* Summary cards */}
      {data && data.streams.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: "Total Streams",
                value: fmt(data.totalStreams),
                sub: `${data.activeStreams} active`,
                color: "text-teal-400",
              },
              {
                label: "Current Billing Rate",
                value: `${data.currentBillingRate} cr/s`,
                sub: "live from admin",
                color: "text-indigo-400",
              },
              {
                label: "Total Profit",
                value: fmt(data.streams.reduce((a, s) => a + s.profitInCredits, 0)),
                sub: "credits (retail − Decart)",
                color: "text-emerald-400",
              },
              {
                label: "Fragmented Streams",
                value: fmt(data.streams.filter(s => s.fragmentationCount > 0).length),
                sub: "reconnect gaps detected",
                color: "text-amber-400",
              },
            ].map(c => (
              <div key={c.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <p className="text-xs text-slate-500">{c.label}</p>
                <p className={`text-xl font-bold mt-1 ${c.color}`}>{c.value}</p>
                <p className="text-xs text-slate-600 mt-0.5">{c.sub}</p>
              </div>
            ))}
          </div>

          {/* Stream table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/60">
                  <th className="px-3 py-3 text-left font-medium text-slate-400">Stream Group</th>
                  <th className="px-3 py-3 text-left font-medium text-slate-400">License Key</th>
                  <th className="px-3 py-3 text-right font-medium text-slate-400">Sessions</th>
                  <th className="px-3 py-3 text-right font-medium text-slate-400">Duration</th>
                  <th className="px-3 py-3 text-right font-medium text-slate-400">Decart cr</th>
                  <th className="px-3 py-3 text-right font-medium text-slate-400">Retail cr</th>
                  <th className="px-3 py-3 text-right font-medium text-slate-400">Profit</th>
                  <th className="px-3 py-3 text-right font-medium text-slate-400">Rate</th>
                  <th className="px-3 py-3 text-right font-medium text-slate-400">Frags</th>
                  <th className="px-3 py-3 text-center font-medium text-slate-400">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.streams.map(stream => (
                  <>
                    <tr
                      key={stream.streamGroupId}
                      className={`border-b border-slate-800 hover:bg-slate-800/30 ${stream.isActive ? "bg-teal-950/10" : ""}`}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {stream.isActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                          )}
                          <span className="font-mono text-slate-400 text-xs">
                            {stream.streamGroupId.slice(0, 24)}…
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-slate-300">
                          {stream.licenseKey
                            ? `${stream.licenseKey.slice(0, 8)}…`
                            : <span className="text-slate-600">—</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-300">{stream.totalSessions}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                        {fmtDur(stream.totalBillingSeconds)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-blue-400">
                        {fmt(stream.totalApiCreditsUsed)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-yellow-400">
                        {fmt(stream.totalRetailCreditsCharged)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono font-bold ${stream.profitInCredits >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {stream.profitInCredits >= 0 ? "+" : ""}{fmt(stream.profitInCredits)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-indigo-400">
                        {stream.lastBillingRateUsed} cr/s
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {stream.fragmentationCount > 0 ? (
                          <span className="px-1.5 py-0.5 rounded-full text-xs bg-amber-900/40 text-amber-400 border border-amber-700/40">
                            {stream.fragmentationCount}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => setExpanded(expanded === stream.streamGroupId ? null : stream.streamGroupId)}
                          className="text-slate-500 hover:text-slate-200 transition-colors"
                        >
                          {expanded === stream.streamGroupId
                            ? <ChevronDown className="w-3.5 h-3.5" />
                            : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {expanded === stream.streamGroupId && (
                      <tr key={`${stream.streamGroupId}-detail`} className="border-b border-slate-800 bg-slate-950/60">
                        <td colSpan={10} className="px-4 py-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Session time breakdown */}
                            <div>
                              <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
                                <Clock className="w-3 h-3" />
                                Time Breakdown
                              </p>
                              <table className="w-full text-xs">
                                <tbody>
                                  {[
                                    ["Stream start", new Date(stream.streamStartTime).toLocaleString()],
                                    ["Stream end", new Date(stream.streamEndTime).toLocaleString()],
                                    ["Wall-clock span (start→end)", fmtDur(stream.streamDurationSeconds)],
                                    ["Wallet seconds (truth source)", fmtDur(stream.totalBillingSeconds)],
                                    ["Retail seconds billed", `${fmt(stream.totalRetailCreditsCharged / 2)}s`],
                                  ].map(([k, v]) => (
                                    <tr key={k} className="border-b border-slate-800 last:border-0">
                                      <td className="py-1.5 text-slate-500">{k}</td>
                                      <td className="py-1.5 text-right font-mono text-slate-300">{v}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {/* Billing rate history */}
                            <div>
                              <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
                                <TrendingUp className="w-3 h-3" />
                                Billing Rate History (per session)
                              </p>
                              {(!Array.isArray(stream.billingRateHistory) || stream.billingRateHistory.length === 0) ? (
                                <p className="text-xs text-slate-600">No rate history available.</p>
                              ) : (
                                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                                  {(stream.billingRateHistory as any[]).map((h, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs rounded px-2 py-1 bg-slate-800/60">
                                      <span className="font-mono text-slate-500 truncate max-w-[120px]">
                                        {h.sessionId.slice(0, 12)}…
                                      </span>
                                      <span className="text-indigo-400 font-mono">{h.billingRate} cr/s</span>
                                      <span className="text-slate-600">
                                        {new Date(h.snapshotAt).toLocaleTimeString()}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="mt-3 rounded-lg border border-teal-800/30 bg-teal-950/20 px-3 py-2">
                                <p className="text-xs text-teal-400">
                                  <span className="font-semibold">Current live rate: </span>
                                  {stream.currentBillingRate} cr/s
                                  <span className="text-teal-600 ml-2">(from admin dashboard)</span>
                                </p>
                              </div>
                            </div>

                            {/* Credit reconciliation */}
                            <div className="sm:col-span-2">
                              <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
                                <Activity className="w-3 h-3" />
                                Credit Reconciliation (stream level)
                              </p>
                              <div className="grid grid-cols-3 gap-2">
                                {[
                                  { label: "Decart API cost", value: fmt(stream.totalApiCreditsUsed), color: "text-blue-400", sub: `${stream.totalBillingSeconds}s × 2.3 cr/s (API cost)` },
                                  { label: "Retail charged", value: fmt(stream.totalRetailCreditsCharged), color: "text-yellow-400", sub: `rate: ${stream.lastBillingRateUsed} cr/s` },
                                  { label: "Net profit", value: `${stream.profitInCredits >= 0 ? "+" : ""}${fmt(stream.profitInCredits)}`, color: stream.profitInCredits >= 0 ? "text-emerald-400" : "text-red-400", sub: `${stream.effectiveCreditsPerSecond.toFixed(2)} effective cr/s` },
                                ].map(c => (
                                  <div key={c.label} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                                    <p className="text-xs text-slate-500">{c.label}</p>
                                    <p className={`text-base font-bold mt-1 font-mono ${c.color}`}>{c.value}</p>
                                    <p className="text-xs text-slate-600 mt-0.5">{c.sub}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data && data.streams.length === 0 && (
        <div className="rounded-xl border border-slate-800 p-8 text-center text-sm text-slate-500">
          No stream groups found. Sessions may not exist yet.
        </div>
      )}
    </div>
  );
}

// ── License Wallet types ──────────────────────────────────────────────────────
interface WalletEntry {
  licenseKeyId: number;
  licenseKey: string;
  allocatedSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  usedPercent: number;
  status: "active" | "paused" | "exhausted" | "inactive";
  isActive: boolean;
  streamingEnabled: boolean;
  billingRateSnapshot: number;
  activeSessionCount: number;
  totalSessionCount: number;
  reconnectCount: number;
  lastDeductionAt: string | null;
  walletConsistencyStatus: "ok" | "mismatch" | "unknown";
  consistencyDeltaSeconds: number;
  creditsAllocated: number;
  creditsUsed: number;
  creditsRemaining: number;
}

interface WalletResponse {
  wallets: WalletEntry[];
  currentBillingRate: number;
  total: number;
  summary: {
    active: number;
    paused: number;
    exhausted: number;
    inactive: number;
    mismatched: number;
  };
  computedAt: string;
}

// ── Billing Rate types ────────────────────────────────────────────────────────
interface RateHistoryEntry {
  id: number;
  previousRate: number;
  newRate: number;
  changedBy: string;
  note: string | null;
  changedAt: string;
}

interface RateStat {
  rate: number;
  session_count: number;
  total_billing_seconds: number;
  avg_effective_cr_per_sec: number;
}

interface BillingRateResponse {
  currentRate: number;
  currentRateLabel: string;
  decartFixedRate: number;
  decartFixedRateLabel: string;
  profitMarginAtCurrentRate: string;
  totalRateChanges: number;
  history: RateHistoryEntry[];
  rateStats: RateStat[];
  propagation: {
    syncedSessions: number;
    staleSessions: number;
    totalSessionsWithRate: number;
    propagationStatus: "fully_propagated" | "partial";
    propagationNote: string;
  };
  checkedAt: string;
}

// ── License Wallet Panel ──────────────────────────────────────────────────────
function LicenseWalletPanel() {
  const [data, setData] = useState<WalletResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const qs = statusFilter !== "all" ? `?status=${statusFilter}` : "";
    const res = await apiFetch<WalletResponse>(`/wallet${qs}`);
    if (res) setData(res);
    else setError(true);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n: number) => n.toLocaleString();
  const fmtDur = (s: number) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  const statusColor: Record<string, string> = {
    active: "text-emerald-400 bg-emerald-900/30 border-emerald-700/40",
    paused: "text-amber-400 bg-amber-900/30 border-amber-700/40",
    exhausted: "text-red-400 bg-red-900/30 border-red-700/40",
    inactive: "text-slate-500 bg-slate-800/30 border-slate-700/40",
  };

  const consistencyColor: Record<string, string> = {
    ok: "text-emerald-400",
    mismatch: "text-red-400",
    unknown: "text-slate-500",
  };

  const filtered = data?.wallets.filter(w =>
    !search || w.licenseKey.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="space-y-5">
      {/* Banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-violet-800/40 bg-violet-950/20 p-4 text-xs text-violet-300">
        <DollarSign className="w-3.5 h-3.5 shrink-0 mt-0.5 text-violet-400" />
        <div>
          <span className="font-semibold">License Wallet Monitor: </span>
          Prepaid wallet view per license key — aggregated from live <code>license_keys</code> data.
          The current heartbeat deduction engine continues unchanged.
          This is a read-only observability overlay.
          {data && (
            <span className="ml-1">
              Billing rate: <strong className="text-violet-200">{data.currentBillingRate} cr/s</strong>
            </span>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Active", value: data.summary.active, color: "text-emerald-400" },
            { label: "Paused", value: data.summary.paused, color: "text-amber-400" },
            { label: "Exhausted", value: data.summary.exhausted, color: "text-red-400" },
            { label: "Inactive", value: data.summary.inactive, color: "text-slate-500" },
            { label: "Mismatched", value: data.summary.mismatched, color: "text-orange-400" },
          ].map(c => (
            <div key={c.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs text-slate-500">{c.label}</p>
              <p className={`text-xl font-bold mt-1 ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-300 px-2 py-1.5"
        >
          {["all", "active", "paused", "exhausted", "inactive"].map(s => (
            <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search license key…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-300 px-3 py-1.5 w-48"
        />
        {data && (
          <span className="text-xs text-slate-500 ml-auto">
            {filtered.length} of {data.total} keys ·
            computed {new Date(data.computedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-800/40 bg-red-950/20 p-6 text-center text-sm text-red-400">
          Failed to load wallet data. Feature may be disabled (ENABLE_LICENSE_WALLET=false).
        </div>
      )}

      {loading && !data && (
        <div className="rounded-xl border border-slate-800 p-8 text-center text-sm text-slate-500">
          Loading license wallets…
        </div>
      )}

      {/* Wallet table */}
      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/60">
                <th className="px-3 py-3 text-left font-medium text-slate-400">License Key</th>
                <th className="px-3 py-3 text-center font-medium text-slate-400">Status</th>
                <th className="px-3 py-3 text-right font-medium text-slate-400">Allocated</th>
                <th className="px-3 py-3 text-right font-medium text-slate-400">Used</th>
                <th className="px-3 py-3 text-right font-medium text-slate-400">Remaining</th>
                <th className="px-3 py-3 text-right font-medium text-slate-400">Balance %</th>
                <th className="px-3 py-3 text-right font-medium text-slate-400">Active</th>
                <th className="px-3 py-3 text-right font-medium text-slate-400">Sessions</th>
                <th className="px-3 py-3 text-right font-medium text-slate-400">Cr Remain</th>
                <th className="px-3 py-3 text-center font-medium text-slate-400">Sync</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(w => (
                <tr key={w.licenseKeyId} className="border-b border-slate-800 hover:bg-slate-800/30">
                  <td className="px-3 py-2.5 font-mono text-slate-300">
                    {w.licenseKey.slice(0, 12)}…
                    <span className="ml-1 text-slate-600 text-xs">#{w.licenseKeyId}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`px-1.5 py-0.5 rounded-full text-xs border ${statusColor[w.status] ?? "text-slate-400"}`}>
                      {w.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-400">
                    {fmtDur(w.allocatedSeconds)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-yellow-400">
                    {fmtDur(w.usedSeconds)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono font-bold ${w.remainingSeconds > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmtDur(w.remainingSeconds)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${w.usedPercent > 90 ? "bg-red-500" : w.usedPercent > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(100, w.usedPercent)}%` }}
                        />
                      </div>
                      <span className="text-slate-400 text-xs w-9 text-right">{w.usedPercent}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {w.activeSessionCount > 0 ? (
                      <span className="flex items-center justify-end gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-emerald-400">{w.activeSessionCount}</span>
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-400">{w.totalSessionCount}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-indigo-400">
                    {fmt(w.creditsRemaining)}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`font-medium ${consistencyColor[w.walletConsistencyStatus]}`}>
                      {w.walletConsistencyStatus === "ok" ? "✓" :
                        w.walletConsistencyStatus === "mismatch" ? `Δ${w.consistencyDeltaSeconds}s` : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="rounded-xl border border-slate-800 p-8 text-center text-sm text-slate-500">
          No wallets found{search ? ` matching "${search}"` : ""}.
        </div>
      )}
    </div>
  );
}

// ── Billing Rate Panel ────────────────────────────────────────────────────────
function BillingRatePanel() {
  const [data, setData] = useState<BillingRateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const res = await apiFetch<BillingRateResponse>("/billing-rate");
    if (res) setData(res);
    else setError(true);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      {/* Banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-blue-800/40 bg-blue-950/20 p-4 text-xs text-blue-300">
        <TrendingUp className="w-3.5 h-3.5 shrink-0 mt-0.5 text-blue-400" />
        <div>
          <span className="font-semibold">Billing Rate Monitor: </span>
          Verifies that billing rate changes in the admin dashboard propagate everywhere automatically.
          Rate is ALWAYS fetched dynamically — never hardcoded anywhere in the system.
          Historical sessions retain their original rate snapshot for audit integrity.
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
        {data && (
          <span className="text-xs text-slate-500 ml-auto">
            Checked {new Date(data.checkedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-800/40 bg-red-950/20 p-6 text-center text-sm text-red-400">
          Failed to load billing rate data.
        </div>
      )}

      {loading && !data && (
        <div className="rounded-xl border border-slate-800 p-8 text-center text-sm text-slate-500">
          Loading billing rate data…
        </div>
      )}

      {data && (
        <>
          {/* Current rate cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: "Current Billing Rate",
                value: data.currentRateLabel,
                sub: "live from admin dashboard",
                color: "text-blue-400",
              },
              {
                label: "Decart API Cost",
                value: data.decartFixedRateLabel,
                sub: "fixed Decart rate",
                color: "text-slate-400",
              },
              {
                label: "Profit Margin",
                value: data.profitMarginAtCurrentRate,
                sub: "retail vs Decart cost",
                color: parseFloat(data.profitMarginAtCurrentRate) > 0 ? "text-emerald-400" : "text-red-400",
              },
              {
                label: "Rate Changes",
                value: String(data.totalRateChanges),
                sub: "in audit history",
                color: "text-amber-400",
              },
            ].map(c => (
              <div key={c.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <p className="text-xs text-slate-500">{c.label}</p>
                <p className={`text-xl font-bold mt-1 font-mono ${c.color}`}>{c.value}</p>
                <p className="text-xs text-slate-600 mt-0.5">{c.sub}</p>
              </div>
            ))}
          </div>

          {/* Propagation status */}
          <div className={`rounded-xl border p-4 ${
            data.propagation.propagationStatus === "fully_propagated"
              ? "border-emerald-800/40 bg-emerald-950/20"
              : "border-amber-800/40 bg-amber-950/20"
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <Activity className={`w-4 h-4 ${data.propagation.propagationStatus === "fully_propagated" ? "text-emerald-400" : "text-amber-400"}`} />
              <span className={`text-sm font-semibold ${data.propagation.propagationStatus === "fully_propagated" ? "text-emerald-300" : "text-amber-300"}`}>
                Propagation: {data.propagation.propagationStatus === "fully_propagated" ? "Fully Propagated" : "Partial"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <p className="text-slate-500">Synced sessions</p>
                <p className="text-emerald-400 font-bold text-base">{data.propagation.syncedSessions}</p>
              </div>
              <div>
                <p className="text-slate-500">Historical snapshots</p>
                <p className="text-amber-400 font-bold text-base">{data.propagation.staleSessions}</p>
              </div>
              <div>
                <p className="text-slate-500">Total with rate data</p>
                <p className="text-slate-300 font-bold text-base">{data.propagation.totalSessionsWithRate}</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">{data.propagation.propagationNote}</p>
          </div>

          {/* Per-rate stats */}
          {Array.isArray(data.rateStats) && data.rateStats.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Usage by Billing Rate</h3>
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-900/60">
                      <th className="px-4 py-3 text-left font-medium text-slate-400">Rate</th>
                      <th className="px-4 py-3 text-right font-medium text-slate-400">Sessions</th>
                      <th className="px-4 py-3 text-right font-medium text-slate-400">Total billing time</th>
                      <th className="px-4 py-3 text-right font-medium text-slate-400">Avg eff. cr/s</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.rateStats as any[]).map((r, i) => (
                      <tr key={i} className={`border-b border-slate-800 last:border-0 ${Number(r.rate) === data.currentRate ? "bg-blue-950/20" : ""}`}>
                        <td className="px-4 py-2.5">
                          <span className="font-mono text-blue-400 font-bold">{r.rate} cr/s</span>
                          {Number(r.rate) === data.currentRate && (
                            <span className="ml-2 text-xs text-blue-500">(current)</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-300">{Number(r.session_count).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-400">
                          {Math.floor(Number(r.total_billing_seconds) / 60)}m {Number(r.total_billing_seconds) % 60}s
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-indigo-400">
                          {Number(r.avg_effective_cr_per_sec).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Change history */}
          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Rate Change History</h3>
            {(!Array.isArray(data.history) || data.history.length === 0) ? (
              <div className="rounded-xl border border-slate-800 p-6 text-center text-sm text-slate-500">
                No rate changes recorded yet.
              </div>
            ) : (
              <div className="space-y-2">
                {(Array.isArray(data.history) ? data.history : []).map(h => (
                  <div key={h.id} className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 flex items-center gap-4">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-slate-500">{h.previousRate} cr/s</span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                      <span className="font-mono text-blue-400 font-bold">{h.newRate} cr/s</span>
                    </div>
                    <div className="text-xs text-slate-500 ml-auto text-right">
                      <p>{h.changedBy}</p>
                      <p>{new Date(h.changedAt).toLocaleString()}</p>
                    </div>
                    {h.note && (
                      <p className="text-xs text-slate-600 italic max-w-xs truncate">{h.note}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Credit Usage Panel ────────────────────────────────────────────────────────
interface CreditUsageKey {
  keyLabel: string;
  sessionCount: number;
  decartCredits: number;
  retailCredits: number;
  marginCredits: number;
  decartCredits24h: number;
  decartCredits7d: number;
}
interface CreditUsageBucket { hour?: string; day?: string; decartCredits: number; marginCredits: number; sessions: number; }
interface CreditUsageData {
  billingRate: number;
  decartCostRate: number;
  compressionFactor: number;
  keys: CreditUsageKey[];
  hourly: CreditUsageBucket[];
  daily: CreditUsageBucket[];
  totals: { totalDecartCredits: number; totalMarginCredits: number; marginPct: number };
  computedAt: string;
}

function CreditUsagePanel() {
  const [data, setData]       = useState<CreditUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [view, setView]       = useState<"keys" | "hourly" | "daily" | "scenario">("keys");

  const load = async () => {
    setLoading(true); setError(false);
    const res = await apiFetch<CreditUsageData>("/credit-usage");
    if (res) setData(res); else setError(true);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const fmtC = (n: number) => n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : n.toFixed(0);

  const maxBar = (arr: number[]) => Math.max(...arr, 1);

  // Scenario table — computed from live billingRate
  const scenarios = data ? [1, 30, 60].map(mins => {
    const walletSec  = mins * 60;
    const realSec    = walletSec / data.compressionFactor;
    const decartCost = realSec * data.decartCostRate;
    const margin     = realSec * (data.billingRate - data.decartCostRate);
    return { mins, walletSec, realSec: Math.round(realSec), decartCost: Math.round(decartCost), margin: Math.round(margin) };
  }) : [];

  const subTabs = [
    { id: "keys"     as const, label: "Per-Key Totals" },
    { id: "hourly"   as const, label: "Last 24 h (hourly)" },
    { id: "daily"    as const, label: "Last 7 d (daily)" },
    { id: "scenario" as const, label: "Real-World Scenarios" },
  ];

  return (
    <div className="space-y-5">
      {/* Banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-cyan-800/40 bg-cyan-950/20 p-4 text-xs text-cyan-300">
        <Zap className="w-3.5 h-3.5 shrink-0 mt-0.5 text-cyan-400" />
        <div>
          <span className="font-semibold">Credit Usage Monitor — </span>
          Read-only. Shows Decart credits consumed per API key and over time. Refreshes every 30 s.
          {data && (
            <span className="ml-1">
              Billing rate: <strong className="text-cyan-200">{data.billingRate} cr/s</strong>
              {" · "}Decart cost: <strong className="text-cyan-200">{data.decartCostRate} cr/s</strong>
              {" · "}Compression: <strong className="text-cyan-200">{data.compressionFactor}×</strong>
            </span>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Decart Credits",  value: fmtC(data.totals.totalDecartCredits),  color: "text-red-400"    },
            { label: "Total Margin Credits",  value: fmtC(data.totals.totalMarginCredits),  color: "text-emerald-400" },
            { label: "Gross Margin",          value: `${data.totals.marginPct}%`,           color: "text-yellow-400" },
            { label: "Decart Keys",           value: String(data.keys.length),              color: "text-blue-400"   },
          ].map(c => (
            <div key={c.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs text-slate-500">{c.label}</p>
              <p className={`text-xl font-bold mt-1 ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/40 p-0.5">
          {subTabs.map(st => (
            <button key={st.id} onClick={() => setView(st.id)}
              className={`px-3 py-1 rounded-md text-xs transition-colors ${view === st.id ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
              {st.label}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-xs text-slate-500 ml-auto">
            computed {new Date(data.computedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-800/40 bg-red-950/20 p-6 text-center text-sm text-red-400">
          Failed to load credit usage data.
        </div>
      )}
      {loading && !data && (
        <div className="rounded-xl border border-slate-800 p-8 text-center text-sm text-slate-500">
          Loading credit usage…
        </div>
      )}

      {data && view === "keys" && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700">
            <h2 className="text-sm font-semibold text-slate-200">Decart Credits per API Key — all time</h2>
            <p className="text-xs text-slate-500 mt-0.5">Each bar = total Decart credits consumed by sessions routed through that key.</p>
          </div>
          <div className="p-5 space-y-3">
            {data.keys.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-4">No session data yet.</p>
            )}
            {data.keys.map(k => {
              const pct = Math.round((k.decartCredits / maxBar(data.keys.map(x => x.decartCredits))) * 100);
              const marginPct = k.decartCredits + k.marginCredits > 0
                ? Math.round((k.marginCredits / (k.decartCredits + k.marginCredits)) * 100) : 0;
              return (
                <div key={k.keyLabel} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-medium truncate max-w-[200px]">{k.keyLabel}</span>
                    <div className="flex items-center gap-4 text-slate-400 shrink-0 ml-2">
                      <span className="text-red-400 font-mono">{fmtC(k.decartCredits)} cr (Decart)</span>
                      <span className="text-emerald-400 font-mono">+{fmtC(k.marginCredits)} margin</span>
                      <span className="text-slate-500">{k.sessionCount} sessions</span>
                    </div>
                  </div>
                  <div className="h-5 rounded bg-slate-800 overflow-hidden flex">
                    <div className="h-full bg-red-500/70 transition-all" style={{ width: `${pct * (100 - marginPct) / 100}%` }} />
                    <div className="h-full bg-emerald-500/60 transition-all" style={{ width: `${pct * marginPct / 100}%` }} />
                  </div>
                  <div className="flex gap-4 text-[10px] text-slate-500">
                    <span>24 h: {fmtC(k.decartCredits24h)} cr</span>
                    <span>7 d: {fmtC(k.decartCredits7d)} cr</span>
                    <span>{marginPct}% margin</span>
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-4 pt-2 text-[10px] text-slate-500">
              <span className="flex items-center gap-1"><span className="w-3 h-2.5 rounded-sm bg-red-500/70 inline-block" />Decart cost</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2.5 rounded-sm bg-emerald-500/60 inline-block" />Your margin</span>
            </div>
          </div>
        </div>
      )}

      {data && view === "hourly" && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700">
            <h2 className="text-sm font-semibold text-slate-200">Decart Credits — last 24 hours (per hour)</h2>
            <p className="text-xs text-slate-500 mt-0.5">Hourly Decart credit burn rate across all keys. Gaps = no sessions that hour.</p>
          </div>
          <div className="p-5">
            {data.hourly.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-4">No sessions in the last 24 hours.</p>
            )}
            {data.hourly.length > 0 && (
              <div className="flex items-end gap-1 h-36 overflow-x-auto">
                {data.hourly.map((h, i) => {
                  const maxV = maxBar(data.hourly.map(x => x.decartCredits + x.marginCredits));
                  const totalH = h.decartCredits + h.marginCredits;
                  const pct = Math.round((totalH / maxV) * 100);
                  const dPct = totalH > 0 ? Math.round((h.decartCredits / totalH) * pct) : 0;
                  const mPct = pct - dPct;
                  const label = h.hour ? new Date(h.hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                  return (
                    <div key={i} className="flex flex-col items-center gap-0.5 min-w-[28px] group cursor-default" title={`${label}\nDecart: ${fmtC(h.decartCredits)} cr\nMargin: ${fmtC(h.marginCredits)} cr\nSessions: ${h.sessions}`}>
                      <div className="flex flex-col-reverse items-stretch w-full" style={{ height: "120px" }}>
                        <div className="bg-red-500/70 w-full rounded-t-sm transition-all" style={{ height: `${dPct}%` }} />
                        <div className="bg-emerald-500/60 w-full transition-all" style={{ height: `${mPct}%` }} />
                      </div>
                      <span className="text-[9px] text-slate-600 group-hover:text-slate-400 rotate-[-45deg] origin-center mt-1 w-5 truncate">{label.slice(0, 5)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {data && view === "daily" && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700">
            <h2 className="text-sm font-semibold text-slate-200">Decart Credits — last 7 days (per day)</h2>
            <p className="text-xs text-slate-500 mt-0.5">Daily Decart credit burn. Red = Decart cost, green = your margin on top.</p>
          </div>
          <div className="p-5">
            {data.daily.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-4">No sessions in the last 7 days.</p>
            )}
            {data.daily.length > 0 && (
              <div className="flex items-end gap-2 h-36">
                {data.daily.map((d, i) => {
                  const maxV = maxBar(data.daily.map(x => x.decartCredits + x.marginCredits));
                  const totalD = d.decartCredits + d.marginCredits;
                  const pct = Math.round((totalD / maxV) * 100);
                  const dPct = totalD > 0 ? Math.round((d.decartCredits / totalD) * pct) : 0;
                  const mPct = pct - dPct;
                  const label = d.day ? new Date(d.day).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group cursor-default" title={`${label}\nDecart: ${fmtC(d.decartCredits)} cr\nMargin: ${fmtC(d.marginCredits)} cr\nSessions: ${d.sessions}`}>
                      <div className="flex flex-col-reverse items-stretch w-full" style={{ height: "112px" }}>
                        <div className="bg-red-500/70 w-full rounded-t-sm" style={{ height: `${dPct}%` }} />
                        <div className="bg-emerald-500/60 w-full" style={{ height: `${mPct}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-500 group-hover:text-slate-300 mt-1">{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {data && view === "scenario" && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700">
            <h2 className="text-sm font-semibold text-slate-200">Real-World Key Scenarios</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              At your current billing rate of <strong className="text-slate-300">{data.billingRate} cr/s</strong> vs Decart's{" "}
              <strong className="text-slate-300">{data.decartCostRate} cr/s</strong> (compression{" "}
              <strong className="text-slate-300">{data.compressionFactor}×</strong>): how long each key type actually streams and what it costs.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/40">
                  {["Key Sold", "Wallet Time", "Real Stream Time", "Timer shows at start", "Decart costs you", "Your margin", "Margin %"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scenarios.map(sc => {
                  const mins = Math.floor(sc.realSec / 60);
                  const secs = sc.realSec % 60;
                  const display = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                  const marginPct = Math.round((sc.margin / (sc.decartCost + sc.margin)) * 100);
                  return (
                    <tr key={sc.mins} className="border-b border-slate-800 last:border-0">
                      <td className="px-4 py-3 text-slate-300 font-semibold">{sc.mins} min key</td>
                      <td className="px-4 py-3 font-mono text-slate-400">{sc.mins}:00</td>
                      <td className="px-4 py-3 font-mono text-blue-400 font-bold">{display}</td>
                      <td className="px-4 py-3 font-mono text-slate-300">{display} (accurate)</td>
                      <td className="px-4 py-3 font-mono text-red-400">{sc.decartCost.toLocaleString()} cr</td>
                      <td className="px-4 py-3 font-mono text-emerald-400">+{sc.margin.toLocaleString()} cr</td>
                      <td className="px-4 py-3 font-mono text-yellow-400">{marginPct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-4 border-t border-slate-700 bg-slate-800/20 text-xs text-slate-500 space-y-1">
            <p><strong className="text-slate-400">Compression factor {data.compressionFactor}×</strong> means for every 1 wallet-second a user has, only 1÷{data.compressionFactor} = {(1/data.compressionFactor).toFixed(3)} real seconds are streamed.</p>
            <p><strong className="text-slate-400">Timer accuracy:</strong> the stream timer shows real remaining seconds (wallet ÷ compression), not raw wallet time — so users always see accurate countdown.</p>
            <p><strong className="text-slate-400">Hard-kill buffer:</strong> 3 wallet-seconds reserved — stream ends ~{(3 / data.compressionFactor).toFixed(1)}s before wallet hits zero to prevent any overage.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
type Tab = "summary" | "sessions" | "ghost" | "stream" | "wallet" | "billing-rate" | "credit-usage";

export default function AdminBillingIntelligencePage() {
  const [tab, setTab] = useState<Tab>("summary");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(false);
    const res = await apiFetch<Summary>("/summary");
    if (res) {
      setSummary(res);
    } else {
      setSummaryError(true);
    }
    setSummaryLoading(false);
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "summary", label: "Reconciliation Summary", icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: "sessions", label: "Session Billing Table", icon: <DollarSign className="w-3.5 h-3.5" /> },
    { id: "ghost", label: "Ghost Session Monitor", icon: <Ghost className="w-3.5 h-3.5" /> },
    { id: "stream", label: "Stream Ledger", icon: <Layers className="w-3.5 h-3.5" /> },
    { id: "wallet", label: "License Wallet", icon: <DollarSign className="w-3.5 h-3.5" /> },
    { id: "billing-rate",  label: "Billing Rate Monitor",  icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { id: "credit-usage",  label: "Credit Usage",           icon: <Zap className="w-3.5 h-3.5" /> },
  ];

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-6 max-w-screen-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-400" />
              Billing Intelligence
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Observability overlay — read-only view. Existing billing and sessions are unaffected.
            </p>
          </div>
          {tab === "summary" && (
            <button
              onClick={loadSummary}
              disabled={summaryLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${summaryLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )}
        </div>

        {/* Metric sync notice */}
        <div className="flex items-start gap-2.5 rounded-xl border border-indigo-800/40 bg-indigo-950/20 p-4 text-xs text-indigo-300">
          <Zap className="w-3.5 h-3.5 shrink-0 mt-0.5 text-indigo-400" />
          <div>
            <span className="font-semibold">Metric synchronization note: </span>
            Admin dashboard uses raw wall-clock time. This panel shows both actual Decart API cost
            (wallet.used_seconds × 2.3 cr/s fixed rate) and retail stream time (billing window × billingRate ÷ 2),
            making the two systems directly comparable. Active billing rate: <strong>{summary?.billingRate ?? "…"} cr/s</strong>.
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-700">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-indigo-500 text-indigo-300"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "summary" && (
          <div className="space-y-6">
            {summaryLoading ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-24 rounded-xl bg-slate-800 animate-pulse" />
                ))}
              </div>
            ) : summaryError || !summary ? (
              <div className="rounded-xl border border-red-800/40 bg-red-950/20 p-6 text-center text-sm text-red-400">
                Failed to load billing summary. Existing admin pages are unaffected.
              </div>
            ) : (
              <>
                <SummaryCards data={summary} />

                {/* ── Profit Optimization Panel ── */}
                <ProfitOptimizerPanel
                  billingRate={summary.billingRate}
                  showCurve
                  showKeyTable={false}
                  simulationSec={summary.totals.totalBillingSeconds || 3600}
                />

                {/* Metric comparison table */}
                <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-700">
                    <h2 className="text-sm font-semibold text-slate-200">Metric Comparison: Admin Dashboard vs Billing Engine</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Shows both raw wall-clock and settlement-formula metrics side by side.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-700 bg-slate-800/40">
                          <th className="text-left px-4 py-3 text-slate-500 font-medium">Metric</th>
                          <th className="text-left px-4 py-3 text-slate-500 font-medium">Admin Dashboard (wall-clock)</th>
                          <th className="text-left px-4 py-3 text-slate-500 font-medium">Billing Engine (settlement)</th>
                          <th className="text-left px-4 py-3 text-slate-500 font-medium">Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          {
                            metric: "Total Stream Time",
                            admin: fmtSec(summary.totals.totalComputeSeconds),
                            engine: fmtSec(summary.totals.totalBillingSeconds),
                            delta: fmtSec(Math.abs(summary.totals.totalComputeSeconds - summary.totals.totalBillingSeconds)),
                          },
                          {
                            metric: "Credits consumed",
                            admin: `${summary.totals.totalActualApiCredits.toLocaleString()} (Decart)`,
                            engine: `${summary.totals.totalRetailCredits.toLocaleString()} (retail)`,
                            delta: `${Math.abs(summary.totals.totalRetailCredits - summary.totals.totalActualApiCredits).toLocaleString()}`,
                          },
                          {
                            metric: "Effective cr/s",
                            admin: `2.3 cr/s (API cost rate)`,
                            engine: `${summary.totals.averageEffectiveCreditsPerSec.toFixed(2)} cr/s`,
                            delta: `${Math.abs(2.3 - summary.totals.averageEffectiveCreditsPerSec).toFixed(2)}`,
                          },
                          {
                            metric: "Billing denominator",
                            admin: "wall-clock × 5",
                            engine: `billing window × ${summary.billingRate} ÷ 2`,
                            delta: `rate factor: ${(summary.billingRate / 2).toFixed(1)}×`,
                          },
                        ].map((row) => (
                          <tr key={row.metric} className="border-b border-slate-800 last:border-0">
                            <td className="px-4 py-3 text-slate-300 font-medium">{row.metric}</td>
                            <td className="px-4 py-3 font-mono text-blue-400">{row.admin}</td>
                            <td className="px-4 py-3 font-mono text-yellow-400">{row.engine}</td>
                            <td className="px-4 py-3 font-mono text-slate-500">{row.delta}</td>
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

        {tab === "sessions" && (
          <SessionsTable billingRate={summary?.billingRate ?? 0} />
        )}

        {tab === "ghost" && <GhostSessionsPanel />}

        {tab === "stream" && <StreamLedgerPanel />}

        {tab === "wallet" && <LicenseWalletPanel />}

        {tab === "billing-rate" && <BillingRatePanel />}

        {tab === "credit-usage" && <CreditUsagePanel />}
      </div>
    </AdminLayout>
  );
}
