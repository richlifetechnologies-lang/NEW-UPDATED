/**
 * admin-session-intelligence.tsx — Session Intelligence admin page.
 *
 * SAFETY: Additive only. Read-only backend. Does not modify billing, wallet, or session state.
 * Fails gracefully — all existing admin pages continue to function if this endpoint is unavailable.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { AdminLayout } from "@/components/admin-layout";
import {
  Activity,
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Ghost,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  Skull,
  Zap,
} from "lucide-react";

// ── API helpers ───────────────────────────────────────────────────────────────
const API_BASE = "/api/admin/session-intelligence";
const authH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token") ?? ""}`,
});

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...opts, headers: { ...authH(), ...(opts?.headers ?? {}) } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface TimelineEvent {
  type: string;
  timestamp: string;
  walletRemainingSeconds: number | null;
  metadata: Record<string, unknown> | null;
}

interface RiskFlags {
  orphanRisk: boolean;
  billingFreezeRisk: boolean;
  tokenReuseRisk: boolean;
}

interface SessionIntelligence {
  sessionId: string;
  decartSessionId: string | null;
  status: string;
  walletRemainingSeconds: number | null;
  totalEvents: number;
  eventTimeline: TimelineEvent[];
  riskFlags: RiskFlags;
}

interface AiExplanation {
  explanation: string;
  structuredSummary: {
    billingFlow: string[];
    anomalies: string[];
    riskAnalysis: string[];
    conclusion: string;
  };
  dataSourcesUsed: string[];
}

// ── Event type styling ────────────────────────────────────────────────────────
const EVENT_STYLES: Record<string, { label: string; color: string; icon: string }> = {
  token_issued:         { label: "Token Issued",      color: "text-blue-400 bg-blue-900/30 border-blue-700/40",    icon: "🔑" },
  token_cache_hit:      { label: "Token Cache Hit",   color: "text-cyan-400 bg-cyan-900/30 border-cyan-700/40",    icon: "⚡" },
  token_cache_miss:     { label: "Token Cache Miss",  color: "text-yellow-400 bg-yellow-900/30 border-yellow-700/40", icon: "⚠️" },
  connect:              { label: "Connected",         color: "text-green-400 bg-green-900/30 border-green-700/40",  icon: "🔗" },
  stream_start:         { label: "Stream Start",      color: "text-emerald-400 bg-emerald-900/30 border-emerald-700/40", icon: "▶️" },
  heartbeat_ok:         { label: "Heartbeat OK",      color: "text-green-400 bg-green-900/20 border-green-800/30",  icon: "💚" },
  heartbeat_exhausted:  { label: "Heartbeat Exhausted", color: "text-red-400 bg-red-900/30 border-red-700/40",    icon: "💔" },
  disconnect:           { label: "Disconnected",      color: "text-orange-400 bg-orange-900/30 border-orange-700/40", icon: "🔌" },
  stop:                 { label: "Stopped",           color: "text-slate-400 bg-slate-800/40 border-slate-700/40",  icon: "⏹️" },
  orphan_kill:          { label: "Orphan Kill",       color: "text-red-500 bg-red-950/40 border-red-700/50",        icon: "💀" },
  freeze_kill:          { label: "Freeze Kill",       color: "text-red-400 bg-red-900/30 border-red-700/40",        icon: "🧊" },
  ai_explanation_generated: { label: "AI Explanation", color: "text-purple-400 bg-purple-900/30 border-purple-700/40", icon: "🤖" },
};

function fmtTs(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ts; }
}

function fmtDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return ""; }
}

const EXAMPLE_PROMPTS = [
  "Why was this session charged?",
  "Did this session leak credits?",
  "Why did it stop?",
  "Explain token reuse behavior",
];

// ── Main Component ────────────────────────────────────────────────────────────
export default function AdminSessionIntelligencePage() {
  const [sessionIdInput, setSessionIdInput] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [data, setData] = useState<SessionIntelligence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedMeta, setExpandedMeta] = useState<Set<number>>(new Set());
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiExplanation | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [newEventIds, setNewEventIds] = useState<Set<number>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const prevEventCountRef = useRef(0);

  // ── Load session intelligence ─────────────────────────────────────────────
  const loadSession = useCallback(async (sid: string) => {
    if (!sid.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    setAiResult(null);
    setAiError(null);
    setExpandedMeta(new Set());
    prevEventCountRef.current = 0;

    const result = await apiFetch<SessionIntelligence>(`${API_BASE}?sessionId=${encodeURIComponent(sid.trim())}`);
    setLoading(false);
    if (!result) {
      setError("Failed to load session data. Check the session ID or admin token.");
      return;
    }
    setData(result);
    setActiveSessionId(sid.trim());
    prevEventCountRef.current = result.eventTimeline.length;
  }, []);

  // ── Refresh ───────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!activeSessionId) return;
    const result = await apiFetch<SessionIntelligence>(`${API_BASE}?sessionId=${encodeURIComponent(activeSessionId)}`);
    if (!result) return;

    const newCount = result.eventTimeline.length;
    const oldCount = prevEventCountRef.current;
    if (newCount > oldCount) {
      const newIds = new Set<number>();
      for (let i = oldCount; i < newCount; i++) newIds.add(i);
      setNewEventIds(newIds);
      setTimeout(() => setNewEventIds(new Set()), 3000);
    }
    prevEventCountRef.current = newCount;
    setData(result);
  }, [activeSessionId]);

  // ── WebSocket subscription ────────────────────────────────────────────────
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}/api/admin/billing-intelligence/ws`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (
            msg.type === "session_billing_event_created" &&
            activeSessionId &&
            msg.payload?.sessionId === activeSessionId
          ) {
            refresh();
          }
        } catch { /* non-fatal */ }
      };

      ws.onerror = () => { /* non-fatal — polling still works */ };
    } catch { /* non-fatal */ }

    return () => {
      try { ws?.close(); } catch { /* non-fatal */ }
    };
  }, [activeSessionId, refresh]);

  // ── AI Copilot ────────────────────────────────────────────────────────────
  const askAI = useCallback(async (question?: string) => {
    if (!activeSessionId) return;
    const q = question ?? aiQuestion;
    setAiLoading(true);
    setAiResult(null);
    setAiError(null);

    const result = await apiFetch<AiExplanation>(`${API_BASE}/ai-explain`, {
      method: "POST",
      body: JSON.stringify({ sessionId: activeSessionId, question: q || undefined }),
    });

    setAiLoading(false);
    if (!result) {
      setAiError("AI explanation unavailable. Check that OPENAI_API_KEY is configured.");
      return;
    }
    setAiResult(result);
  }, [activeSessionId, aiQuestion]);

  // ── Copy session ID ───────────────────────────────────────────────────────
  const copyId = (id: string) => {
    navigator.clipboard.writeText(id).catch(() => {});
  };

  // ── Risk badge ────────────────────────────────────────────────────────────
  function RiskBadge({ active, label, icon: Icon, description }: {
    active: boolean; label: string; icon: React.ComponentType<any>; description: string;
  }) {
    return (
      <div className={`flex items-start gap-3 p-3 rounded-lg border ${active ? "border-red-700/50 bg-red-950/30" : "border-border bg-card"}`}>
        <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${active ? "bg-red-500/20" : "bg-muted"}`}>
          <Icon className={`w-3.5 h-3.5 ${active ? "text-red-400" : "text-muted-foreground"}`} />
        </div>
        <div>
          <p className={`text-sm font-medium ${active ? "text-red-300" : "text-muted-foreground"}`}>{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          <span className={`mt-1 inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${active ? "bg-red-500/20 text-red-400" : "bg-muted text-muted-foreground"}`}>
            {active ? "RISK DETECTED" : "CLEAR"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <AdminLayout>
      <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Brain className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Session Intelligence</h1>
              <p className="text-xs text-muted-foreground">Full billing traceability per session — read only</p>
            </div>
          </div>
          {data && (
            <button
              onClick={refresh}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          )}
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Enter Session ID (e.g. 550e8400-e29b-41d4-a716-446655440000)"
              value={sessionIdInput}
              onChange={e => setSessionIdInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && loadSession(sessionIdInput)}
            />
          </div>
          <button
            onClick={() => loadSession(sessionIdInput)}
            disabled={loading || !sessionIdInput.trim()}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Load
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 rounded-lg bg-muted/50 animate-pulse" />
            ))}
          </div>
        )}

        {/* Data */}
        {data && (
          <div className="space-y-5">

            {/* Session Summary Card */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" /> Session Summary
                </h2>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
                  data.status === "active"
                    ? "bg-green-500/15 text-green-400 border-green-700/40"
                    : "bg-muted text-muted-foreground border-border"
                }`}>
                  {data.status.toUpperCase()}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Session ID</p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-mono text-foreground truncate max-w-[90px]">{data.sessionId}</p>
                    <button onClick={() => copyId(data.sessionId)} className="text-muted-foreground hover:text-foreground">
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Decart Session ID</p>
                  <p className="text-xs font-mono text-foreground truncate">{data.decartSessionId ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Wallet Remaining</p>
                  <p className="text-sm font-bold text-foreground">
                    {data.walletRemainingSeconds != null ? `${data.walletRemainingSeconds}s` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Total Events</p>
                  <p className="text-sm font-bold text-foreground">{data.totalEvents}</p>
                </div>
              </div>
            </div>

            {/* Risk Panel */}
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-primary" /> Risk Panel
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <RiskBadge
                  active={data.riskFlags.orphanRisk}
                  label="Orphan Risk"
                  icon={Ghost}
                  description="No heartbeat for >90s (orphan threshold is 120s)"
                />
                <RiskBadge
                  active={data.riskFlags.billingFreezeRisk}
                  label="Billing Freeze Risk"
                  icon={Skull}
                  description="No deduction for >30s (freeze threshold is 45s)"
                />
                <RiskBadge
                  active={data.riskFlags.tokenReuseRisk}
                  label="Token Reuse Risk"
                  icon={Zap}
                  description="Token was reused from cache without a fresh issue"
                />
              </div>
            </div>

            {/* Event Timeline */}
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-primary" /> Event Timeline
                <span className="ml-auto text-xs text-muted-foreground font-normal">{data.eventTimeline.length} events</span>
              </h2>

              {data.eventTimeline.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No events recorded yet. Events appear as the session progresses.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[480px] overflow-y-auto pr-1">
                  {data.eventTimeline.map((evt, i) => {
                    const style = EVENT_STYLES[evt.type] ?? { label: evt.type, color: "text-muted-foreground bg-muted border-border", icon: "•" };
                    const isNew = newEventIds.has(i);
                    const isExpanded = expandedMeta.has(i);
                    const hasMetadata = evt.metadata && Object.keys(evt.metadata).length > 0;

                    return (
                      <div
                        key={i}
                        className={`rounded-lg border px-3 py-2 transition-all duration-500 ${style.color} ${isNew ? "ring-1 ring-primary/50 scale-[1.01]" : ""}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base leading-none shrink-0">{style.icon}</span>
                          <span className="text-xs font-semibold flex-1">{style.label}</span>
                          <span className="text-xs opacity-60">{fmtDate(evt.timestamp)} {fmtTs(evt.timestamp)}</span>
                          {evt.walletRemainingSeconds != null && (
                            <span className="text-xs opacity-70 font-mono shrink-0">
                              {evt.walletRemainingSeconds}s left
                            </span>
                          )}
                          {hasMetadata && (
                            <button
                              onClick={() => {
                                const next = new Set(expandedMeta);
                                if (isExpanded) next.delete(i); else next.add(i);
                                setExpandedMeta(next);
                              }}
                              className="opacity-60 hover:opacity-100 transition-opacity ml-1"
                            >
                              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                        {isExpanded && hasMetadata && (
                          <pre className="mt-2 text-xs bg-black/20 rounded p-2 overflow-x-auto opacity-80 font-mono">
                            {JSON.stringify(evt.metadata, null, 2)}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* AI Billing Copilot */}
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
                <Bot className="w-4 h-4 text-primary" /> AI Billing Copilot
                <span className="ml-1 text-xs text-muted-foreground font-normal">(read-only — never modifies billing)</span>
              </h2>

              {/* Example prompts */}
              <div className="flex flex-wrap gap-2 mb-3">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => { setAiQuestion(p); askAI(p); }}
                    disabled={aiLoading}
                    className="text-xs px-2.5 py-1 rounded-full border border-border bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    {p}
                  </button>
                ))}
              </div>

              {/* Custom question */}
              <div className="flex gap-2 mb-4">
                <input
                  className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Ask about this session…"
                  value={aiQuestion}
                  onChange={e => setAiQuestion(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !aiLoading && askAI()}
                  disabled={aiLoading}
                />
                <button
                  onClick={() => askAI()}
                  disabled={aiLoading}
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                  Ask
                </button>
              </div>

              {/* Loading */}
              {aiLoading && (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/30 border border-border">
                  <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                  <p className="text-sm text-muted-foreground">Analyzing session billing events…</p>
                </div>
              )}

              {/* Error */}
              {aiError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {aiError}
                </div>
              )}

              {/* AI Result */}
              {aiResult && (
                <div className="space-y-4 animate-in fade-in-0 duration-300">
                  {/* Explanation */}
                  <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                    <p className="text-sm font-medium text-foreground mb-1 flex items-center gap-1.5">
                      <Brain className="w-3.5 h-3.5 text-primary" /> Explanation
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{aiResult.explanation}</p>
                  </div>

                  {/* Billing Flow */}
                  {aiResult.structuredSummary.billingFlow.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-green-400" /> Billing Flow
                      </p>
                      <ol className="space-y-1.5">
                        {aiResult.structuredSummary.billingFlow.map((step, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i + 1}</span>
                            {step}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Anomalies */}
                  {aiResult.structuredSummary.anomalies.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" /> Anomalies Detected
                      </p>
                      <ul className="space-y-1.5">
                        {aiResult.structuredSummary.anomalies.map((a, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-yellow-400">
                            <span className="mt-1 w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Risk Analysis */}
                  {aiResult.structuredSummary.riskAnalysis.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-orange-400" /> Risk Analysis
                      </p>
                      <ul className="space-y-1.5">
                        {aiResult.structuredSummary.riskAnalysis.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-orange-300">
                            <span className="mt-1 w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Conclusion */}
                  <div className="p-3 rounded-lg bg-muted/30 border border-border flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-foreground font-medium">{aiResult.structuredSummary.conclusion}</p>
                  </div>

                  {/* Data sources */}
                  <p className="text-xs text-muted-foreground">
                    Sources: {aiResult.dataSourcesUsed.join(", ")}
                  </p>
                </div>
              )}

              {/* Empty state */}
              {!aiLoading && !aiResult && !aiError && (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  Ask a question about this session to get an AI-powered billing explanation.
                  The AI only reads event logs — it never modifies any data.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Welcome state */}
        {!data && !loading && !error && (
          <div className="text-center py-12 text-muted-foreground space-y-2">
            <Brain className="w-10 h-10 mx-auto opacity-30" />
            <p className="text-sm">Enter a Session ID above to load its billing intelligence report.</p>
            <p className="text-xs opacity-60">Includes full event timeline, risk flags, and AI copilot.</p>
          </div>
        )}

      </div>
    </AdminLayout>
  );
}
