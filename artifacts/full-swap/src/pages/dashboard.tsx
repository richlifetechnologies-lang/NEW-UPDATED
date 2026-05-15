import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout";
import { getLicenseKey } from "@/lib/auth";
import { useLicense } from "@/hooks/useLicense";
import { LicenseActivationModal } from "@/components/license-modal";
import { Key, Clock, Activity, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

type LicenseStatus = {
  key: string;
  isActive: boolean;
  streamingEnabled: boolean;
  minutesAllocated: number;
  minutesUsed: number;
  minutesRemaining: number;
  usedSeconds: number;
  remainingSeconds: number;
  remainingMinutes: number;
  creditsAllocated: number;
  creditsUsed: number;
  creditsRemaining: number;
  assignedApiKey: string | null;
  expiresAt: string | null;
  activatedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Use useLicense hook for both Electron and web compatibility
  const { isElectron, isLicensed, isLoading: licenseLoading, error: licenseError, activateLicense } = useLicense();

  useEffect(() => {
    // For web: if no license key in localStorage, redirect to login
    if (!isElectron && !licenseLoading && !isLicensed) {
      setLocation("/");
      return;
    }
    // Once we know the user is licensed, fetch their status
    if (isLicensed && !licenseLoading) {
      fetchStatus();
    }
  }, [isLicensed, licenseLoading, isElectron]);

  async function fetchStatus() {
    setLoading(true);
    setError(null);
    try {
      const licKey = getLicenseKey();
      if (!licKey) { setError("No license key found."); setLoading(false); return; }
      const res = await fetch("/api/license/status", {
        headers: { "X-License-Key": licKey },
      });
      if (!res.ok) { setError("Failed to load license status."); return; }
      setStatus(await res.json());
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const usedPct = status ? Math.min(100, ((status.usedSeconds / 60) / (status.minutesAllocated || 1)) * 100) : 0;

  // For Electron: show license modal if not licensed
  if (isElectron && !licenseLoading && !isLicensed) {
    return <LicenseActivationModal onActivate={activateLicense} error={licenseError} mode="no-license" />;
  }

  // Loading license state
  if (licenseLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-wide">License Status</h1>
          <p className="text-muted-foreground mt-1 text-sm">Your license key usage and remaining time</p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 p-4 rounded-xl"
            style={{ background: "hsl(0 84% 60% / 0.08)", border: "1px solid hsl(0 84% 60% / 0.25)" }}>
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <span className="text-red-400 text-sm">{error}</span>
            <Button variant="ghost" size="sm" onClick={fetchStatus} className="ml-auto gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </Button>
          </div>
        )}

        {status && (
          <>
            {/* License Key Card */}
            <div className="p-5 rounded-xl space-y-4"
              style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-primary" />
                <span className="text-xs font-bold text-primary tracking-widest uppercase font-mono">License Key</span>
              </div>
              <p className="font-mono text-lg font-bold text-foreground tracking-widest">
                {status.key.slice(0, 5)}-XXXXX-XXXXX-{status.key.slice(-5)}
              </p>
              <div className="flex flex-wrap gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${status.isActive ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                  {status.isActive ? "Active" : "Revoked"}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${status.streamingEnabled ? "bg-blue-500/20 text-blue-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                  {status.streamingEnabled ? "Streaming Enabled" : "Streaming Disabled"}
                </span>
              </div>
            </div>

            {/* Time Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl"
                style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-primary" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide font-bold">Time Remaining</span>
                </div>
                <p className="text-2xl font-bold font-mono text-primary">{formatTime(status.remainingSeconds)}</p>
                <p className="text-xs text-muted-foreground mt-1">{Math.floor(status.remainingSeconds / 60)} min {(status.remainingSeconds % 60).toString().padStart(2, "0")}s remaining</p>
              </div>
              <div className="p-4 rounded-xl"
                style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide font-bold">Total Allocated</span>
                </div>
                <p className="text-2xl font-bold font-mono text-foreground">{status.minutesAllocated} min</p>
                <p className="text-xs text-muted-foreground mt-1">{formatTime(status.usedSeconds)} used</p>
              </div>
            </div>

            {/* Usage bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Usage</span>
                <span>{usedPct.toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full" style={{ background: "hsl(222 40% 14%)" }}>
                <div className="h-2 rounded-full transition-all" style={{
                  width: `${usedPct}%`,
                  background: usedPct > 80 ? "hsl(0 84% 60%)" : usedPct > 50 ? "hsl(38 92% 50%)" : "hsl(187 100% 52%)",
                }} />
              </div>
            </div>

            {status.expiresAt && (
              <p className="text-xs text-muted-foreground">
                Expires: {new Date(status.expiresAt).toLocaleDateString()}
              </p>
            )}

            <div className="flex gap-3">
              <Link href="/stream">
                <Button className="gap-2 font-bold">Start Streaming</Button>
              </Link>
              <Button variant="outline" onClick={fetchStatus} className="gap-2">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
