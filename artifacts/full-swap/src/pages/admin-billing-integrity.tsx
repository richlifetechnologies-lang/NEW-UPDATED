import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "@/components/admin-layout";
import {
  ShieldAlert, ShieldCheck, AlertTriangle, AlertCircle,
  Activity, Zap, DollarSign, TrendingUp, Loader2, CheckCircle2,
  XCircle, Clock,
} from "lucide-react";

const API = (p: string) => `/api${p}`;
const token = () =>
  localStorage.getItem("fullswap_admin_token") ??
  localStorage.getItem("fullswap_token") ??
  "";
const authH = () => ({ Authorization: `Bearer ${token()}` });

const API_COST = 2.3;

/* ── types ─────────────────────────────────────────────────────────────── */
type SyncStatus = "sync" | "mild_lag" | "warning";
type StreamState = "healthy" | "stale";

type StreamIntegrity = {
  sessionId: string;
  licenseKey: string | null;
  activeBillingRate: number;
  billingRateSource: string;
  burnMultiplier: number;
  walletUsedSeconds: number;
  clockElapsedSeconds: number;
  driftDelta: number;
  revenuePerSecond: number;
  apiCostPerSecond: number;
  profitPerSecond: number;
  profitPerMinute: number;
  totalRevenueLive: number;
  totalApiCostLive: number;
  totalProfitLive: number;
  heartbeatAgeSeconds: number | null;
  liveStreamState: StreamState;
  syncStatus: SyncStatus;
};

type IntegrityResponse = {
  streams: StreamIntegrity[];
  activeCount: number;
  totalProfit: number;
  totalRevenue: number;
  totalApiCost: number;
  billingIntegrity: {
    dbRate: number;
    codeConstantRate: number;
    baseRate: number;
    hardcodeDetected: boolean;
    hardcodeAlert: string | null;
    burnMultiplier: number;
    liveBurnSpeed: number;
    profitPerSec: number;
    rateSource: string;
    rateVerified: boolean;
  };
  walletLedgerSync: {
    mismatchedStreams: number;
    allInSync: boolean;
    alert: string | null;
  };
  computedAt: string;
};

/* ── helpers ────────────────────────────────────────────────────────────── */
function SyncBadge({ status }: { status: SyncStatus }) {
  if (status === "sync")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-green-400">
        <CheckCircle2 className="w-3.5 h-3.5" /> IN SYNC
      </span>
    );
  if (status === "mild_lag")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-yellow-400">
        <Clock className="w-3.5 h-3.5" /> LAG
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-red-400">
      <XCircle className="w-3.5 h-3.5" /> DRIFT
    </span>
  );
}

function StateBadge({ state }: { state: StreamState }) {
  return state === "healthy" ? (
    <span className="text-xs font-mono text-green-400 flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> HEALTHY
    </span>
  ) : (
    <span className="text-xs font-mono text-yellow-400 flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" /> STALE
    </span>
  );
}

