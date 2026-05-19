/**
 * admin-billing-observatory.tsx
 *
 * Live billing observatory: real-time WebSocket event feed + Railway
 * deployment monitoring and one-click redeploy — all in one admin page.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { AdminLayout } from "@/components/admin-layout";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  CloudOff,
  Loader2,
  Radio,
  RefreshCw,
  RotateCcw,
  Server,
  Wifi,
  WifiOff,
  Zap,
  GitBranch,
  GitCommit,
  TrendingUp,
  DollarSign,
  Wallet,
} from "lucide-react";

// ─── Shared auth header ────────────────────────────────────────────────────
const adminToken = () => localStorage.getItem("fullswap_admin_token") ?? "";
const authH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${adminToken()}`,
});

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(path, { ...opts, headers: { ...authH(), ...(opts?.headers ?? {}) } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────
type WsEventType =
  | "billing_rate_changed"
  | "session_started"
  | "session_settled"
  | "wallet_updated"
  | "connected"
  | "ping";

interface WsEvent {
  type: WsEventType;
  ts: string;
  payload?: Record<string, unknown>;
}

interface LiveEvent {
  id: number;
  type: WsEventType;
  ts: Date;
  label: string;
  detail: string;
  color: string;
}

interface RailwayDeployment {
  deploymentId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  serviceId: string | null;
  serviceName: string | null;
  commitMessage: string | null;
  commitHash: string | null;
  branch: string | null;
}

interface RailwayService {
  serviceId: string;
  serviceName: string;
  latestDeployment: {
    deploymentId: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  } | null;
}

interface RailwayStatus {
  projectId: string;
  projectName: string | null;
  services: RailwayService[];
  queriedAt: string;
}

interface BillingSummary {
  billingRate: number;
  activeSessions: number;
  orphanSessions: number;
  totals: {
    totalSessions: number;
    totalBillableSeconds: number;
    totalRetailCredits: number;
    totalProfitMarginCredits: number;
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function statusColor(status: string): string {
  switch (status?.toUpperCase()) {
    case "SUCCESS": return "text-green-400";
    case "DEPLOYING": return "text-yellow-400";
    case "BUILDING": return "text-blue-400";
    case "FAILED": return "text-red-400";
    case "CRASHED": return "text-red-500";
    case "REMOVED": return "text-muted-foreground";
    default: return "text-muted-foreground";
  }
}

function statusBg(status: string): string {
  switch (status?.toUpperCase()) {
    case "SUCCESS": return "bg-green-500/10 border-green-500/30";
    case "DEPLOYING": return "bg-yellow-500/10 border-yellow-500/30";
    case "BUILDING": return "bg-blue-500/10 border-blue-500/30";
    case "FAILED": return "bg-red-500/10 border-red-500/30";
    case "CRASHED": return "bg-red-600/10 border-red-600/30";
    default: return "bg-muted/30 border-border";
  }
}

function statusDot(status: string): string {
  switch (status?.toUpperCase()) {
    case "SUCCESS": return "bg-green-500";
    case "DEPLOYING": return "bg-yellow-400 animate-pulse";
    case "BUILDING": return "bg-blue-400 animate-pulse";
    case "FAILED": return "bg-red-500";
    case "CRASHED": return "bg-red-600";
    default: return "bg-muted-foreground";
  }
}

function fmtTime(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtRelative(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function eventConfig(type: WsEventType, payload: Record<string, unknown> = {}): { label: string; detail: string; color: string } {
  switch (type) {
    case "billing_rate_changed":
      return {
        label: "Billing Rate Changed",
        detail: `${payload["previousRate"] ?? "?"} → ${payload["newRate"] ?? "?"} cr/s${payload["changedBy"] ? ` by ${payload["changedBy"]}` : ""}`,
        color: "text-yellow-400",
      };
    case "session_started":
      return {
        label: "Session Started",
        detail: `Session ${String(payload["sessionId"] ?? "").slice(0, 8)}… · license #${payload["licenseKeyId"] ?? "?"}`,
        color: "text-blue-400",
      };
    case "session_settled":
      return {
        label: "Session Settled",
        detail: `${String(payload["sessionId"] ?? "").slice(0, 8)}… · ${payload["durationSeconds"] ?? 0}s billed · ${payload["debitedSeconds"] ?? 0}s debited`,
        color: "text-green-400",
      };
    case "wallet_updated":
      return {
        label: "Wallet Updated",
        detail: `License #${payload["licenseKeyId"] ?? "?"} · used ${payload["usedSeconds"] ?? 0}s · ${payload["remainingSeconds"] ?? 0}s left`,
        color: "text-purple-400",
      };
    case "connected":
      return { label: "WebSocket Connected", detail: "Live feed active", color: "text-green-400" };
    default:
      return { label: type, detail: JSON.stringify(payload).slice(0, 60), color: "text-muted-foreground" };
  }
}

let eventIdCounter = 0;

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminBillingObservatoryPage() {
  // ── WebSocket state ──────────────────────────────────────────────────────
  const wsRef = useRef<WebSocket | null>(null);
  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed">("closed");
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [eventCount, setEventCount] = useState(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Railway state ────────────────────────────────────────────────────────
  const [railwayStatus, setRailwayStatus] = useState<RailwayStatus | null>(null);
  const [deployments, setDeployments] = useState<RailwayDeployment[]>([]);
  const [railwayLoading, setRailwayLoading] = useState(false);
  const [railwayError, setRailwayError] = useState<string | null>(null);
  const [redeploying, setRedeploying] = useState<string | null>(null);
  const [redeploySuccess, setRedeploySuccess] = useState<string | null>(null);

  // ── Billing summary ──────────────────────────────────────────────────────
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // ── WebSocket connection ─────────────────────────────────────────────────
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/api/admin/billing-intelligence/ws?token=${encodeURIComponent(adminToken())}`;

    setWsStatus("connecting");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus("open");
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WsEvent;
        if (msg.type === "ping") return;
        const cfg = eventConfig(msg.type, msg.payload ?? {});
        const evt: LiveEvent = {
          id: ++eventIdCounter,
          type: msg.type,
          ts: new Date(msg.ts),
          ...cfg,
        };
        setLiveEvents(prev => [evt, ...prev].slice(0, 120));
        setEventCount(c => c + 1);
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setWsStatus("closed");
      wsRef.current = null;
      // Auto-reconnect after 4 seconds
      reconnectTimer.current = setTimeout(connectWs, 4000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connectWs();
    return () => {
      reconnectTimer.current && clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connectWs]);

  // ── Fetch Railway status ─────────────────────────────────────────────────
  const fetchRailway = useCallback(async () => {
    setRailwayLoading(true);
    setRailwayError(null);
    const [statusRes, depsRes] = await Promise.all([
      apiFetch<RailwayStatus>("/api/admin/railway/status"),
      apiFetch<{ deployments: RailwayDeployment[] }>("/api/admin/railway/deployments?limit=8"),
    ]);
    setRailwayLoading(false);
    if (!statusRes) {
      setRailwayError("Unable to reach Railway API. Make sure RAILWAY_TOKEN is set on the server.");
    } else {
      setRailwayStatus(statusRes);
      setRailwayError(null);
    }
    if (depsRes?.deployments) setDeployments(depsRes.deployments);
  }, []);

  // ── Fetch billing summary ────────────────────────────────────────────────
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    const res = await apiFetch<BillingSummary>("/api/admin/billing-intelligence/summary");
    setSummaryLoading(false);
    if (res) setSummary(res);
  }, []);

  useEffect(() => {
    fetchRailway();
    fetchSummary();
    const interval = setInterval(() => {
      fetchRailway();
      fetchSummary();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchRailway, fetchSummary]);

  // ── Redeploy ─────────────────────────────────────────────────────────────
  const triggerRedeploy = async (deploymentId: string) => {
    setRedeploying(deploymentId);
    setRedeploySuccess(null);
    const res = await apiFetch<{ ok: boolean; newDeploymentId: string }>("/api/admin/railway/redeploy", {
      method: "POST",
      body: JSON.stringify({ deploymentId }),
    });
    setRedeploying(null);
    if (res?.ok) {
      setRedeploySuccess(deploymentId);
      setTimeout(() => setRedeploySuccess(null), 5000);
      fetchRailway();
    }
  };

  // ── Clear event log ──────────────────────────────────────────────────────
  const clearEvents = () => setLiveEvents([]);

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Radio className="w-6 h-6 text-primary" />
              Billing Observatory
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Live billing events · Railway deployment control
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { fetchRailway(); fetchSummary(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
            {/* WS badge */}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
              wsStatus === "open"
                ? "bg-green-500/10 border-green-500/30 text-green-400"
                : wsStatus === "connecting"
                ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                : "bg-muted border-border text-muted-foreground"
            }`}>
              {wsStatus === "open" ? (
                <><Wifi className="w-3 h-3" /> Live</>
              ) : wsStatus === "connecting" ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> Connecting…</>
              ) : (
                <><WifiOff className="w-3 h-3" /> Disconnected</>
              )}
            </div>
          </div>
        </div>

        {/* Billing summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard
            icon={<Activity className="w-4 h-4 text-blue-400" />}
            label="Active Sessions"
            value={summary?.activeSessions ?? "—"}
            loading={summaryLoading}
            accent="blue"
          />
          <SummaryCard
            icon={<Zap className="w-4 h-4 text-yellow-400" />}
            label="Billing Rate"
            value={summary ? `${summary.billingRate} cr/s` : "—"}
            loading={summaryLoading}
            accent="yellow"
          />
          <SummaryCard
            icon={<DollarSign className="w-4 h-4 text-green-400" />}
            label="Total Retail Credits"
            value={summary ? summary.totals.totalRetailCredits.toLocaleString() : "—"}
            loading={summaryLoading}
            accent="green"
          />
          <SummaryCard
            icon={<TrendingUp className="w-4 h-4 text-purple-400" />}
            label="Profit Margin"
            value={summary ? summary.totals.totalProfitMarginCredits.toLocaleString() : "—"}
            loading={summaryLoading}
            accent="purple"
          />
        </div>

        {/* Main grid: Live feed + Railway */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Live event feed */}
          <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Radio className={`w-4 h-4 ${wsStatus === "open" ? "text-green-400" : "text-muted-foreground"}`} />
                <span className="text-sm font-semibold text-foreground">Live Event Feed</span>
                {eventCount > 0 && (
                  <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-mono">
                    {eventCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {wsStatus === "closed" && (
                  <button
                    onClick={connectWs}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> Reconnect
                  </button>
                )}
                {liveEvents.length > 0 && (
                  <button
                    onClick={clearEvents}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto max-h-96 font-mono text-xs">
              {liveEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <Circle className="w-8 h-8 opacity-30" />
                  <span>{wsStatus === "open" ? "Waiting for events…" : "Connecting to live feed…"}</span>
                </div>
              ) : (
                <table className="w-full">
                  <tbody>
                    {liveEvents.map(evt => (
                      <tr key={evt.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap w-20">
                          {fmtTime(evt.ts)}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <EventTypeBadge type={evt.type} />
                        </td>
                        <td className="px-2 py-2 text-muted-foreground truncate max-w-0 w-full">
                          {evt.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Legend */}
            <div className="px-4 py-2.5 border-t border-border bg-muted/10 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> session_started</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" /> session_settled</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" /> wallet_updated</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" /> rate_changed</span>
            </div>
          </div>

          {/* Railway deployment panel */}
          <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Railway Deployment</span>
              </div>
              <button
                onClick={fetchRailway}
                disabled={railwayLoading}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${railwayLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {railwayError ? (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Railway API Error</p>
                    <p className="mt-0.5 text-red-400/80">{railwayError}</p>
                    <p className="mt-2 text-muted-foreground">
                      Set <code className="bg-muted px-1 rounded">RAILWAY_TOKEN</code> in your Railway service variables.
                    </p>
                  </div>
                </div>
              ) : railwayLoading && !railwayStatus ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Fetching Railway status…
                </div>
              ) : railwayStatus ? (
                <>
                  {/* Project info */}
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{railwayStatus.projectName ?? "Railway Project"}</span>
                    <span className="mx-1.5 opacity-40">·</span>
                    <span className="font-mono opacity-60">{railwayStatus.projectId.slice(0, 8)}…</span>
                    <span className="mx-1.5 opacity-40">·</span>
                    updated {fmtRelative(railwayStatus.queriedAt)}
                  </div>

                  {/* Services */}
                  {railwayStatus.services.map(svc => (
                    <div key={svc.serviceId} className={`rounded-lg border p-3 space-y-2 ${svc.latestDeployment ? statusBg(svc.latestDeployment.status) : "bg-muted/20 border-border"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {svc.latestDeployment && (
                            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(svc.latestDeployment.status)}`} />
                          )}
                          <span className="text-sm font-medium text-foreground">{svc.serviceName}</span>
                        </div>
                        {svc.latestDeployment && (
                          <span className={`text-xs font-mono font-semibold ${statusColor(svc.latestDeployment.status)}`}>
                            {svc.latestDeployment.status}
                          </span>
                        )}
                      </div>
                      {svc.latestDeployment && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Deployed {fmtRelative(svc.latestDeployment.createdAt)}</span>
                          <button
                            onClick={() => triggerRedeploy(svc.latestDeployment!.deploymentId)}
                            disabled={redeploying === svc.latestDeployment.deploymentId}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                              redeploySuccess === svc.latestDeployment.deploymentId
                                ? "bg-green-500/20 text-green-400"
                                : "bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-50"
                            }`}
                          >
                            {redeploying === svc.latestDeployment.deploymentId ? (
                              <><Loader2 className="w-3 h-3 animate-spin" /> Deploying…</>
                            ) : redeploySuccess === svc.latestDeployment.deploymentId ? (
                              <><CheckCircle2 className="w-3 h-3" /> Triggered!</>
                            ) : (
                              <><RotateCcw className="w-3 h-3" /> Redeploy</>
                            )}
                          </button>
                        </div>
                      )}
                      {!svc.latestDeployment && (
                        <p className="text-xs text-muted-foreground">No deployments found</p>
                      )}
                    </div>
                  ))}
                </>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <CloudOff className="w-4 h-4" />
                  No Railway data yet
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Recent deployments table */}
        {deployments.length > 0 && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Recent Deployments</span>
              <span className="text-xs text-muted-foreground ml-auto">Auto-refreshes every 30s</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Status</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Service</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Commit</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Branch</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Deployed</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map(dep => (
                    <tr key={dep.deploymentId} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${statusDot(dep.status)}`} />
                          <span className={`font-mono font-semibold ${statusColor(dep.status)}`}>{dep.status}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-foreground">{dep.serviceName ?? "—"}</td>
                      <td className="px-4 py-2.5 max-w-[180px]">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <GitCommit className="w-3 h-3 shrink-0" />
                          <span className="font-mono truncate">
                            {dep.commitHash ? dep.commitHash.slice(0, 7) : "—"}
                          </span>
                          {dep.commitMessage && (
                            <span className="truncate ml-1 opacity-70">{dep.commitMessage.slice(0, 30)}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono">
                        {dep.branch ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {fmtRelative(dep.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => triggerRedeploy(dep.deploymentId)}
                          disabled={!!redeploying}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ml-auto transition-colors ${
                            redeploySuccess === dep.deploymentId
                              ? "bg-green-500/20 text-green-400"
                              : "bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-50"
                          }`}
                        >
                          {redeploying === dep.deploymentId ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : redeploySuccess === dep.deploymentId ? (
                            <><CheckCircle2 className="w-3 h-3" /> Done</>
                          ) : (
                            <><RotateCcw className="w-3 h-3" /> Redeploy</>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Setup instructions if no Railway token */}
        {railwayError && railwayError.includes("RAILWAY_TOKEN") && (
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Server className="w-4 h-4" /> Railway Setup Instructions
            </h3>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Go to your Railway project → <strong className="text-foreground">Service → Variables</strong></li>
              <li>Add <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground">RAILWAY_TOKEN</code> = your API token</li>
              <li>Add <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground">RAILWAY_PROJECT_ID</code> = <span className="font-mono text-xs">2ba336f7-3178-49fb-983a-2091d509dbfd</span></li>
              <li>Railway will auto-redeploy with the new variables — then refresh this page</li>
            </ol>
          </div>
        )}

      </div>
    </AdminLayout>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function SummaryCard({
  icon, label, value, loading, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  loading: boolean;
  accent: "blue" | "yellow" | "green" | "purple";
}) {
  const accents = {
    blue: "border-blue-500/20 bg-blue-500/5",
    yellow: "border-yellow-500/20 bg-yellow-500/5",
    green: "border-green-500/20 bg-green-500/5",
    purple: "border-purple-500/20 bg-purple-500/5",
  };
  return (
    <div className={`rounded-xl border p-4 ${accents[accent]}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      {loading && value === "—" ? (
        <div className="h-6 w-16 bg-muted/40 rounded animate-pulse" />
      ) : (
        <p className="text-xl font-bold font-mono text-foreground">{value}</p>
      )}
    </div>
  );
}

function EventTypeBadge({ type }: { type: WsEventType }) {
  const styles: Record<string, string> = {
    session_started: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    session_settled: "bg-green-500/10 text-green-400 border-green-500/20",
    wallet_updated: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    billing_rate_changed: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    connected: "bg-green-500/10 text-green-400 border-green-500/20",
  };
  const labels: Record<string, string> = {
    session_started: "start",
    session_settled: "settled",
    wallet_updated: "wallet",
    billing_rate_changed: "rate",
    connected: "conn",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono whitespace-nowrap ${styles[type] ?? "bg-muted text-muted-foreground border-border"}`}>
      {labels[type] ?? type}
    </span>
  );
}
