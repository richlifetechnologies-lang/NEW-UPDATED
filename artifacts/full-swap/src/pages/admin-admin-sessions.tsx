import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useGetAdminSessionAudit, getGetAdminSessionAuditQueryKey, useSuspendAdmin } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/admin-layout";
import { RefreshCw, ShieldCheck, Radio, Clock, Activity, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getAdminProfile } from "@/lib/auth";

const STYLE_COLORS: Record<string, string> = {
  natural:        "bg-blue-500/15 text-blue-400",
  anime:          "bg-pink-500/15 text-pink-400",
  superhero:      "bg-yellow-500/15 text-yellow-400",
  cinematic:      "bg-purple-500/15 text-purple-400",
  cyberpunk:      "bg-cyan-500/15 text-cyan-400",
  "oil-painting": "bg-orange-500/15 text-orange-400",
  sketch:         "bg-zinc-500/15 text-zinc-300",
  "3d-render":    "bg-green-500/15 text-green-400",
  vintage:        "bg-amber-500/15 text-amber-400",
};

function formatDuration(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function useLiveTicker(sessions: { id: string; startedAt: string; status: string }[]) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const hasLive = sessions.some(s => s.status === "active");
    if (!hasLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sessions]);
  return (startedAt: string) =>
    Math.floor((now - new Date(startedAt).getTime()) / 1000);
}

