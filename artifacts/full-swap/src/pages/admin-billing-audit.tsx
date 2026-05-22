import { useState } from "react";
  import { AdminLayout } from "@/components/admin-layout";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import { Badge } from "@/components/ui/badge";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { useQuery } from "@tanstack/react-query";
  import { getAdminToken } from "@/lib/auth";
  import { Search, CheckCircle, AlertTriangle, Clock, Zap, Calculator, ArrowRight } from "lucide-react";

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

  const EVENT_COLORS: Record<string, string> = {
    connect: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    stream_start: "bg-green-500/10 text-green-400 border-green-500/20",
    heartbeat_ok: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    heartbeat_exhausted: "bg-red-500/10 text-red-400 border-red-500/20",
    stop: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    disconnect: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    orphan_kill: "bg-red-600/10 text-red-500 border-red-600/20",
    freeze_kill: "bg-red-600/10 text-red-500 border-red-600/20",
    token_issued: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    token_cache_hit: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  };

  export default function AdminBillingAuditPage() {
    const [input, setInput] = useState("");
    const [sessionId, setSessionId] = useState<string | null>(null);

    const { data: recentData } = useQuery({
      queryKey: ["billing-audit-recent"],
      queryFn: () => apiFetch("/api/admin/billing-audit/recent"),
      staleTime: 30000,
    });

    const { data, isLoading, error } = useQuery({
      queryKey: ["billing-audit", sessionId],
      queryFn: () => apiFetch(`/api/admin/billing-audit?sessionId=${sessionId}`),
      enabled: !!sessionId,
      staleTime: 60000,
    });

    const handleSearch = () => {
      const id = input.trim();
      if (id) setSessionId(id);
    };

    const verdict = data?.totals?.verdict;
    const billingMath = data?.billingMath;
    const heartbeatReplay: any[] = data?.heartbeatReplay ?? [];
    const events: any[] = data?.events ?? [];

    return (
      <AdminLayout>
        <div className="p-6 max-w-6xl mx-auto space-y-6">

          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">Billing Audit</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Replay any session's heartbeat sequence and verify the billing math step-by-step.
            </p>
          </div>

          {/* Search */}
          <Card>
            <CardContent className="pt-5">
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

              {/* Recent sessions */}
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

          {/* Loading / Error */}
          {isLoading && (
            <Card><CardContent className="pt-6 text-center text-muted-foreground text-sm">Loading audit...</CardContent></Card>
          )}
          {error && (
            <Card className="border-destructive/30"><CardContent className="pt-6 text-center text-destructive text-sm">{String(error)}</CardContent></Card>
          )}

          {data && (
            <>
              {/* Verdict banner */}
              <div className={`flex items-center gap-3 p-4 rounded-lg border ${verdict === "CLEAN" ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                {verdict === "CLEAN"
                  ? <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
                  : <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />}
                <div>
                  <p className={`font-semibold text-sm ${verdict === "CLEAN" ? "text-green-400" : "text-red-400"}`}>
                    {verdict === "CLEAN" ? "Billing math checks out — no anomalies found" : `${data.totals.anomalyCount} anomaly(s) detected — review the heartbeat table below`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono">{sessionId}</p>
                </div>
              </div>

              {/* Stats row */}
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

              {/* Billing math */}
              {billingMath && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Calculator className="w-4 h-4" />
                      Billing Math Breakdown
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Formula */}
                    <div className="bg-muted/30 rounded-lg p-4 font-mono text-sm">
                      <p className="text-muted-foreground text-xs mb-2 uppercase tracking-wide">Formula</p>
                      <p className="text-foreground">{billingMath.formula}</p>
                    </div>
                    {/* Math cards */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {[
                        { label: "Billing Rate (admin)", value: `${billingMath.billingRate} cr/s` },
                        { label: "Decart Cost Rate", value: `${billingMath.decartCostRate} cr/s` },
                        { label: "Compression Factor", value: `×${billingMath.compressionFactor}`, highlight: true },
                        { label: "Wallet Size", value: fmt(billingMath.walletTotalSec) },
                        { label: "Expected Real Stream", value: `${fmt(billingMath.expectedRealStreamSec)} (${billingMath.expectedRealStreamMin}m)` },
                        { label: "Actual Real Stream", value: fmt(billingMath.actualRealStreamSec) },
                      ].map(({ label, value, highlight }) => (
                        <div key={label} className={`rounded-md p-3 border ${highlight ? "border-primary/30 bg-primary/5" : "border-border bg-muted/20"}`}>
                          <p className="text-xs text-muted-foreground mb-1">{label}</p>
                          <p className={`font-mono font-semibold text-sm ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A compression factor of {billingMath.compressionFactor}× means every 1 real second streamed deducts {billingMath.compressionFactor}s from the wallet.
                      This is how profit is made over Decart's {billingMath.decartCostRate} cr/s cost.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Heartbeat replay table */}
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

              {/* Event timeline */}
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
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* No events */}
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
  