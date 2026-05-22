/**
 * admin-ai-copilot.tsx — AI Billing Copilot admin page.
 *
 * SAFETY: Read-only. Never modifies billing, wallet, session, or Decart state.
 * Degrades gracefully — all other admin pages unaffected if AI is unavailable.
 */

import { useState, useCallback } from "react";
import { AdminLayout } from "@/components/admin-layout";
import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Ghost,
  Loader2,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Skull,
  Sparkles,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";

// ── API ───────────────────────────────────────────────────────────────────────
const API_BASE = "/api/admin/session-intelligence";
const authH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token") ?? ""}`,
});

async function postAiExplain(sessionId: string, question?: string) {
  try {
    const res = await fetch(`${API_BASE}/ai-explain`, {
      method: "POST",
      headers: authH(),
      body: JSON.stringify({ sessionId, question: question || undefined }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface AiCopilotResult {
  sessionId: string;
  summary: string;
  billingFlow: string[];
  terminationReason: "normal_stop" | "wallet_exhausted" | "orphan_kill" | "freeze_kill";
  anomalies: string[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  recommendations: string[];
}

// ── Termination reason config ─────────────────────────────────────────────────
const TERMINATION_CONFIG = {
  normal_stop:       { label: "Normal Stop",        icon: CheckCircle2, color: "text-green-400",  bg: "bg-green-500/10 border-green-700/40" },
  wallet_exhausted:  { label: "Wallet Exhausted",   icon: Zap,          color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-700/40" },
  orphan_kill:       { label: "Orphan Kill",         icon: Ghost,        color: "text-red-400",    bg: "bg-red-500/10 border-red-700/40" },
  freeze_kill:       { label: "Freeze Kill",         icon: Skull,        color: "text-red-500",    bg: "bg-red-600/10 border-red-700/40" },
} as const;

// ── Risk level config ─────────────────────────────────────────────────────────
const RISK_CONFIG = {
  LOW:    { label: "LOW RISK",    icon: ShieldCheck, color: "text-green-400",  bg: "bg-green-500/10 border-green-700/40",  bar: "bg-green-500",  width: "w-1/4" },
  MEDIUM: { label: "MEDIUM RISK", icon: Shield,      color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-700/40", bar: "bg-yellow-500", width: "w-2/4" },
  HIGH:   { label: "HIGH RISK",   icon: ShieldAlert, color: "text-red-400",    bg: "bg-red-500/10 border-red-700/40",  bar: "bg-red-500",    width: "w-full" },
} as const;

const EXAMPLE_QUESTIONS = [
  "Why was this session charged?",
  "Was anything abnormal about the billing?",
  "Why did the session stop?",
  "Did this session have any token reuse issues?",
  "Is there any billing integrity risk?",
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function AdminAiCopilotPage() {
  const [sessionIdInput, setSessionIdInput] = useState("");
  const [questionInput, setQuestionInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiCopilotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flowExpanded, setFlowExpanded] = useState(true);
  const [anomalyExpanded, setAnomalyExpanded] = useState(true);
  const [recExpanded, setRecExpanded] = useState(true);

  const runAnalysis = useCallback(async (question?: string) => {
    const sid = sessionIdInput.trim();
    if (!sid) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setFlowExpanded(true);
    setAnomalyExpanded(true);
    setRecExpanded(true);

    const data = await postAiExplain(sid, question ?? questionInput);
    setLoading(false);

    if (!data) {
      setError("Failed to reach the AI Copilot endpoint. Check admin authentication and server status.");
      return;
    }
    setResult(data as AiCopilotResult);
  }, [sessionIdInput, questionInput]);

  const termCfg = result ? TERMINATION_CONFIG[result.terminationReason] ?? TERMINATION_CONFIG.normal_stop : null;
  const riskCfg = result ? RISK_CONFIG[result.riskLevel] ?? RISK_CONFIG.LOW : null;

  return (
    <AdminLayout>
      <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 border border-violet-500/30 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">AI Billing Copilot</h1>
            <p className="text-xs text-muted-foreground">
              Forensic billing intelligence — read-only, never modifies data
            </p>
          </div>
        </div>

        {/* ── Input Card ── */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Bot className="w-4 h-4 text-violet-400" /> Analyze a Session
          </h2>

          {/* Session ID input */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Session ID</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                placeholder="550e8400-e29b-41d4-a716-446655440000"
                value={sessionIdInput}
                onChange={e => setSessionIdInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !loading && runAnalysis()}
              />
            </div>
          </div>

          {/* Optional question */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              Optional question <span className="opacity-60">(leave blank for full analysis)</span>
            </label>
            <input
              className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
              placeholder="e.g. Why was this session charged more than expected?"
              value={questionInput}
              onChange={e => setQuestionInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !loading && runAnalysis()}
              disabled={loading}
            />
          </div>

          {/* Quick prompt chips */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Quick questions:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_QUESTIONS.map(q => (
                <button
                  key={q}
                  disabled={loading || !sessionIdInput.trim()}
                  onClick={() => { setQuestionInput(q); runAnalysis(q); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-border bg-muted hover:bg-violet-500/10 hover:border-violet-500/40 hover:text-violet-300 text-muted-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Analyze button */}
          <button
            onClick={() => runAnalysis()}
            disabled={loading || !sessionIdInput.trim()}
            className="w-full py-2.5 text-sm font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing billing events…</>
              : <><Sparkles className="w-4 h-4" /> Run AI Analysis</>
            }
          </button>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-sm text-destructive">
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {/* ── Results ── */}
        {result && (
          <div className="space-y-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">

            {/* Summary hero card */}
            <div className="bg-gradient-to-br from-violet-500/10 to-purple-600/5 border border-violet-500/20 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-4 h-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-foreground">AI Summary</h3>
                <span className="ml-auto text-xs text-muted-foreground font-mono">
                  {result.sessionId.slice(0, 8)}…
                </span>
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed">{result.summary}</p>
            </div>

            {/* Termination + Risk row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Termination reason */}
              {termCfg && (
                <div className={`rounded-xl border p-4 ${termCfg.bg}`}>
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> Termination Reason
                  </p>
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center ${termCfg.bg}`}>
                      <termCfg.icon className={`w-4 h-4 ${termCfg.color}`} />
                    </div>
                    <div>
                      <p className={`text-base font-bold ${termCfg.color}`}>{termCfg.label}</p>
                      <p className="text-xs text-muted-foreground font-mono">{result.terminationReason}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Risk score */}
              {riskCfg && (
                <div className={`rounded-xl border p-4 ${riskCfg.bg}`}>
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" /> Billing Risk Score
                  </p>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center ${riskCfg.bg}`}>
                      <riskCfg.icon className={`w-4 h-4 ${riskCfg.color}`} />
                    </div>
                    <p className={`text-base font-bold ${riskCfg.color}`}>{riskCfg.label}</p>
                  </div>
                  <div className="w-full h-1.5 bg-muted/50 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${riskCfg.bar} ${riskCfg.width}`} />
                  </div>
                </div>
              )}
            </div>

            {/* Billing Flow */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setFlowExpanded(v => !v)}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/30 transition-colors"
              >
                <TrendingUp className="w-4 h-4 text-green-400" />
                Billing Flow
                <span className="ml-auto text-xs text-muted-foreground font-normal">
                  {result.billingFlow.length} steps
                </span>
                {flowExpanded
                  ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                }
              </button>
              {flowExpanded && (
                <div className="px-4 pb-4 space-y-2 border-t border-border">
                  {result.billingFlow.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-3 text-center">No billing steps recorded.</p>
                  ) : (
                    <ol className="space-y-2 pt-3">
                      {result.billingFlow.map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="shrink-0 w-6 h-6 rounded-full bg-green-500/15 border border-green-700/30 flex items-center justify-center text-xs font-bold text-green-400">
                            {i + 1}
                          </span>
                          <p className="text-sm text-foreground/80 pt-0.5 leading-relaxed">{step}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>

            {/* Anomaly Flags */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setAnomalyExpanded(v => !v)}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/30 transition-colors"
              >
                <AlertTriangle className={`w-4 h-4 ${result.anomalies.length > 0 ? "text-yellow-400" : "text-muted-foreground"}`} />
                Anomaly Flags
                <span className={`ml-1 text-xs px-2 py-0.5 rounded-full font-semibold ${result.anomalies.length > 0 ? "bg-yellow-500/15 text-yellow-400" : "bg-muted text-muted-foreground"}`}>
                  {result.anomalies.length}
                </span>
                <span className="ml-auto">
                  {anomalyExpanded
                    ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  }
                </span>
              </button>
              {anomalyExpanded && (
                <div className="px-4 pb-4 border-t border-border">
                  {result.anomalies.length === 0 ? (
                    <div className="flex items-center gap-2 py-3 text-sm text-green-400">
                      <CheckCircle2 className="w-4 h-4" /> No anomalies detected — billing appears normal.
                    </div>
                  ) : (
                    <ul className="space-y-2 pt-3">
                      {result.anomalies.map((a, i) => (
                        <li key={i} className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/5 border border-yellow-700/20">
                          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                          <p className="text-sm text-yellow-300/90 leading-relaxed">{a}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Recommendations */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setRecExpanded(v => !v)}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/30 transition-colors"
              >
                <ShieldCheck className="w-4 h-4 text-blue-400" />
                Admin Recommendations
                <span className="ml-auto text-xs text-muted-foreground font-normal mr-1">
                  {result.recommendations.length} items
                </span>
                {recExpanded
                  ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                }
              </button>
              {recExpanded && (
                <div className="px-4 pb-4 border-t border-border">
                  {result.recommendations.length === 0 ? (
                    <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                      <CheckCircle2 className="w-4 h-4 text-green-400" /> No admin action required.
                    </div>
                  ) : (
                    <ul className="space-y-2 pt-3">
                      {result.recommendations.map((r, i) => (
                        <li key={i} className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-700/20">
                          <Shield className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                          <p className="text-sm text-blue-300/90 leading-relaxed">{r}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Safety notice */}
            <p className="text-xs text-muted-foreground/60 text-center">
              AI analysis is read-only. No billing data was modified. All explanations are logged for audit.
            </p>
          </div>
        )}

        {/* ── Empty state ── */}
        {!result && !loading && !error && (
          <div className="text-center py-16 space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto">
              <Brain className="w-7 h-7 text-violet-400 opacity-60" />
            </div>
            <p className="text-sm text-muted-foreground">Enter a Session ID to run forensic billing analysis.</p>
            <p className="text-xs text-muted-foreground/60">
              The AI will reconstruct the full session timeline and explain billing behavior.
            </p>
          </div>
        )}

      </div>
    </AdminLayout>
  );
}