export default function AdminAdminSessionsPage() {
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "stopped">("all");
  const [confirmSuspend, setConfirmSuspend] = useState<{ userId: number; username: string; email: string } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get current logged-in admin's email so we can disable suspending self
  const myProfile = getAdminProfile();

  useEffect(() => {
    if (!localStorage.getItem("fullswap_admin_token")) setLocation("/admin");
  }, [setLocation]);

  const audit = useGetAdminSessionAudit({
    query: {
      queryKey: getGetAdminSessionAuditQueryKey(),
      refetchInterval: 5000,
    },
  });

  const suspend = useSuspendAdmin({
    mutation: {
      onSuccess: (data: any) => {
        toast({ title: `${data.username ?? "Admin"} suspended`, description: "Admin access revoked and account suspended." });
        setConfirmSuspend(null);
        queryClient.invalidateQueries({ queryKey: getGetAdminSessionAuditQueryKey() });
        audit.refetch();
      },
      onError: (err: any) => {
        toast({ title: "Failed to suspend", description: err?.message ?? "Unknown error", variant: "destructive" });
        setConfirmSuspend(null);
      },
    },
  });

  const allRows = audit.data ?? [];
  const getLiveElapsed = useLiveTicker(allRows);

  const filtered = allRows.filter(r =>
    statusFilter === "all" ? true : r.status === statusFilter
  );

  // Unique admins in the list (for suspend button — show once per admin, not per session)
  // We track which userIds we've seen to show the suspend button only once per admin
  const seenUserIds = new Set<number>();

  const liveCount = allRows.filter(r => r.status === "active").length;
  const totalSessions = allRows.length;
  const totalSecsStopped = allRows
    .filter(r => r.status !== "active" && r.durationSeconds)
    .reduce((acc, r) => acc + (r.durationSeconds ?? 0), 0);
  const liveElapsedTotal = allRows
    .filter(r => r.status === "active")
    .reduce((acc, r) => acc + getLiveElapsed(r.startedAt), 0);
  const totalSecsAll = totalSecsStopped + liveElapsedTotal;

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-6" data-testid="admin-audit-page">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-destructive" />
              Admin Audit Log
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              All streaming sessions created by admin accounts
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className={`w-3.5 h-3.5 ${audit.isFetching ? "animate-spin text-primary" : ""}`} />
            Auto-refreshes every 5s
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{totalSessions}</p>
              <p className="text-xs text-muted-foreground">Total Sessions</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
              <Radio className={`w-5 h-5 text-green-400 ${liveCount > 0 ? "animate-pulse" : ""}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{liveCount}</p>
              <p className="text-xs text-muted-foreground">Live Right Now</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{formatDuration(totalSecsAll)}</p>
              <p className="text-xs text-muted-foreground">Total Admin Stream Time</p>
            </div>
          </div>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{filtered.length} session{filtered.length !== 1 ? "s" : ""}</span>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["all", "active", "stopped"] as const).map(v => (
              <button
                key={v}
                onClick={() => setStatusFilter(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === v
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {v === "all" ? "All" : v === "active" ? "Live" : "Stopped"}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {audit.isLoading ? (
            <div className="p-8 space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-14 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                <ShieldCheck className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-foreground font-medium mb-1">No sessions yet</p>
              <p className="text-muted-foreground text-sm">
                Admin streaming sessions will appear here once admins use the app.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-background/50">
                    <th className="text-left p-4 text-muted-foreground font-medium">Admin</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Style</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Status</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Started</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Duration</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Session ID</th>
                    <th className="text-right p-4 text-muted-foreground font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => {
                    const isLive = row.status === "active";
                    const liveSecs = isLive ? getLiveElapsed(row.startedAt) : null;
                    const displaySecs = isLive ? (liveSecs ?? 0) : (row.durationSeconds ?? 0);
                    const isSelf = row.email === myProfile?.email;
                    const alreadySeen = seenUserIds.has(row.userId);
                    if (!alreadySeen) seenUserIds.add(row.userId);

                    return (
                      <tr
                        key={row.id}
                        data-testid={`audit-row-${row.id}`}
                        className="border-b border-border last:border-0 hover:bg-accent/5"
                      >
                        {/* Admin */}
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            {row.avatarUrl ? (
                              <img
                                src={row.avatarUrl}
                                alt={row.username}
                                className="w-8 h-8 rounded-full object-cover border border-border shrink-0"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-destructive/20 border border-destructive/30 flex items-center justify-center shrink-0 text-xs font-bold text-destructive">
                                {row.username.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <p className="font-medium text-foreground flex items-center gap-1.5">
                                {row.username}
                                {isSelf && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-semibold">You</span>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">{row.email}</p>
                            </div>
                          </div>
                        </td>

                        {/* Style */}
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${STYLE_COLORS[row.style ?? ""] ?? "bg-muted text-muted-foreground"}`}>
                            {row.style?.replace("-", " ") ?? "Default"}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="p-4">
                          {isLive ? (
                            <span className="flex items-center gap-1.5 text-green-400 text-xs font-semibold">
                              <Radio className="w-3.5 h-3.5 animate-pulse" />
                              LIVE
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground font-medium">Stopped</span>
                          )}
                        </td>

                        {/* Started */}
                        <td className="p-4 text-xs text-muted-foreground">
                          <span>{new Date(row.startedAt).toLocaleDateString()}</span>
                          <br />
                          <span className="text-muted-foreground/60">{new Date(row.startedAt).toLocaleTimeString()}</span>
                        </td>

                        {/* Duration */}
                        <td className="p-4">
                          <span className={`font-mono font-semibold tabular-nums ${isLive ? "text-green-400" : "text-foreground"}`}>
                            {formatDuration(displaySecs)}
                          </span>
                          {isLive && <span className="ml-1 text-[10px] text-green-400/60">live</span>}
                        </td>

                        {/* Session ID */}
                        <td className="p-4 font-mono text-xs text-muted-foreground">
                          {row.id.slice(0, 8)}…
                        </td>

                        {/* Actions — Suspend button, shown once per unique admin */}
                        <td className="p-4 text-right">
                          {!alreadySeen && !isSelf ? (
                            <Button
                              data-testid={`button-suspend-${row.userId}`}
                              size="sm"
                              variant="ghost"
                              className="gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setConfirmSuspend({ userId: row.userId, username: row.username, email: row.email })}
                            >
                              <UserX className="w-3.5 h-3.5" />
                              Suspend
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Confirm Suspend Dialog */}
      <Dialog open={!!confirmSuspend} onOpenChange={(open) => { if (!open) setConfirmSuspend(null); }}>
        <DialogContent style={{ background: "hsl(222 44% 7%)", border: "1px solid hsl(222 40% 14%)" }}>
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <UserX className="w-4 h-4 text-destructive" />
              Suspend Admin Account
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              You are about to suspend{" "}
              <span className="text-foreground font-semibold">{confirmSuspend?.username}</span>{" "}
              ({confirmSuspend?.email}).
            </p>
            <div className="px-4 py-3 rounded-lg text-sm space-y-1" style={{ background: "hsl(0 80% 50% / 0.08)", border: "1px solid hsl(0 80% 50% / 0.2)" }}>
              <p className="text-destructive font-medium">This will:</p>
              <ul className="text-muted-foreground space-y-0.5 list-disc list-inside text-xs">
                <li>Revoke their admin portal access</li>
                <li>Suspend their user account</li>
                <li>Stop any unlimited streaming privileges</li>
              </ul>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmSuspend(null)}>Cancel</Button>
            <Button
              data-testid="button-confirm-suspend"
              variant="destructive"
              disabled={suspend.isPending}
              onClick={() => confirmSuspend && suspend.mutate({ userId: confirmSuspend.userId })}
            >
              {suspend.isPending ? "Suspending…" : "Suspend Admin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
