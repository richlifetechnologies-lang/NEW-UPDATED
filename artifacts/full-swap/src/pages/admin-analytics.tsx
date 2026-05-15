import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart2, Key, Clock, TrendingUp, Activity, DollarSign,
  ChevronDown, ChevronUp, RefreshCw,
} from "lucide-react";

function headers() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token")}` };
}

function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-4 md:p-6">{children}</div>
    </div>
  );
}

interface AnalyticsSummary {
  totalLicenseKeys: number;
  activeLicenseKeys: number;
  totalSessions: number;
  totalMinutesStreamed: number;
  totalRevenue: number;
  newLicenseKeysToday: number;
}

interface KeyRow {
  id: number;
  key: string;
  minutesAllocated: number;
  minutesUsed: number;
  minutesRemaining: number;
  sessionCount: number;
  totalStreamMinutes: number;
  revenueUsd: number;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

interface PerKeyData {
  keys: KeyRow[];
  totals: {
    totalMinutesAllocated: number;
    totalMinutesUsed: number;
    totalStreamMinutes: number;
    totalSessions: number;
    totalRevenueUsd: number;
  };
}

type SortField = "key" | "minutesAllocated" | "minutesUsed" | "sessionCount" | "totalStreamMinutes" | "revenueUsd";

function fmtMin(m: number) {
  if (m === 0) return "0m";
  if (m < 1) return `${Math.round(m * 60)}s`;
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

function fmtKey(k: string) {
  return k.length > 19 ? `${k.slice(0, 10)}…${k.slice(-4)}` : k;
}

export default function AdminAnalyticsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [perKey, setPerKey] = useState<PerKeyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortField, setSortField] = useState<SortField>("createdAt" as any);
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("fullswap_admin_token")) navigate("/admin");
  }, [navigate]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/admin/analytics", { headers: headers() }),
        fetch("/api/admin/analytics/per-key", { headers: headers() }),
      ]);
      if (r1.ok) setSummary(await r1.json());
      if (r2.ok) setPerKey(await r2.json());
      if (!r1.ok || !r2.ok) toast({ title: "Failed to load analytics", variant: "destructive" });
    } catch {
      toast({ title: "Error loading analytics", variant: "destructive" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const summaryCards = [
    { label: "Total License Keys", value: summary?.totalLicenseKeys ?? "—", icon: Key },
    { label: "Active Keys", value: summary?.activeLicenseKeys ?? "—", icon: Activity },
    { label: "Total Sessions", value: summary?.totalSessions ?? "—", icon: BarChart2 },
    { label: "Total Streamed", value: summary?.totalMinutesStreamed != null ? fmtMin(summary.totalMinutesStreamed) : "—", icon: Clock },
    { label: "Total Revenue", value: summary?.totalRevenue != null ? `$${summary.totalRevenue.toFixed(2)}` : "—", icon: DollarSign },
    { label: "New Keys Today", value: summary?.newLicenseKeysToday ?? "—", icon: TrendingUp },
  ];

  function toggleSort(field: SortField) {
    if (sortField === field) setSortAsc(a => !a);
    else { setSortField(field); setSortAsc(false); }
  }

  const sorted = perKey ? [...perKey.keys].sort((a, b) => {
    const v = (x: KeyRow) => {
      if (sortField === "key") return x.key;
      if (sortField === "minutesAllocated") return x.minutesAllocated;
      if (sortField === "minutesUsed") return x.minutesUsed;
      if (sortField === "sessionCount") return x.sessionCount;
      if (sortField === "totalStreamMinutes") return x.totalStreamMinutes;
      if (sortField === "revenueUsd") return x.revenueUsd;
      return x.createdAt;
    };
    const va = v(a), vb = v(b);
    return sortAsc ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);
  }) : [];

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  function Th({ field, label }: { field: SortField; label: string }) {
    return (
      <th
        className="px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap"
        onClick={() => toggleSort(field)}
      >
        <span className="inline-flex items-center gap-1">{label}<SortIcon field={field} /></span>
      </th>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
            <p className="text-muted-foreground mt-1">Platform usage and revenue tracking — per key and overall</p>
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {loading && (
          <div className="text-center py-12 text-muted-foreground">Loading analytics...</div>
        )}

        {!loading && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {summaryCards.map(({ label, value, icon: Icon }) => (
                <div key={label} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </div>
                  <div className="text-2xl font-bold text-foreground">{value}</div>
                </div>
              ))}
            </div>

            {/* Per-Key Breakdown */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Per-Key Breakdown</h2>
                <span className="text-xs text-muted-foreground">{perKey?.keys.length ?? 0} keys</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/30">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Status</th>
                      <Th field="key" label="License Key" />
                      <Th field="minutesAllocated" label="Allocated" />
                      <Th field="minutesUsed" label="Used" />
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Remaining</th>
                      <Th field="sessionCount" label="Sessions" />
                      <Th field="totalStreamMinutes" label="Streamed" />
                      <Th field="revenueUsd" label="Revenue" />
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Last Used</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sorted.map((k) => {
                      const pct = k.minutesAllocated > 0 ? Math.min(100, (k.minutesUsed / k.minutesAllocated) * 100) : 0;
                      return (
                        <tr key={k.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-2.5">
                            <span className={`inline-block w-2 h-2 rounded-full ${k.isActive ? "bg-green-500" : "bg-red-500"}`} title={k.isActive ? "Active" : "Inactive"} />
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-foreground" title={k.key}>
                            {fmtKey(k.key)}
                          </td>
                          <td className="px-3 py-2.5 text-foreground tabular-nums">
                            {fmtMin(k.minutesAllocated)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            <div className="flex items-center gap-2">
                              <span className="text-foreground">{fmtMin(k.minutesUsed)}</span>
                              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 60 ? "bg-yellow-500" : "bg-green-500"}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                            {fmtMin(k.minutesRemaining)}
                          </td>
                          <td className="px-3 py-2.5 text-center tabular-nums text-foreground">
                            {k.sessionCount}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-foreground">
                            {fmtMin(k.totalStreamMinutes)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-foreground">
                            {k.revenueUsd > 0 ? `$${k.revenueUsd.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                            {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never"}
                          </td>
                        </tr>
                      );
                    })}

                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground text-sm">No license keys yet</td>
                      </tr>
                    )}
                  </tbody>

                  {/* Totals row */}
                  {perKey && perKey.keys.length > 0 && (
                    <tfoot className="border-t-2 border-border bg-muted/20">
                      <tr className="font-semibold text-sm">
                        <td className="px-3 py-2.5" />
                        <td className="px-3 py-2.5 text-muted-foreground text-xs">TOTAL</td>
                        <td className="px-3 py-2.5 text-foreground tabular-nums">{fmtMin(perKey.totals.totalMinutesAllocated)}</td>
                        <td className="px-3 py-2.5 text-foreground tabular-nums">{fmtMin(perKey.totals.totalMinutesUsed)}</td>
                        <td className="px-3 py-2.5" />
                        <td className="px-3 py-2.5 text-center text-foreground tabular-nums">{perKey.totals.totalSessions}</td>
                        <td className="px-3 py-2.5 text-foreground tabular-nums">{fmtMin(perKey.totals.totalStreamMinutes)}</td>
                        <td className="px-3 py-2.5 text-foreground tabular-nums">
                          {perKey.totals.totalRevenueUsd > 0 ? `$${perKey.totals.totalRevenueUsd.toFixed(2)}` : "—"}
                        </td>
                        <td className="px-3 py-2.5" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
