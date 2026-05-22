import { useState } from "react";
import { useLocation } from "wouter";
  import { AdminLayout } from "@/components/admin-layout";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import { Badge } from "@/components/ui/badge";
  import { useQuery } from "@tanstack/react-query";
  import { getAdminToken } from "@/lib/auth";
  import { Key, Clock, Zap, CheckCircle, XCircle, RefreshCw, ExternalLink } from "lucide-react";
  import { Button } from "@/components/ui/button";

  const API = import.meta.env.BASE_URL.replace(/\/$/, "");

  async function apiFetch(path: string) {
    const res = await fetch(`${API}${path}`, {
      headers: { "Authorization": `Bearer ${getAdminToken()}` },
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  function fmt(sec: number | null | undefined): string {
    if (sec == null || sec === 0) return "0s";
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }

  function maskKey(k: string): string {
    if (!k || k.length < 8) return k;
    return k.slice(0, 6) + "••••" + k.slice(-4);
  }

  function stopLabel(reason: string | null, status: string | null): { label: string; color: string } {
    if (status === "active") return { label: "Streaming now", color: "text-green-400" };
    if (!reason && !status) return { label: "No sessions yet", color: "text-muted-foreground" };
    const map: Record<string, { label: string; color: string }> = {
      client_stop:          { label: "User stopped", color: "text-blue-400" },
      out_of_time:          { label: "Display hit 0:00 → killed", color: "text-yellow-400" },
      heartbeat_exhausted:  { label: "Wallet empty (heartbeat)", color: "text-orange-400" },
      orphan:               { label: "Orphan kill (no heartbeat)", color: "text-red-400" },
      freeze:               { label: "Freeze kill", color: "text-red-400" },
      admin_terminate:      { label: "Admin terminated", color: "text-purple-400" },
      pre_exhaustion_warning: { label: "Pre-exhaustion stop", color: "text-yellow-400" },
      license_exhausted:    { label: "Display hit 0:00 → killed", color: "text-yellow-400" },
      dropped:              { label: "WebRTC dropped", color: "text-orange-400" },
      unload:               { label: "Tab closed", color: "text-slate-400" },
      unknown:              { label: "Unknown", color: "text-muted-foreground" },
    };
    return map[reason ?? ""] ?? { label: reason ?? status ?? "Stopped", color: "text-muted-foreground" };
  }

  function walletPercent(used: number, total: number): number {
    if (total <= 0) return 0;
    return Math.min(100, Math.round((used / total) * 100));
  }

  export default function AdminKeyUsagePage() {
    const [showAll, setShowAll] = useState(false);
  const [, setLocation] = useLocation();

    const { data, isLoading, error, refetch } = useQuery({
      queryKey: ["key-usage"],
      queryFn: () => apiFetch("/api/admin/key-usage"),
      staleTime: 30000,
    });

    const allKeys: any[] = data?.keys ?? [];
    const usedKeys = allKeys.filter((k: any) => k.hasBeenUsed);
    const displayKeys = showAll ? allKeys : usedKeys;
    const decartRate = data?.decartCostRate ?? 2.3;

    return (
      <AdminLayout>
        <div className="p-6 max-w-6xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Key Usage Summary</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Per-licence-key billing breakdown — real stream time, wallet drain, and stop reason.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-3.5 h-3.5 mr-2" />
              Refresh
            </Button>
          </div>

          {/* Billing math explainer */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wide block mb-0.5">Decart Cost Rate</span>
                  <span className="font-mono font-semibold text-foreground">{decartRate} cr/s (fixed)</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wide block mb-0.5">Formula</span>
                  <span className="font-mono text-xs text-foreground">Real stream time = wallet seconds ÷ (billing rate ÷ {decartRate})</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wide block mb-0.5">Stop mechanism</span>
                  <span className="text-xs text-foreground">Display hits 0:00 → stream kills instantly</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats row */}
          {!isLoading && (
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Total Keys", value: allKeys.length, icon: Key },
                { label: "Keys Used", value: usedKeys.length, icon: Zap },
                { label: "Active Now", value: allKeys.filter((k: any) => k.lastSessionStatus === "active").length, icon: CheckCircle },
              ].map(({ label, value, icon: Icon }) => (
                <Card key={label}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                    <p className="text-2xl font-bold font-mono text-foreground">{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Table toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAll(false)}
              className={`text-sm font-medium pb-1 border-b-2 transition-colors ${!showAll ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              Used Keys ({usedKeys.length})
            </button>
            <button
              onClick={() => setShowAll(true)}
              className={`text-sm font-medium pb-1 border-b-2 transition-colors ${showAll ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              All Keys ({allKeys.length})
            </button>
          </div>

          {/* Loading / Error */}
          {isLoading && (
            <Card><CardContent className="pt-8 pb-8 text-center text-muted-foreground text-sm">Loading key usage data...</CardContent></Card>
          )}
          {error && (
            <Card className="border-destructive/30">
              <CardContent className="pt-6 text-center text-destructive text-sm">{String(error)}</CardContent>
            </Card>
          )}

          {/* Key cards */}
          {!isLoading && displayKeys.length === 0 && (
            <Card>
              <CardContent className="pt-8 pb-8 text-center text-muted-foreground text-sm">
                {showAll ? "No licence keys found." : "No keys have been used for streaming yet."}
              </CardContent>
            </Card>
          )}

          {!isLoading && displayKeys.length > 0 && (
            <div className="space-y-3">
              {displayKeys.map((k: any) => {
                const stop = stopLabel(k.lastStopReason, k.lastSessionStatus);
                const pct = walletPercent(k.usedSeconds, k.walletSec);
                const isActive = k.lastSessionStatus === "active";
                return (
                  <Card key={k.id} className={`transition-colors ${isActive ? "border-green-500/30 bg-green-500/5" : ""}`}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex flex-col md:flex-row md:items-center gap-4">

                        {/* Key identity */}
                        <div className="min-w-0 md:w-56 shrink-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Key className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="font-mono text-xs text-foreground truncate">{maskKey(k.key)}</span>
                            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0 animate-pulse" />}
                          </div>
                          <div className="flex items-center gap-2 mt-1.5">
                            <Badge variant="outline" className="text-xs">{k.minutesAllocated}m key</Badge>
                            <Badge variant="outline" className={`text-xs ${k.isActive ? "border-green-500/30 text-green-400" : "border-red-500/30 text-red-400"}`}>
                              {k.isActive ? "active" : "inactive"}
                            </Badge>
                          </div>
                        </div>

                        {/* Billing math */}
                        <div className="flex flex-wrap gap-x-6 gap-y-2 flex-1 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Wallet</p>
                            <p className="font-mono font-semibold text-foreground">{fmt(k.walletSec)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Billing Rate</p>
                            <p className="font-mono font-semibold text-foreground">{k.billingRate} cr/s</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Compression</p>
                            <p className="font-mono font-semibold text-primary">×{k.compressionFactor}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Real Stream Time</p>
                            <p className="font-mono font-semibold text-foreground">~{fmt(k.expectedRealStreamSec)}</p>
                            <p className="text-xs text-muted-foreground">({k.expectedRealStreamMin}m)</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Sessions</p>
                            <p className="font-mono font-semibold text-foreground">{k.sessionCount}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">How Stopped</p>
                            <p className={`text-xs font-medium ${stop.color}`}>{stop.label}</p>
                          </div>
                        </div>

                        {/* Wallet drain bar */}
                        <div className="md:w-40 shrink-0">
                          <div className="flex justify-between text-xs text-muted-foreground mb-1">
                            <span>Used</span>
                            <span>{fmt(k.usedSeconds)} / {fmt(k.walletSec)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-green-500"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 text-right">{pct}% drained</p>
                        </div>
                      </div>
                        {/* Audit last session link */}
                        {k.lastSessionId && (
                          <div className="mt-3 pt-3 border-t border-border/50 flex justify-end">
                            <button
                              onClick={() => setLocation(`/admin/billing-audit?sessionId=${k.lastSessionId}`)}
                              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Audit last session
                            </button>
                          </div>
                        )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </AdminLayout>
    );
  }
  