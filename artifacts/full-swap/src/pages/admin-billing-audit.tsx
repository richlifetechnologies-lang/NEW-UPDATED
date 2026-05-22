import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { getAdminToken } from "@/lib/auth";
import {
  Search, CheckCircle, AlertTriangle, Clock, Zap, Calculator, ArrowRight,
  Activity, RefreshCw, Skull, Database, ShieldAlert, TrendingUp,
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string) {
  const token = getAdminToken();
  const res = await fetch(`${API}${path}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function fmt(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtRelative(ts: string | null | undefined): string {
  if (!ts) return "—";
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 5)  return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function liveMeta(eventType: string, metadata: any): string {
  if (!metadata) return "";
  if (eventType === "settle")             return `debited: ${metadata.debited ?? 0}s`;
  if (eventType === "hard_kill")          return `reserve: ${metadata.safetyReserveSec ?? 5}s`;
  if (eventType === "startup_orphan_kill") return `dur: ${metadata.durationSecs ?? 0}s`;
  return "";
}

const EVENT_COLORS: Record<string, string> = {
  connect:             "bg-blue-500/10 text-blue-400 border-blue-500/20",
  stream_start:        "bg-green-500/10 text-green-400 border-green-500/20",
  heartbeat_ok:        "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  heartbeat_exhausted: "bg-red-500/10 text-red-400 border-red-500/20",
  stop:                "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  disconnect:          "bg-orange-500/10 text-orange-400 border-orange-500/20",
  orphan_kill:         "bg-red-600/10 text-red-500 border-red-600/20",
  freeze_kill:         "bg-red-600/10 text-red-500 border-red-600/20",
  token_issued:        "bg-purple-500/10 text-purple-400 border-purple-500/20",
  token_cache_hit:     "bg-slate-500/10 text-slate-400 border-slate-500/20",
  // RC billing audit additions
  hard_kill:           "bg-rose-600/10 text-rose-400 border-rose-600/30",
  settle:              "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  startup_orphan_kill: "bg-amber-600/10 text-amber-400 border-amber-600/20",
};

const ALL_EVENT_TYPES = [
  "all",
  "hard_kill", "settle", "startup_orphan_kill",
  "heartbeat_ok", "heartbeat_exhausted",
  "connect", "stream_start", "stop", "disconnect",
  "orphan_kill", "freeze_kill",
  "token_issued", "token_cache_hit", "token_cache_miss",
];

export default function AdminBillingAuditPage() {
  // ── session audit state ───────────────────────────────────────────────────
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);

  // ── live feed state ───────────────────────────────────────────────────────
  const [liveEventType, setLiveEventType] = useState("all");
  const [liveSessionFilter, setLiveSessionFilter] = useState("");
  const [liveDebouncedSid, setLiveDebouncedSid] = useState("");
  const [liveExpanded, setLiveExpanded] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the session filter so we don't fire on every keystroke
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setLiveDebouncedSid(liveSessionFilter), 400);
  }, [liveSessionFilter]);

  // ── queries ───────────────────────────────────────────────────────────────
  const { data: recentData } = useQuery({
    queryKey: ["billing-audit-recent"],
    queryFn: () => apiFetch("/api/admin/billing-audit/recent"),
    staleTime: 30_000,
  });

  const { data: statsData } = useQuery({
    queryKey: ["billing-audit-stats"],
    queryFn: () => apiFetch("/api/admin/billing-audit/stats"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: liveData, dataUpdatedAt, isFetching: liveFetching } = useQuery({
    queryKey: ["billing-audit-live", liveEventType, liveDebouncedSid],
    queryFn: () => {
      const p = new URLSearchParams({ limit: "60" });
      if (liveEventType !== "all") p.set("eventType", liveEventType);
      if (liveDebouncedSid.length >= 4) p.set("sessionId", liveDebouncedSid);
      return apiFetch(`/api/admin/billing-audit/live?${p}`);
    },
    refetchInterval: liveExpanded ? 5_000 : false,
    staleTime: 0,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["billing-audit", sessionId],
    queryFn: () => apiFetch(`/api/admin/billing-audit?sessionId=${sessionId}`),
    enabled: !!sessionId,
    staleTime: 60_000,
  });

  const handleSearch = () => {
    const id = input.trim();
    if (id) setSessionId(id);
  };

  const verdict      = data?.totals?.verdict;
  const billingMath  = data?.billingMath;
  const heartbeatReplay: any[] = data?.heartbeatReplay ?? [];
  const events: any[] = data?.events ?? [];
  const settleEvent  = data?.settleEvent ?? null;
  const hardKillEvent = data?.hardKillEvent ?? null;

  const liveEvents: any[] = liveData?.events ?? [];

  return (
    <AdminLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Billing Audit</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time billing event monitor · heartbeat replay · credit reconciliation
          </p>
        </div>

        {/* ── 24h Stats Row ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            {
              label: "Hard Kills (24h)",
              value: statsData?.hardKills24h ?? "—",
              icon: Skull,
              red: (statsData?.hardKills24h ?? 0) > 0,
              tip: "Sessions server-killed at 5s safety reserve",
            },
            {
              label: "Orphan Kills (24h)",
              value: statsData?.orphanKills24h ?? "—",
              icon: ShieldAlert,
              red: (statsData?.orphanKills24h ?? 0) > 0,
              tip: "Ghost sessions cleared on startup sweep",
            },
            {
              label: "Settles (24h)",
              value: statsData?.settles24h ?? "—",
              icon: Database,
              red: false,
              tip: "Completed sessions with full credit reconciliation",
            },
            {
              label: "Credits Debited (24h)",
              value: statsData?.totalDebitedSec24h != null ? fmt(statsData.totalDebitedSec24h) : "—",
              icon: TrendingUp,
              red: false,
              tip: "Total wallet seconds deducted across all settled sessions",
            },
            {
              label: "Heartbeats OK (24h)",
              value: statsData?.heartbeatOk24h ?? "—",
              icon: Activity,
              red: false,
              tip: "Successful heartbeat pings in the last 24 hours",
            },
          ].map(({ label, value, icon: Icon, red, tip }) => (
            <Card key={label} title={tip}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={`w-3 h-3 ${red ? "text-red-400" : "text-muted-foreground"}`} />
                  <span className="text-xs text-muted-foreground truncate">{label}</span>
                </div>
                <p className={`text-xl font-bold font-mono ${red ? "text-red-400" : "text-foreground"}`}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Live Event Feed ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${liveExpanded ? "bg-green-400 animate-pulse" : "bg-muted-foreground"}`} />
                <Activity className="w-4 h-4" />
                Live Event Feed
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  {liveExpanded ? "auto-refreshes every 5s" : "paused"}
                </span>
              </CardTitle>
              <div className="flex items-center gap-2">
                {liveFetching && <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />}
                <span className="text-xs text-muted-foreground hidden sm:block">
                  {liveData?.fetchedAt ? `Updated ${fmtRelative(liveData.fetchedAt)}` : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setLiveExpanded(v => !v)}
                >
                  {liveExpanded ? "Pause" : "Resume"}
                </Button>
              </div>
            </div>

            {/* Filters */}
            <div className="flex gap-2 mt-2 flex-wrap">
              <select
                value={liveEventType}
                onChange={e => setLiveEventType(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {ALL_EVENT_TYPES.map(t => (
                  <option key={t} value={t}>{t === "all" ? "All event types" : t}</option>
                ))}
              </select>
              <Input
                className="h-8 text-xs font-mono w-60"
                placeholder="Filter by session ID (4+ chars)..."
                value={liveSessionFilter}
                onChange={e => setLiveSessionFilter(e.target.value)}
              />
              {(liveEventType !== "all" || liveSessionFilter) && (
                <Button
                  size="sm" variant="ghost" className="h-8 text-xs"
                  onClick={() => { setLiveEventType("all"); setLiveSessionFilter(""); }}
                >
                  Clear
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            {liveEvents.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                {liveExpanded ? "No events found — waiting for activity..." : "Feed paused"}
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-0.5 pr-1">
                {liveEvents.map((ev: any) => {
                  const meta = liveMeta(ev.eventType, ev.metadata);
                  return (
                    <div
                      key={ev.id}
                      className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/30 transition-colors group cursor-pointer"
                      onClick={() => { setInput(ev.sessionId); setSessionId(ev.sessionId); }}
                      title="Click to open session audit"
                    >
                      <span className="text-xs font-mono text-muted-foreground w-18 shrink-0 tabular-nums">
                        {fmtTime(ev.timestamp)}
                      </span>
                      <Badge variant="outline" className={`text-xs shrink-0 ${EVENT_COLORS[ev.eventType] ?? ""}`}>
                        {ev.eventType}
                      </Badge>
                      <span className="text-xs font-mono text-muted-foreground truncate flex-1 min-w-0">
                        {ev.sessionId?.slice(0, 8)}…
                      </span>
                      {ev.walletRemainingSeconds != null && (
                        <span className={`text-xs font-mono shrink-0 tabular-nums ${ev.walletRemainingSeconds <= 10 ? "text-red-400" : ev.walletRemainingSeconds <= 60 ? "text-yellow-400" : "text-muted-foreground"}`}>
                          {fmt(ev.walletRemainingSeconds)}
                        </span>
                      )}
                      {meta && (
                        <span className="text-xs text-muted-foreground/70 shrink-0 hidden sm:block">{meta}</span>
                      )}
                      <ArrowRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/70 shrink-0 transition-colors" />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Session Audit Search ────────────────────────────────────────── */}
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-3">
              Session Audit — heartbeat replay &amp; billing math
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Session ID..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                className="font-mono text-sm"
              />
              <Button onClick={handleSearch} disabled={!input.trim()}>
                <Search className="w-4 h-4 mr-2" />
                Audit
              </Button>
            </div>

            {/* Recent sessions quick-select */}
            {recentData?.sessions?.length > 0 && !sessionId && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Recent Sessions</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {recentData.sessions.map((s: any) => (
                    <button
                      key={s.id}
                      onClick={() => { setInput(s.id); setSessionId(s.id); }}
                      className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/50 transition-colors text-sm"
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${s.status === "active" ? "bg-green-400" : "bg-muted-foreground"}`} />
                      <span className="font-mono text-xs text-muted-foreground truncate flex-1">{s.id}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{fmtTime(s.startedAt)}</span>
                      <Badge variant="outline" className="text-xs shrink-0">{s.status}</Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Loading / Error ─────────────────────────────────────────────── */}
        {isLoading && (
          <Card><CardContent className="pt-6 text-center text-muted-foreground text-sm">Loading audit...</CardContent></Card>
        )}
        {error && (
          <Card className="border-destructive/30">
            <CardContent className="pt-6 text-center text-destructive text-sm">{String(error)}</CardContent>
          </Card>
        )}

        {data && (
          <>
            {/* ── Verdict banner ───────────────────────────────────────────── */}
            <div className={`flex items-center gap-3 p-4 rounded-lg border ${verdict === "CLEAN" ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
              {verdict === "CLEAN"
                ? <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
                : <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />}
              <div>
                <p className={`font-semibold text-sm ${verdict === "CLEAN" ? "text-green-400" : "text-red-400"}`}>
                  {verdict === "CLEAN"
                    ? "Billing math checks out — no anomalies found"
                    : `${data.totals.anomalyCount} anomaly(s) detected — review the heartbeat table below`}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">{sessionId}</p>
              </div>
            </div>

            {/* ── Stats row ────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Heartbeats", value: data.totals.heartbeatCount, icon: Clock },
                { label: "Total Billed", value: fmt(data.totals.totalBilledSec), icon: Zap },
                { label: "Wallet Size", value: fmt(billingMath?.walletTotalSec), icon: Calculator },
                { label: "Anomalies", value: data.totals.anomalyCount, icon: AlertTriangle, red: data.totals.anomalyCount > 0 },
              ].map(({ label, value, icon: Icon, red }) => (
                <Card key={label}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-3.5 h-3.5 ${red ? "text-red-400" : "text-muted-foreground"}`} />
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                    <p className={`text-xl font-bold font-mono ${red ? "text-red-400" : "text-foreground"}`}>{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* ── Settle + Hard Kill side cards ─────────────────────────────── */}
            {(settleEvent || hardKillEvent) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Settle event card */}
                {settleEvent && (
                  <Card className="border-cyan-500/20 bg-cyan-500/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Database className="w-4 h-4 text-cyan-400" />
                        <span className="text-cyan-400">Settle Record</span>
                        <Badge variant="outline" className="text-xs ml-auto bg-cyan-500/10 text-cyan-400 border-cyan-500/20">settle</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { label: "Debited", value: fmt(settleEvent.debited) },
                          { label: "Wallet After", value: fmt(settleEvent.walletAfter) },
                          { label: "Total Duration", value: fmt(settleEvent.totalDuration) },
                          { label: "Billing Rate", value: settleEvent.billingRateSnapshot != null ? `${settleEvent.billingRateSnapshot} cr/s` : "—" },
                        ].map(({ label, value }) => (
                          <div key={label} className="rounded-md p-2 border border-cyan-500/10 bg-background/50">
                            <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                            <p className="font-mono font-semibold text-sm text-foreground">{value}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Hard kill event card */}
                {hardKillEvent && (
                  <Card className="border-rose-500/20 bg-rose-500/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Skull className="w-4 h-4 text-rose-400" />
                        <span className="text-rose-400">Hard Kill Guard Triggered</span>
                        <Badge variant="outline" className="text-xs ml-auto bg-rose-600/10 text-rose-400 border-rose-600/30">hard_kill</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: "Wallet at Kill", value: fmt(hardKillEvent.walletAtKill) },
                          { label: "Safety Reserve", value: `${hardKillEvent.safetyReserveSec}s` },
                          { label: "Total Duration", value: fmt(hardKillEvent.totalDuration) },
                        ].map(({ label, value }) => (
                          <div key={label} className="rounded-md p-2 border border-rose-500/10 bg-background/50">
                            <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                            <p className="font-mono font-semibold text-sm text-foreground">{value}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Session was force-stopped when wallet reached the {hardKillEvent.safetyReserveSec}s safety reserve,
                        before hitting zero. This prevents Decart from billing past the user's entitlement during WebRTC teardown.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* ── Billing math ─────────────────────────────────────────────── */}
            {billingMath && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calculator className="w-4 h-4" />
                    Billing Math Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-muted/30 rounded-lg p-4 font-mono text-sm">
                    <p className="text-muted-foreground text-xs mb-2 uppercase tracking-wide">Formula</p>
                    <p className="text-foreground">{billingMath.formula}</p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      { label: "Billing Rate (admin)", value: `${billingMath.billingRate} cr/s` },
                      { label: "Decart Cost Rate",     value: `${billingMath.decartCostRate} cr/s` },
                      { label: "Compression Factor",   value: `×${billingMath.compressionFactor}`, highlight: true },
                      { label: "Wallet Size",          value: fmt(billingMath.walletTotalSec) },
                      { label: "Expected Real Stream", value: `${fmt(billingMath.expectedRealStreamSec)} (${billingMath.expectedRealStreamMin}m)` },
                      { label: "Actual Real Stream",   value: fmt(billingMath.actualRealStreamSec) },
                    ].map(({ label, value, highlight }) => (
                      <div key={label} className={`rounded-md p-3 border ${highlight ? "border-primary/30 bg-primary/5" : "border-border bg-muted/20"}`}>
                        <p className="text-xs text-muted-foreground mb-1">{label}</p>
                        <p className={`font-mono font-semibold text-sm ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A compression factor of {billingMath.compressionFactor}× means every 1 real second streamed
                    deducts {billingMath.compressionFactor}s from the wallet. This is how profit is made over
                    Decart's {billingMath.decartCostRate} cr/s cost.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* ── Heartbeat replay table ────────────────────────────────────── */}
            {heartbeatReplay.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Heartbeat Deduction Replay
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                          <th className="text-left pb-2 pr-4">#</th>
                          <th className="text-left pb-2 pr-4">Time</th>
                          <th className="text-left pb-2 pr-4">Type</th>
                          <th className="text-right pb-2 pr-4">Raw Secs</th>
                          <th className="text-right pb-2 pr-4">×Factor</th>
                          <th className="text-right pb-2 pr-4">Billed</th>
                          <th className="text-right pb-2 pr-4">Wallet Before</th>
                          <th className="text-right pb-2 pr-4">Wallet After</th>
                          <th className="text-left pb-2">Anomaly</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {heartbeatReplay.map((h, i) => (
                          <tr key={h.eventId} className={`${h.anomaly ? "bg-red-500/5" : ""} hover:bg-muted/20 transition-colors`}>
                            <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">{i + 1}</td>
                            <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{fmtTime(h.timestamp)}</td>
                            <td className="py-2 pr-4">
                              <Badge variant="outline" className={`text-xs ${EVENT_COLORS[h.eventType] ?? ""}`}>
                                {h.eventType}
                              </Badge>
                            </td>
                            <td className="py-2 pr-4 text-right font-mono text-xs">
                              {h.rawSecSinceLastBeat != null ? `${h.rawSecSinceLastBeat}s` : "—"}
                            </td>
                            <td className="py-2 pr-4 text-right font-mono text-xs text-muted-foreground">
                              ×{h.compressionFactor}
                            </td>
                            <td className="py-2 pr-4 text-right font-mono text-xs font-semibold text-red-400">
                              {h.compressedSecBilled != null ? `-${h.compressedSecBilled}s` : "—"}
                            </td>
                            <td className="py-2 pr-4 text-right font-mono text-xs">{fmt(h.walletBefore)}</td>
                            <td className={`py-2 pr-4 text-right font-mono text-xs font-semibold ${h.walletAfter <= 0 ? "text-red-400" : h.walletAfter < 30 ? "text-yellow-400" : "text-green-400"}`}>
                              {fmt(h.walletAfter)}
                            </td>
                            <td className="py-2">
                              {h.anomaly
                                ? <span className="text-xs text-red-400 font-medium">{h.anomaly}</span>
                                : <span className="text-xs text-emerald-500/50">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Full event timeline ───────────────────────────────────────── */}
            {events.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ArrowRight className="w-4 h-4" />
                    Full Event Timeline ({events.length} events)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 max-h-80 overflow-y-auto">
                    {events.map((ev: any) => (
                      <div key={ev.id} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-muted/20 transition-colors">
                        <span className="text-xs font-mono text-muted-foreground w-20 shrink-0">{fmtTime(ev.timestamp)}</span>
                        <Badge variant="outline" className={`text-xs shrink-0 ${EVENT_COLORS[ev.eventType] ?? ""}`}>
                          {ev.eventType}
                        </Badge>
                        {ev.walletRemainingSeconds != null && (
                          <span className="text-xs font-mono text-muted-foreground">
                            wallet: {fmt(ev.walletRemainingSeconds)}
                          </span>
                        )}
                        {/* Show key metadata inline for new event types */}
                        {ev.eventType === "settle" && ev.metadata?.debited != null && (
                          <span className="text-xs font-mono text-cyan-400/70">
                            debited: {fmt(ev.metadata.debited)}
                          </span>
                        )}
                        {ev.eventType === "hard_kill" && ev.metadata?.safetyReserveSec != null && (
                          <span className="text-xs font-mono text-rose-400/70">
                            reserve: {ev.metadata.safetyReserveSec}s
                          </span>
                        )}
                        {ev.eventType === "startup_orphan_kill" && ev.metadata?.durationSecs != null && (
                          <span className="text-xs font-mono text-amber-400/70">
                            dur: {fmt(ev.metadata.durationSecs)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {events.length === 0 && (
              <Card>
                <CardContent className="pt-6 pb-6 text-center text-muted-foreground text-sm">
                  No billing events found for this session. Events are recorded only when the billing event logger is active.
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
