import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Activity, AlertTriangle, Clock, Minus, Plus, Radio, RefreshCw, Shield, Square } from "lucide-react";

function useLiveDurations(sessions: { id: string; startedAt: string }[]) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (startedAt: string) => {
    const secs = Math.floor((now - new Date(startedAt).getTime()) / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };
}

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

interface ActiveSession {
  id: number; key: string; isActive: boolean; activatedAt: string;
  minutesAllocated: number; minutesUsed: number; minutesRemaining: number;
  sessionId: string; style: string; startedAt: string;
}
interface AbuseFlag {
  sessionId: string; licenseKey: string; type: "heartbeat_spam" | "reconnect_loop" | "rapid_session";
  count: number; windowSeconds: number; detectedAt: string; severity: "low" | "medium" | "high";
}

const authH = () => ({ Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token") ?? ""}` });

type TabId = "sessions" | "control" | "abuse";

export default function AdminSessionsPage() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<TabId>("sessions");
  const [terminating, setTerminating] = useState<Record<string, boolean>>({});
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  // Live Control
  const [adjusting, setAdjusting] = useState<Record<string, boolean>>({});
  const [adjustMins, setAdjustMins] = useState<Record<string, string>>({});
  // Abuse Detection
  const [abuseFlags, setAbuseFlags] = useState<AbuseFlag[]>([]);
  const [abuseLoading, setAbuseLoading] = useState(false);
  const token = localStorage.getItem("fullswap_admin_token");

  useEffect(() => { if (!token) setLocation("/admin"); }, [setLocation, token]);

  const fetchSessions = useCallback(async () => {
    try {
      setIsFetching(true);
      const res = await fetch("/api/admin/license-keys/active-streaming", { headers: authH() });
      if (res.ok) { const d = await res.json(); setSessions(d.sessions || []); }
    } catch { /* silent */ } finally { setIsFetching(false); setIsLoading(false); }
  }, []);

  const fetchAbuse = useCallback(async () => {
    setAbuseLoading(true);
    try {
      const res = await fetch("/api/admin/unified/abuse-detection", { headers: authH() });
      if (res.ok) { const d = await res.json(); setAbuseFlags(d.flags ?? d.abuseSessions ?? []); }
    } catch { /* silent */ } finally { setAbuseLoading(false); }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  useEffect(() => {
    if (tab === "abuse") fetchAbuse();
  }, [tab, fetchAbuse]);

  const getDuration = useLiveDurations(sessions.map(s => ({ id: s.sessionId, startedAt: s.startedAt })));

  async function handleTerminate(sessionId: string) {
    setTerminating(prev => ({ ...prev, [sessionId]: true }));
    try {
      const res = await fetch(`/api/admin/license-keys/${sessionId}/terminate`, { method: "POST", headers: authH() });
      if (!res.ok) { const b = await res.json().catch(() => ({})); alert(b.error ?? "Failed to terminate session"); }
      else await fetchSessions();
    } catch { alert("Network error — could not terminate session"); }
    finally { setTerminating(prev => ({ ...prev, [sessionId]: false })); }
  }

  async function handleAdjust(sessionId: string, action: "extend" | "reduce") {
    const mins = parseInt(adjustMins[sessionId] ?? "10", 10);
    if (!mins || mins < 1) return;
    setAdjusting(prev => ({ ...prev, [sessionId]: true }));
    try {
      const res = await fetch(`/api/admin/unified/sessions/${sessionId}/${action}`, {
        method: "POST", headers: { ...authH(), "Content-Type": "application/json" },
        body: JSON.stringify({ minutes: mins }),
      });
      if (res.ok) { await fetchSessions(); }
      else { const b = await res.json().catch(() => ({})); alert(b.error ?? `Failed to ${action} session`); }
    } catch { alert("Network error"); }
    finally { setAdjusting(prev => ({ ...prev, [sessionId]: false })); }
  }

  const count = sessions.length;

  const TABS: { id: TabId; label: string; icon: any }[] = [
    { id: "sessions", label: "Live Sessions",   icon: Activity },
    { id: "control",  label: "Live Control",    icon: Clock },
    { id: "abuse",    label: "Abuse Detection", icon: Shield },
  ];

  const severityColor = (s: string) =>
    s === "high" ? "text-red-400 bg-red-500/10 border-red-500/20"
    : s === "medium" ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/20"
    : "text-blue-400 bg-blue-500/10 border-blue-500/20";

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-6" data-testid="admin-sessions-page">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Session Monitor</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {count > 0
                ? <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />{count} active license key{count !== 1 ? "s" : ""}</span>
                : "No active streams right now"}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin text-primary" : ""}`} />
            Auto-refreshes every 5s
          </div>
        </div>

        {/* Sub-tab Nav */}
        <div className="flex gap-1 border-b border-border">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap"
              style={tab === t.id
                ? { borderColor: "hsl(var(--primary))", color: "hsl(var(--primary))" }
                : { borderColor: "transparent", color: "hsl(215 20% 55%)" }}>
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
              {t.id === "abuse" && abuseFlags.filter(f => f.severity === "high").length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                  {abuseFlags.filter(f => f.severity === "high").length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── LIVE SESSIONS ── */}
        {tab === "sessions" && (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {isLoading ? (
              <div className="p-8 space-y-3">
                {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted rounded animate-pulse" />)}
              </div>
            ) : count > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-background/50">
                      <th className="text-left p-4 text-muted-foreground font-medium">License Key</th>
                      <th className="text-left p-4 text-muted-foreground font-medium">Allocated</th>
                      <th className="text-left p-4 text-muted-foreground font-medium">Remaining</th>
                      <th className="text-left p-4 text-muted-foreground font-medium">Style</th>
                      <th className="text-left p-4 text-muted-foreground font-medium">Started</th>
                      <th className="text-left p-4 text-muted-foreground font-medium">Duration</th>
                      <th className="text-left p-4 text-muted-foreground font-medium">Status</th>
                      <th className="text-left p-4 text-muted-foreground font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.sessionId} data-testid={`session-row-${s.sessionId}`} className="border-b border-border last:border-0 hover:bg-accent/5">
                        <td className="p-4"><p className="font-medium text-foreground font-mono text-xs">{s.key.slice(0, 8)}…{s.key.slice(-4)}</p></td>
                        <td className="p-4 font-mono text-foreground">{s.minutesAllocated}</td>
                        <td className="p-4">
                          <span className={`font-mono font-semibold ${s.minutesRemaining > 0 ? "text-green-400" : "text-red-400"}`}>
                            {Math.max(0, s.minutesRemaining).toFixed(1)}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${STYLE_COLORS[s.style ?? ""] ?? "bg-muted text-muted-foreground"}`}>
                            {s.style?.replace("-", " ") ?? "Default"}
                          </span>
                        </td>
                        <td className="p-4 text-xs text-muted-foreground">{new Date(s.startedAt).toLocaleTimeString()}</td>
                        <td className="p-4"><span className="font-mono text-foreground font-semibold tabular-nums">{getDuration(s.startedAt)}</span></td>
                        <td className="p-4">
                          <span className="flex items-center gap-2 text-green-400 text-xs font-semibold">
                            <Radio className="w-3.5 h-3.5 animate-pulse" />LIVE
                          </span>
                        </td>
                        <td className="p-4">
                          <button onClick={() => handleTerminate(s.sessionId)} disabled={terminating[s.sessionId]}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                            <Square className="w-3 h-3" />
                            {terminating[s.sessionId] ? "Stopping…" : "Terminate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-16 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                  <Activity className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="text-foreground font-medium mb-1">No active streams</p>
                <p className="text-muted-foreground text-sm">When license keys start streaming, they will appear here in real time.</p>
              </div>
            )}
          </div>
        )}

        {/* ── LIVE CONTROL ── */}
        {tab === "control" && (
          <div className="space-y-4">
            <div className="rounded-lg p-4" style={{ background: "hsl(187 100% 52% / 0.06)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
              <p className="text-xs font-mono" style={{ color: "hsl(187 100% 52%)" }}>
                <strong>Live Control</strong> — Extend or reduce active session time. Changes apply immediately to the running session's remaining minutes.
              </p>
            </div>
            {isLoading ? (
              <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded animate-pulse" />)}</div>
            ) : count === 0 ? (
              <div className="p-16 text-center">
                <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
                <p className="text-foreground font-medium">No active sessions to control</p>
              </div>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "hsl(222 44% 6%)" }}>
                      {["License Key", "Remaining (min)", "Adjust Minutes", "Extend", "Reduce", "Force Stop"].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-muted-foreground font-mono text-xs font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map(s => (
                      <tr key={s.sessionId} style={{ borderTop: "1px solid hsl(222 40% 11%)" }} className="hover:bg-accent/5">
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{s.key.slice(0, 8)}…{s.key.slice(-4)}</td>
                        <td className="px-4 py-3">
                          <span className={`font-mono font-bold text-sm ${s.minutesRemaining > 5 ? "text-green-400" : "text-red-400"}`}>
                            {Math.max(0, s.minutesRemaining).toFixed(1)}m
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 rounded-lg px-2 py-1 w-28" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 18%)" }}>
                            <input
                              type="number" min="1" max="9999" step="1"
                              value={adjustMins[s.sessionId] ?? "10"}
                              onChange={e => setAdjustMins(prev => ({ ...prev, [s.sessionId]: e.target.value }))}
                              className="w-full bg-transparent text-xs font-mono text-foreground focus:outline-none"
                            />
                            <span className="text-[10px] font-mono text-muted-foreground shrink-0">min</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleAdjust(s.sessionId, "extend")} disabled={adjusting[s.sessionId]}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors disabled:opacity-50">
                            <Plus className="w-3 h-3" />Extend
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleAdjust(s.sessionId, "reduce")} disabled={adjusting[s.sessionId]}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors disabled:opacity-50">
                            <Minus className="w-3 h-3" />Reduce
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleTerminate(s.sessionId)} disabled={terminating[s.sessionId]}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50">
                            <Square className="w-3 h-3" />Stop
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── ABUSE DETECTION ── */}
        {tab === "abuse" && (
          <div className="space-y-4">
            <div className="rounded-lg p-4" style={{ background: "hsl(0 84% 60% / 0.06)", border: "1px solid hsl(0 84% 60% / 0.2)" }}>
              <p className="text-xs font-mono text-red-400">
                <strong>Abuse Detection</strong> — Sessions flagged for heartbeat spam, reconnect loops, or rapid session cycling. Review and terminate if needed.
              </p>
            </div>
            {abuseLoading ? (
              <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted rounded animate-pulse" />)}</div>
            ) : abuseFlags.length === 0 ? (
              <div className="p-16 text-center">
                <Shield className="w-10 h-10 text-green-400 mx-auto mb-3 opacity-60" />
                <p className="text-foreground font-medium mb-1">No abuse detected</p>
                <p className="text-muted-foreground text-sm">All sessions are behaving normally.</p>
              </div>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: "hsl(222 44% 6%)" }}>
                      {["Session ID", "License Key", "Abuse Type", "Count", "Window", "Detected", "Severity", "Action"].map(h => (
                        <th key={h} className="px-3 py-3 text-left text-muted-foreground font-mono text-[11px] font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {abuseFlags.map((f, i) => (
                      <tr key={f.sessionId ?? i} style={{ borderTop: "1px solid hsl(222 40% 11%)" }}>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground text-[10px]">{String(f.sessionId ?? "—").slice(0, 12)}…</td>
                        <td className="px-3 py-2.5 font-mono text-foreground">{f.licenseKey ? `${f.licenseKey.slice(0, 8)}…${f.licenseKey.slice(-4)}` : "—"}</td>
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-muted text-foreground border border-border">
                            {f.type?.replace(/_/g, " ") ?? "unknown"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono font-bold text-foreground">{f.count ?? "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground">{f.windowSeconds ? `${f.windowSeconds}s` : "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground">
                          {f.detectedAt ? new Date(f.detectedAt).toLocaleTimeString() : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${severityColor(f.severity)}`}>
                            {f.severity?.toUpperCase() ?? "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <button onClick={() => handleTerminate(f.sessionId)}
                            disabled={terminating[f.sessionId]}
                            className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50">
                            <Square className="w-3 h-3" />
                            {terminating[f.sessionId] ? "…" : "Terminate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={fetchAbuse} disabled={abuseLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono text-muted-foreground hover:text-foreground border border-border hover:border-border/80 transition-colors disabled:opacity-40">
                <AlertTriangle className="w-3.5 h-3.5" />
                {abuseLoading ? "Scanning…" : "Refresh Scan"}
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
