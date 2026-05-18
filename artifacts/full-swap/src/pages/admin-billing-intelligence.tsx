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
  RefreshCw,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";

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

  const SimpleTable = ({ rows, cols }: { rows: any[]; cols: string[] }) =>
    rows.length === 0 ? (
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
            {rows.map((row, i) => (
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
type Tab = "summary" | "sessions" | "ghost";

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
            Admin dashboard uses raw wall-clock time. This panel shows both actual Decart compute time
            (wall-clock × 5 credits/sec) and retail stream time (billing window × billingRate ÷ 2),
            making the two systems directly comparable. Billing rate: <strong>{summary?.billingRate ?? "…"} cr/s</strong>.
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
                            admin: `5 cr/s (fixed Decart)`,
                            engine: `${summary.totals.averageEffectiveCreditsPerSec.toFixed(2)} cr/s`,
                            delta: `${Math.abs(5 - summary.totals.averageEffectiveCreditsPerSec).toFixed(2)}`,
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
          <SessionsTable billingRate={summary?.billingRate ?? 5} />
        )}

        {tab === "ghost" && <GhostSessionsPanel />}
      </div>
    </AdminLayout>
  );
}
