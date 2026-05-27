import { useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { getAdminToken } from "@/lib/auth";
import { Key, Clock, RefreshCw, ExternalLink, AlertTriangle, ShieldCheck, Wifi } from "lucide-react";
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

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function stopLabel(reason: string | null, status: string | null): { label: string; color: string } {
  if (status === "active") return { label: "Streaming now", color: "text-green-400" };
  if (!reason && !status) return { label: "No sessions yet", color: "text-muted-foreground" };
  const map: Record<string, { label: string; color: string }> = {
    client_stop:            { label: "User stopped",           color: "text-blue-400" },
    out_of_time:            { label: "Display hit 0:00",        color: "text-yellow-400" },
    heartbeat_exhausted:    { label: "Wallet empty",            color: "text-orange-400" },
    orphan:                 { label: "Network failure (orphan)", color: "text-red-400" },
    freeze:                 { label: "Freeze kill",             color: "text-red-400" },
    admin_terminate:        { label: "Admin terminated",        color: "text-purple-400" },
    license_exhausted:      { label: "Display hit 0:00",        color: "text-yellow-400" },
    dropped:                { label: "WebRTC dropped",          color: "text-orange-400" },
    unload:                 { label: "Tab closed",              color: "text-slate-400" },
    unknown:                { label: "Unknown",                 color: "text-muted-foreground" },
  };
  return map[reason ?? ""] ?? { label: reason ?? status ?? "Stopped", color: "text-muted-foreground" };
}

function walletPercent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

export default function AdminLicenseUsagePage() {
  const [showAll, setShowAll] = useState(false);
  const [, setLocation] = useLocation();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["license-usage"],
    queryFn: () => apiFetch("/api/admin/license-usage"),
    staleTime: 30_000,
  });

  const allKeys: any[] = data?.keys ?? [];
  const iceBufferSec: number = data?.iceBufferSec ?? 45;
  const usedKeys = allKeys.filter((k: any) => k.hasBeenUsed);
  const displayKeys = showAll ? allKeys : usedKeys;

  const totalOrphanKills = allKeys.reduce((s: number, k: any) => s + (k.orphanKillCount ?? 0), 0);
  const totalIceWalletSec = allKeys.reduce((s: number, k: any) => s + (k.iceBufferWalletSec ?? 0), 0);
  const activeCount = allKeys.filter((k: any) => k.lastSessionStatus === "active").length;

  return (
    <AdminLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">License Usage Report</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Per-licence-key wallet usage, session history, and network-failure ICE surcharges charged to users.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5 mr-2" />
            Refresh
          </Button>
        </div>

        {/* ICE buffer explainer */}
        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <Wifi className="w-4 h-4 text-orange-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">ICE Failure Surcharge Policy</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  When a user's network fails, Decart continues billing for up to 30–60 s during WebRTC ICE teardown.
                  Your system charges users a fixed <span className="font-mono text-orange-400">{iceBufferSec}s</span> buffer on every network-failure (orphan) kill
                  so the admin never absorbs this cost. Buffer is compressed at the user's billing rate before being deducted from their wallet.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats row */}
        {!isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Keys",      value: allKeys.length,       icon: Key,          color: "" },
              { label: "Keys Used",       value: usedKeys.length,      icon: Clock,        color: "" },
              { label: "Active Now",      value: activeCount,          icon: ShieldCheck,  color: "text-green-400" },
              { label: "Orphan Kills",    value: totalOrphanKills,     icon: AlertTriangle, color: totalOrphanKills > 0 ? "text-orange-400" : "" },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${color || "text-muted-foreground"}`} />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                  <p className={`text-2xl font-bold font-mono ${color || "text-foreground"}`}>{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* ICE total summary */}
        {!isLoading && totalOrphanKills > 0 && (
          <Card className="border-orange-500/20">
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Total Orphan Kills (all keys)</p>
                  <p className="font-mono font-bold text-orange-400">{totalOrphanKills} kills</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Real Decart Burn Covered</p>
                  <p className="font-mono font-bold text-foreground">{fmt(totalOrphanKills * iceBufferSec)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Total Wallet Seconds Recovered</p>
                  <p className="font-mono font-bold text-green-400">{fmt(totalIceWalletSec)}</p>
                </div>
                <div className="flex items-center">
                  <span className="text-xs text-muted-foreground">These costs were charged to users, not absorbed by admin.</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tab toggle */}
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

        {/* Loading / error */}
        {isLoading && (
          <Card><CardContent className="pt-8 pb-8 text-center text-muted-foreground text-sm">Loading license usage data…</CardContent></Card>
        )}
        {error && (
          <Card className="border-destructive/30">
            <CardContent className="pt-6 text-center text-destructive text-sm">{String(error)}</CardContent>
          </Card>
        )}

        {!isLoading && displayKeys.length === 0 && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center text-muted-foreground text-sm">
              {showAll ? "No licence keys found." : "No keys have been used for streaming yet."}
            </CardContent>
          </Card>
        )}

        {/* Key cards */}
        {!isLoading && displayKeys.length > 0 && (
          <div className="space-y-3">
            {displayKeys.map((k: any) => {
              const stop = stopLabel(k.lastStopReason, k.lastSessionStatus);
              const pct = walletPercent(k.usedSeconds, k.walletSec);
              const isActive = k.lastSessionStatus === "active";
              const hasOrphans = k.orphanKillCount > 0;

              return (
                <Card
                  key={k.id}
                  className={`transition-colors ${isActive ? "border-green-500/30 bg-green-500/5" : hasOrphans ? "border-orange-500/20" : ""}`}
                >
                  <CardContent className="pt-4 pb-4">

                    {/* Top row: identity + status badges */}
                    <div className="flex flex-col md:flex-row md:items-start gap-4">

                      {/* Key identity */}
                      <div className="min-w-0 md:w-52 shrink-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Key className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="font-mono text-xs text-foreground truncate">{maskKey(k.key)}</span>
                          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0 animate-pulse" />}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-xs">{k.minutesAllocated}m key</Badge>
                          <Badge variant="outline" className={`text-xs ${k.isActive ? "border-green-500/30 text-green-400" : "border-red-500/30 text-red-400"}`}>
                            {k.isActive ? "active" : "inactive"}
                          </Badge>
                        </div>
                        {k.lastUsedAt && (
                          <p className="text-xs text-muted-foreground mt-1.5">Last used: {fmtDate(k.lastUsedAt)}</p>
                        )}
                      </div>

                      {/* Billing stats */}
                      <div className="flex flex-wrap gap-x-6 gap-y-3 flex-1 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Sessions</p>
                          <p className="font-mono font-semibold text-foreground">{k.sessionCount}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Used</p>
                          <p className="font-mono font-semibold text-foreground">{fmt(k.usedSeconds)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Remaining</p>
                          <p className={`font-mono font-semibold ${k.remainingSec <= 0 ? "text-red-400" : "text-green-400"}`}>{fmt(k.remainingSec)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Last Stop</p>
                          <p className={`text-xs font-medium ${stop.color}`}>{stop.label}</p>
                          {k.lastSessionStoppedAt && (
                            <p className="text-xs text-muted-foreground">{fmtDate(k.lastSessionStoppedAt)}</p>
                          )}
                        </div>

                        {/* ICE surcharge block — only shown when orphan kills exist */}
                        {hasOrphans && (
                          <div className="border border-orange-500/20 bg-orange-500/5 rounded-lg px-3 py-2">
                            <p className="text-xs text-orange-400 font-semibold mb-1 flex items-center gap-1">
                              <Wifi className="w-3 h-3" />
                              ICE Surcharge Applied
                            </p>
                            <div className="flex gap-4">
                              <div>
                                <p className="text-xs text-muted-foreground">Network failures</p>
                                <p className="font-mono text-sm font-bold text-orange-400">{k.orphanKillCount}×</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Real Decart burn</p>
                                <p className="font-mono text-sm font-semibold text-foreground">{fmt(k.iceBufferRealSec)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Wallet charged</p>
                                <p className="font-mono text-sm font-semibold text-foreground">{fmt(k.iceBufferWalletSec)}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Wallet drain bar */}
                      <div className="md:w-40 shrink-0">
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Wallet</span>
                          <span>{pct}% used</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-primary"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                          <span>{fmt(k.usedSeconds)} used</span>
                          <span>{fmt(k.walletSec)} total</span>
                        </div>
                      </div>
                    </div>

                    {/* Audit link */}
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