/* ── page ───────────────────────────────────────────────────────────────── */
export default function AdminBillingIntegrityPage() {
  const [data, setData]           = useState<IntegrityResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [apiError, setApiError]   = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch(API("/admin/billing-integrity"), { headers: authH() });
      if (res.ok) {
        setData(await res.json());
        setApiError(null);
      } else {
        const body = await res.json().catch(() => ({}));
        setApiError(`${res.status} — ${body.error ?? "unknown error"}`);
      }
      setLastUpdated(new Date());
    } catch (err: any) {
      setApiError(`Network error: ${err?.message ?? "fetch failed"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const bi      = data?.billingIntegrity;
  const sync    = data?.walletLedgerSync;
  const streams = data?.streams ?? [];

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-wide flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-primary" />
              Billing Integrity Monitor
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Live system verification — billing rate, wallet sync, and profit integrity. Read-only.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {loading && !data ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
              </span>
            ) : (
              <>
                {lastUpdated && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {lastUpdated.toLocaleTimeString()}
                  </span>
                )}
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                  style={{ background: "hsl(142 76% 36% / 0.12)", border: "1px solid hsl(142 76% 36% / 0.3)" }}
                >
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs text-green-400 font-mono font-semibold">LIVE</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── API error ── */}
        {apiError && (
          <div
            className="flex items-start gap-3 rounded-lg p-4 text-sm"
            style={{ background: "hsl(0 84% 60% / 0.08)", border: "1px solid hsl(0 84% 60% / 0.3)" }}
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-400 font-semibold font-mono">API Error</p>
              <p className="text-muted-foreground font-mono text-xs mt-1">{apiError}</p>
            </div>
          </div>
        )}

        {/* ── Hardcode Alert ── */}
        {bi?.hardcodeDetected && (
          <div
            className="flex items-start gap-3 rounded-xl p-4"
            style={{ background: "hsl(0 84% 60% / 0.1)", border: "2px solid hsl(0 84% 60% / 0.5)" }}
          >
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-400 font-bold font-mono tracking-wide">
                ⚠ BILLING RATE MISMATCH DETECTED
              </p>
              <p className="text-red-300 font-mono text-xs mt-1">{bi.hardcodeAlert}</p>
              <div className="flex gap-4 mt-2 text-xs font-mono">
                <span className="text-muted-foreground">
                  DB rate: <span className="text-primary font-bold">{bi.dbRate} cr/s</span>
                </span>
                <span className="text-muted-foreground">
                  Code constant: <span className="text-red-400 font-bold">{bi.codeConstantRate} cr/s</span>
                </span>
                <span className="text-muted-foreground">
                  Source file: <span className="text-foreground">billing-math.ts</span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Ledger Mismatch Alert ── */}
        {sync && !sync.allInSync && (
          <div
            className="flex items-start gap-3 rounded-xl p-4"
            style={{ background: "hsl(45 100% 50% / 0.08)", border: "2px solid hsl(45 100% 50% / 0.4)" }}
          >
            <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-400 font-bold font-mono tracking-wide">
                ⚠ WALLET-LEDGER DRIFT WARNING
              </p>
              <p className="text-yellow-300/80 font-mono text-xs mt-1">{sync.alert}</p>
              <p className="text-muted-foreground text-xs mt-1">
                Read-only alert — no data has been modified. Check heartbeat health below.
              </p>
            </div>
          </div>
        )}

        {/* ── All-clear banner when everything is healthy ── */}
        {data && !bi?.hardcodeDetected && sync?.allInSync && (
          <div
            className="flex items-center gap-3 rounded-xl p-3"
            style={{ background: "hsl(142 76% 36% / 0.08)", border: "1px solid hsl(142 76% 36% / 0.3)" }}
          >
            <ShieldCheck className="w-5 h-5 text-green-400 shrink-0" />
            <p className="text-green-400 font-mono text-sm font-semibold">
              Billing integrity verified — DB rate confirmed, wallet in sync, no hardcoded values detected
            </p>
          </div>
        )}

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-blue-400" />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Active Sessions</p>
            </div>
            <p className="text-2xl font-bold text-foreground font-mono">{data?.activeCount ?? "—"}</p>
          </div>

          <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-primary" />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">DB Billing Rate</p>
            </div>
            <p className="text-2xl font-bold text-primary font-mono">{bi?.dbRate ?? "—"} cr/s</p>
            <p className="text-xs text-green-400 font-mono mt-1 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> verified from database
            </p>
          </div>

          <div
            className="rounded-xl p-4"
            style={{
              background: "hsl(222 44% 6%)",
              border: `1px solid ${sync?.allInSync ? "hsl(142 76% 36% / 0.3)" : "hsl(45 100% 50% / 0.3)"}`,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className={`w-4 h-4 ${sync?.allInSync ? "text-green-400" : "text-yellow-400"}`} />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Sync Status</p>
            </div>
            <p className={`text-lg font-bold font-mono ${sync?.allInSync ? "text-green-400" : "text-yellow-400"}`}>
              {sync?.allInSync ? "ALL IN SYNC" : `${sync?.mismatchedStreams} DRIFTING`}
            </p>
          </div>

          <div
            className="rounded-xl p-4"
            style={{
              background: "hsl(222 44% 6%)",
              border: `1px solid ${(data?.totalProfit ?? 0) >= 0 ? "hsl(142 76% 36% / 0.3)" : "hsl(0 84% 60% / 0.2)"}`,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className={`w-4 h-4 ${(data?.totalProfit ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`} />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Net Profit</p>
            </div>
            <p className={`text-2xl font-bold font-mono ${(data?.totalProfit ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
              {data ? `${(data.totalProfit >= 0 ? "+" : "")}${data.totalProfit.toFixed(1)} cr` : "—"}
            </p>
          </div>
        </div>

        {/* ── Integrity detail panels ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Billing Rate Integrity */}
          <div className="rounded-xl p-5" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
            <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-4">
              Billing Rate Integrity
            </p>
            <div className="space-y-3 font-mono text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">DB Rate (authoritative)</span>
                <span className="text-primary font-bold">{bi?.dbRate ?? "…"} cr/s</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">Code Constant (DECART_CREDITS_PER_SEC)</span>
                <span className={`font-bold text-xs ${bi?.hardcodeDetected ? "text-red-400" : "text-foreground"}`}>
                  {bi?.codeConstantRate ?? "…"} cr/s
                </span>
              </div>
              <div className="h-px" style={{ background: "hsl(222 40% 14%)" }} />
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">Rate Source</span>
                <span className="text-green-400 text-xs flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" /> {bi?.rateSource ?? "database"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">Profit/sec</span>
                <span className={`font-bold text-xs ${(bi?.profitPerSec ?? 0) > 0 ? "text-green-400" : "text-red-400"}`}>
                  {bi ? `${bi.profitPerSec >= 0 ? "+" : ""}${bi.profitPerSec.toFixed(1)} cr/s` : "…"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">Constant vs DB</span>
                {bi ? (
                  bi.hardcodeDetected ? (
                    <span className="text-red-400 text-xs font-semibold flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> MISMATCH
                    </span>
                  ) : (
                    <span className="text-green-400 text-xs font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> MATCH
                    </span>
                  )
                ) : "—"}
              </div>
            </div>
          </div>

          {/* Wallet / Ledger Sync */}
          <div className="rounded-xl p-5" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
            <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-4">
              Wallet vs Clock Integrity
            </p>
            <div className="space-y-3 font-mono text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">Active sessions checked</span>
                <span className="text-foreground text-xs font-bold">{data?.activeCount ?? "—"}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">Drift warnings (&gt;90s)</span>
                <span className={`font-bold text-xs ${sync?.mismatchedStreams ? "text-red-400" : "text-green-400"}`}>
                  {sync?.mismatchedStreams ?? "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">Overall wallet sync</span>
                {sync ? (
                  sync.allInSync ? (
                    <span className="text-green-400 text-xs font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> ALL SYNCED
                    </span>
                  ) : (
                    <span className="text-yellow-400 text-xs font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> DRIFT DETECTED
                    </span>
                  )
                ) : "—"}
              </div>
              <div className="h-px" style={{ background: "hsl(222 40% 14%)" }} />
              <div className="rounded-lg p-3 space-y-1.5" style={{ background: "hsl(222 47% 4%)" }}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">How drift is measured</p>
                <p className="text-xs text-muted-foreground">
                  <span className="text-foreground">wallet_seconds</span> = heartbeat engine's{" "}
                  <span className="text-primary">duration_seconds</span> (source of truth)
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="text-foreground">clock_elapsed</span> = NOW() − billing_started_at
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="text-foreground">drift</span> = clock_elapsed − wallet_seconds
                  {" "}(≤30s is normal between heartbeats)
                </p>
              </div>
              <div className="rounded-lg p-3" style={{ background: "hsl(222 47% 4%)" }}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Live Revenue / Cost</p>
                <div className="flex justify-between text-xs">
                  <span className="text-primary font-mono">Rev: {(data?.totalRevenue ?? 0).toFixed(1)} cr</span>
                  <span className="text-red-400 font-mono">Cost: {(data?.totalApiCost ?? 0).toFixed(1)} cr</span>
                  <span className={`font-mono font-bold ${(data?.totalProfit ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                    Profit: {(data?.totalProfit ?? 0) >= 0 ? "+" : ""}{(data?.totalProfit ?? 0).toFixed(1)} cr
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Per-stream integrity table ── */}
        <div>
          <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-3">
            Per-Session Integrity — {data?.activeCount ?? 0} active
          </p>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: "hsl(222 44% 6%)" }}>
                    {[
                      "License Key",
                      "Wallet Secs",
                      "Clock Elapsed",
                      "Drift",
                      "Sync",
                      "Billing Rate",
                      "Rev/s",
                      "Cost/s",
                      "Profit/s",
                      "Total Profit",
                      "Heartbeat",
                      "State",
                    ].map(h => (
                      <th
                        key={h}
                        className="px-3 py-3 text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap text-right first:text-left"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && !data ? (
                    <tr>
                      <td colSpan={12} className="text-center py-12">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
                        <p className="text-muted-foreground text-xs font-mono mt-2">Loading integrity data…</p>
                      </td>
                    </tr>
                  ) : streams.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="text-center py-14 text-muted-foreground font-mono text-sm">
                        <Activity className="w-8 h-8 mx-auto mb-3 opacity-30" />
                        <p>No active sessions to monitor</p>
                        <p className="text-xs mt-1 opacity-60">Refreshes every 1 s automatically</p>
                      </td>
                    </tr>
                  ) : (
                    streams.map(s => {
                      const driftColor =
                        s.syncStatus === "sync"
                          ? "text-green-400"
                          : s.syncStatus === "mild_lag"
                          ? "text-yellow-400"
                          : "text-red-400";

                      return (
                        <tr key={s.sessionId} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}>
                          <td className="px-3 py-2.5 font-mono text-foreground whitespace-nowrap">
                            {s.licenseKey
                              ? `${s.licenseKey.substring(0, 8)}…${s.licenseKey.slice(-4)}`
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-foreground">
                            {s.walletUsedSeconds.toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                            {s.clockElapsedSeconds.toFixed(0)}
                          </td>
                          <td className={`px-3 py-2.5 text-right font-mono font-semibold ${driftColor}`}>
                            {s.driftDelta > 0 ? `+${s.driftDelta.toFixed(0)}s` : "0s"}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <SyncBadge status={s.syncStatus} />
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-primary">
                            {s.activeBillingRate} cr/s
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-primary">
                            {s.revenuePerSecond}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-red-400">
                            {s.apiCostPerSecond}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono font-semibold ${
                              s.profitPerSecond > 0
                                ? "text-green-400"
                                : s.profitPerSecond < 0
                                ? "text-red-400"
                                : "text-yellow-400"
                            }`}
                          >
                            {s.profitPerSecond >= 0 ? "+" : ""}
                            {s.profitPerSecond.toFixed(1)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono font-bold ${
                              s.totalProfitLive > 0
                                ? "text-green-400"
                                : s.totalProfitLive < 0
                                ? "text-red-400"
                                : "text-yellow-400"
                            }`}
                          >
                            {s.totalProfitLive >= 0 ? "+" : ""}
                            {s.totalProfitLive.toFixed(1)} cr
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                            {s.heartbeatAgeSeconds !== null
                              ? `${s.heartbeatAgeSeconds}s ago`
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <StateBadge state={s.liveStreamState} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── Footer: rules ── */}
        <div className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
          <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-3">
            Integrity Rules
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs font-mono">
            {[
              { label: "Rate Source", value: "DB only — never cached", color: "text-primary" },
              { label: "API Cost Rate", value: "Fixed: 2.3 cr/s", color: "text-red-400" },
              { label: "Drift Threshold", value: "> 90s = warning", color: "text-yellow-400" },
              { label: "Action on Mismatch", value: "Alert only — no auto-fix", color: "text-muted-foreground" },
            ].map(r => (
              <div key={r.label} className="p-2.5 rounded" style={{ background: "hsl(222 47% 4%)" }}>
                <p className="text-muted-foreground text-[10px] mb-1">{r.label}</p>
                <p className={`font-semibold ${r.color}`}>{r.value}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AdminLayout>
  );
}
