import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { BarChart2, Key, Clock, TrendingUp, Activity, DollarSign } from "lucide-react";

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

export default function AdminAnalyticsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem("fullswap_admin_token")) navigate("/admin");
  }, [navigate]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/analytics", { headers: headers() });
      if (r.ok) {
        setSummary(await r.json());
      } else {
        toast({ title: "Failed to load analytics", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error loading analytics", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const stats = [
    { label: "Total License Keys", value: summary?.totalLicenseKeys ?? "—", icon: Key },
    { label: "Active License Keys", value: summary?.activeLicenseKeys ?? "—", icon: Activity },
    { label: "Total Sessions", value: summary?.totalSessions ?? "—", icon: BarChart2 },
    { label: "Minutes Streamed", value: summary?.totalMinutesStreamed ?? "—", icon: Clock },
    { label: "Total Revenue", value: summary?.totalRevenue != null ? `$${summary.totalRevenue.toFixed(2)}` : "—", icon: DollarSign },
    { label: "New License Keys Today", value: summary?.newLicenseKeysToday ?? "—", icon: TrendingUp },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-muted-foreground mt-1">Platform usage and performance overview</p>
        </div>

        {loading && (
          <div className="text-center py-12 text-muted-foreground">Loading analytics...</div>
        )}

        {!loading && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {stats.map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </div>
                <div className="text-2xl font-bold text-foreground">{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
