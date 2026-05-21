/**
 * profit-optimizer-panel.tsx — Profit Optimization Engine (POE) UI panel.
 *
 * SAFETY: Additive only. This component is a read-only analytics display.
 * It does NOT modify sessions, wallet, heartbeat, or billing logic.
 * It is advisory-mode by default — enforced mode toggle is UI-only state.
 * It fails gracefully — if backend is unavailable, renders nothing.
 *
 * Designed to be injected into existing admin billing pages without changing
 * their architecture, tabs, or routing.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  TrendingUp, Zap, ShieldCheck, AlertTriangle,
  RefreshCw, ChevronDown, ChevronUp, BarChart3,
  Target, Cpu, DollarSign, Activity,
} from "lucide-react";

const COST_RATE = 2.3;

const authH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token") ?? ""}`,
});

async function apiFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: authH() });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface PoeSummary {
  globalBillingRate: number;
  apiCostRate: number;
  totalKeys: number;
  activeKeys: number;
  liveSessions: number;
  totalUsedSec: number;
  avgSessionSec: number;
  systemPoe: {
    currentPacingFactor: number;
    recommendedPacingFactor: number;
    expectedProfitMarginPct: number;
    expectedDecartSavingsPct: number;
    riskScore: "Low" | "Medium" | "High";
    riskNote: string;
    recommendation: string;
  };
  currentDecartCostEstimate: number;
  optimalDecartCostEstimate: number;
  potentialCreditSavings: number;
  mode: string;
  computedAt: string;
}

interface PoeKey {
  licenseKeyId: number;
  licenseKey: string;
  isActive: boolean;
  effectiveRate: number;
  currentPacingFactor: number;
  recommendedPacingFactor: number;
  expectedProfitMarginPct: number;
  expectedDecartSavingsPct: number;
  riskScore: "Low" | "Medium" | "High";
  riskNote: string;
  recommendation: string;
  realDecartCostPerMin: number;
  projectedProfitPerSec: number;
  isHighUsage: boolean;
  activeSessions: number;
  totalUsedSec: number;
}

interface PoeRecommendations {
  keys: PoeKey[];
  globalBillingRate: number;
  apiCostRate: number;
  targetMarginRatio: number;
  mode: string;
  computedAt: string;
}

interface SimulateCurvePoint {
  pacingFactor: number;
  realCostCredits: number;
  revenueCredits: number;
  profitCredits: number;
  marginPct: number;
  decartSavingsPct: number;
}

interface SimulateResponse {
  billingRate: number;
  streamingSeconds: number;
  curve: SimulateCurvePoint[];
  apiCostRate: number;
  computedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function riskColor(score: "Low" | "Medium" | "High"): string {
  return score === "Low" ? "#26de81" : score === "Medium" ? "#fed330" : "#fc5c65";
}

function fmtKey(k: string): string {
  return k.length > 14 ? `${k.slice(0, 8)}…${k.slice(-4)}` : k;
}

function fmtSec(s: number): string {
  if (!s || s <= 0) return "0m";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Profit Curve Bar Chart ─────────────────────────────────────────────────────
function ProfitCurve({ curve, currentPacing }: { curve: SimulateCurvePoint[]; currentPacing: number }) {
  if (!curve.length) return null;
  const maxProfit = Math.max(...curve.map(c => Math.abs(c.profitCredits)));
  return (
    <div className="space-y-2">
      {curve.map(pt => {
        const isCurrent  = Math.abs(pt.pacingFactor - currentPacing) < 0.03;
        const barW       = maxProfit > 0 ? Math.min(100, Math.abs(pt.profitCredits) / maxProfit * 100) : 0;
        const barColor   = pt.profitCredits >= 0 ? "#26de81" : "#fc5c65";
        return (
          <div key={pt.pacingFactor} className="flex items-center gap-3">
            <span
              className="text-[10px] font-mono w-10 shrink-0 text-right"
              style={{ color: isCurrent ? "hsl(187 100% 52%)" : "hsl(215 20% 55%)" }}
            >
              {pt.pacingFactor.toFixed(2)}
              {isCurrent ? " ◀" : ""}
            </span>
            <div className="flex-1 h-4 rounded-sm overflow-hidden" style={{ background: "hsl(222 44% 4%)" }}>
              <div
                className="h-full rounded-sm transition-all duration-500"
                style={{ width: `${barW}%`, background: barColor, opacity: isCurrent ? 1 : 0.55 }}
              />
            </div>
            <span className="text-[10px] font-mono w-16 shrink-0" style={{ color: barColor }}>
              {pt.marginPct >= 0 ? "+" : ""}{pt.marginPct}%
            </span>
            <span className="text-[10px] font-mono w-14 shrink-0 text-muted-foreground">
              -{pt.decartSavingsPct}% cost
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
interface ProfitOptimizerPanelProps {
  /** Optional pre-fetched billing rate for simulation init */
  billingRate?: number;
  /** Whether to show the per-key table (heavy) */
  showKeyTable?: boolean;
  /** Whether to show the profit curve simulation */
  showCurve?: boolean;
  /** Stream seconds for simulation (default 3600) */
  simulationSec?: number;
}

export function ProfitOptimizerPanel({
  billingRate: propRate,
  showKeyTable = false,
  showCurve    = true,
  simulationSec = 3600,
}: ProfitOptimizerPanelProps) {
  const [expanded, setExpanded]   = useState(false);
  const [summary, setSummary]     = useState<PoeSummary | null>(null);
  const [keys, setKeys]           = useState<PoeKey[]>([]);
  const [curve, setCurve]         = useState<SimulateCurvePoint[]>([]);
  const [loading, setLoading]     = useState(true);
  const [keysLoading, setKeysLoading] = useState(false);
  const [enforced, setEnforced]   = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSummary = useCallback(async () => {
    const data = await apiFetch<PoeSummary>("/api/admin/profit-optimizer/summary");
    if (data) {
      setSummary(data);
      setLoading(false);
      // Fetch profit curve for current global rate
      const effectiveRate = propRate ?? data.globalBillingRate;
      const curveData = await apiFetch<SimulateResponse>(
        `/api/admin/profit-optimizer/simulate?rate=${effectiveRate}&streamingSec=${simulationSec}`
      );
      if (curveData) setCurve(curveData.curve);
    } else {
      setLoading(false);
    }
  }, [propRate, simulationSec]);

  const fetchKeys = useCallback(async () => {
    if (!showKeyTable) return;
    setKeysLoading(true);
    const data = await apiFetch<PoeRecommendations>("/api/admin/profit-optimizer/recommendations?limit=50");
    if (data) setKeys(data.keys);
    setKeysLoading(false);
  }, [showKeyTable]);

  useEffect(() => {
    fetchSummary();
    if (showKeyTable) fetchKeys();
    timerRef.current = setInterval(fetchSummary, 15000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchSummary, fetchKeys, showKeyTable]);

  // Silently succeed even if backend not up yet
  if (!loading && !summary) return null;

  const poe = summary?.systemPoe;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "hsl(222 44% 5%)", border: "1px solid hsl(266 100% 52% / 0.25)" }}
    >
      {/* ── Header (always visible) ── */}
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
            style={{ background: "hsl(266 100% 52% / 0.15)", border: "1px solid hsl(266 100% 52% / 0.3)" }}
          >
            <Target className="w-4 h-4" style={{ color: "hsl(266 100% 72%)" }} />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold font-mono text-foreground flex items-center gap-2">
              Profit Optimization Panel
              <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider"
                style={{ background: "hsl(266 100% 52% / 0.15)", color: "hsl(266 100% 72%)", border: "1px solid hsl(266 100% 52% / 0.3)" }}
              >
                {enforced ? "ENFORCED" : "ADVISORY"}
              </span>
              {poe && (
                <span
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider"
                  style={{ background: `${riskColor(poe.riskScore)}15`, color: riskColor(poe.riskScore), border: `1px solid ${riskColor(poe.riskScore)}35` }}
                >
                  {poe.riskScore} risk
                </span>
              )}
            </p>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
              {poe
                ? `Recommended pacing: ${poe.recommendedPacingFactor} · ${poe.expectedDecartSavingsPct}% Decart savings · ${poe.expectedProfitMarginPct}% margin`
                : "Loading recommendations…"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); fetchSummary(); if (showKeyTable) fetchKeys(); }}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {/* ── Expanded content ── */}
      {expanded && (
        <div className="border-t border-white/[0.06] p-4 space-y-5">

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
            </div>
          ) : summary && poe ? (
            <>
              {/* Mode toggle */}
              <div className="flex items-center justify-between rounded-lg p-3"
                style={{ background: "hsl(222 44% 7%)", border: "1px solid hsl(222 40% 14%)" }}>
                <div>
                  <p className="text-xs font-mono font-semibold text-foreground">Optimization Mode</p>
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {enforced
                      ? "ENFORCED — recommendations displayed for informational purposes. Manual rate changes required to apply."
                      : "ADVISORY — recommendations shown only. No automatic changes are made."}
                  </p>
                </div>
                <button
                  onClick={() => setEnforced(v => !v)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enforced ? "bg-purple-600" : "bg-slate-700"}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${enforced ? "translate-x-5" : "translate-x-1"}`} />
                </button>
              </div>

              {/* ── Summary cards ── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  {
                    label: "Current Pacing",
                    value: String(poe.currentPacingFactor),
                    sub: `at ${summary.globalBillingRate} cr/s billing rate`,
                    color: "hsl(187 100% 52%)",
                    icon: Activity,
                  },
                  {
                    label: "Recommended Pacing",
                    value: String(poe.recommendedPacingFactor),
                    sub: poe.recommendation.slice(0, 46) + "…",
                    color: "hsl(266 100% 72%)",
                    icon: Target,
                  },
                  {
                    label: "Expected Profit Margin",
                    value: `${poe.expectedProfitMarginPct}%`,
                    sub: "at recommended pacing",
                    color: poe.expectedProfitMarginPct >= 0 ? "#26de81" : "#fc5c65",
                    icon: DollarSign,
                  },
                  {
                    label: "Decart Cost Savings",
                    value: `${poe.expectedDecartSavingsPct}%`,
                    sub: `~${summary.potentialCreditSavings} cr potential total`,
                    color: "#26de81",
                    icon: Zap,
                  },
                ].map(card => (
                  <div key={card.label} className="rounded-xl p-4"
                    style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                    <div className="flex items-center gap-2 mb-2">
                      <card.icon className="w-3.5 h-3.5" style={{ color: card.color }} />
                      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{card.label}</p>
                    </div>
                    <p className="text-xl font-bold font-mono" style={{ color: card.color }}>{card.value}</p>
                    <p className="text-[10px] font-mono text-muted-foreground mt-1 leading-tight">{card.sub}</p>
                  </div>
                ))}
              </div>

              {/* ── Recommendation box ── */}
              <div className="rounded-lg p-4 flex items-start gap-3"
                style={{
                  background: `${riskColor(poe.riskScore)}08`,
                  border: `1px solid ${riskColor(poe.riskScore)}30`,
                }}>
                {poe.riskScore === "Low"
                  ? <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" style={{ color: riskColor(poe.riskScore) }} />
                  : poe.riskScore === "Medium"
                  ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: riskColor(poe.riskScore) }} />
                  : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: riskColor(poe.riskScore) }} />
                }
                <div>
                  <p className="text-xs font-mono font-bold" style={{ color: riskColor(poe.riskScore) }}>
                    {poe.riskScore.toUpperCase()} RISK — {poe.riskNote}
                  </p>
                  <p className="text-[11px] font-mono text-foreground mt-1">{poe.recommendation}</p>
                </div>
              </div>

              {/* ── Smart rules ── */}
              <div className="rounded-lg p-4 space-y-2"
                style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Smart Rule Engine</p>
                {[
                  {
                    condition: summary.globalBillingRate < COST_RATE,
                    active: summary.globalBillingRate < COST_RATE,
                    label: "Rate below cost → Reduce pacing to protect margin",
                    color: "#fc5c65",
                    icon: AlertTriangle,
                  },
                  {
                    condition: true,
                    active: summary.globalBillingRate > COST_RATE,
                    label: `Rate above cost (${summary.globalBillingRate} > 2.3) → Allow higher pacing for UX quality`,
                    color: "#26de81",
                    icon: ShieldCheck,
                  },
                  {
                    condition: true,
                    active: summary.liveSessions > 0,
                    label: `${summary.liveSessions} live session${summary.liveSessions !== 1 ? "s" : ""} → Aggressively reduce pacing on high-usage keys`,
                    color: "#fed330",
                    icon: Activity,
                  },
                  {
                    condition: true,
                    active: poe.recommendedPacingFactor < poe.currentPacingFactor,
                    label: `Pacing reduction available: ${poe.currentPacingFactor} → ${poe.recommendedPacingFactor} (saves ${poe.expectedDecartSavingsPct}% Decart cost)`,
                    color: "hsl(266 100% 72%)",
                    icon: TrendingUp,
                  },
                ].map((rule, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] font-mono"
                    style={{ opacity: rule.active ? 1 : 0.35 }}>
                    <rule.icon className="w-3 h-3 shrink-0" style={{ color: rule.active ? rule.color : "hsl(215 20% 45%)" }} />
                    <span style={{ color: rule.active ? rule.color : "hsl(215 20% 45%)" }}>{rule.label}</span>
                    {rule.active && <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded"
                      style={{ background: `${rule.color}15`, border: `1px solid ${rule.color}30`, color: rule.color }}>
                      ACTIVE
                    </span>}
                  </div>
                ))}
              </div>

              {/* ── Profit Curve ── */}
              {showCurve && curve.length > 0 && (
                <div className="rounded-xl p-4 space-y-3"
                  style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4" style={{ color: "hsl(266 100% 72%)" }} />
                      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        Profit Curve — pacing_factor vs margin (at {summary.globalBillingRate} cr/s)
                      </p>
                    </div>
                    <p className="text-[10px] font-mono text-muted-foreground">◀ current</p>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] font-mono mb-2">
                    <span className="text-muted-foreground">pacing_factor</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-green-400 opacity-60" /> margin %</span>
                    <span className="text-muted-foreground">Decart cost savings</span>
                  </div>
                  <ProfitCurve curve={curve} currentPacing={poe.currentPacingFactor} />
                </div>
              )}

              {/* ── Decart cost estimate ── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  {
                    label: "Current Decart Cost Est.",
                    value: `${summary.currentDecartCostEstimate} cr`,
                    sub:   "at current pacing across all keys",
                    color: "#fc5c65",
                    icon:  Cpu,
                  },
                  {
                    label: "Optimal Decart Cost Est.",
                    value: `${summary.optimalDecartCostEstimate} cr`,
                    sub:   "at recommended pacing",
                    color: "#26de81",
                    icon:  Cpu,
                  },
                  {
                    label: "Potential Credit Savings",
                    value: `${summary.potentialCreditSavings} cr`,
                    sub:   "if all keys adopt recommended pacing",
                    color: "hsl(266 100% 72%)",
                    icon:  DollarSign,
                  },
                ].map(card => (
                  <div key={card.label} className="rounded-xl p-4"
                    style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 14%)" }}>
                    <div className="flex items-center gap-2 mb-2">
                      <card.icon className="w-3.5 h-3.5" style={{ color: card.color }} />
                      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{card.label}</p>
                    </div>
                    <p className="text-xl font-bold font-mono" style={{ color: card.color }}>{card.value}</p>
                    <p className="text-[10px] font-mono text-muted-foreground mt-1">{card.sub}</p>
                  </div>
                ))}
              </div>

              {/* ── Per-key table ── */}
              {showKeyTable && (
                <div className="rounded-xl overflow-hidden"
                  style={{ border: "1px solid hsl(222 40% 14%)" }}>
                  <div className="flex items-center justify-between px-4 py-3"
                    style={{ background: "hsl(222 44% 7%)", borderBottom: "1px solid hsl(222 40% 12%)" }}>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Activity className="w-3.5 h-3.5" /> Per-Key Pacing Recommendations
                    </p>
                    {keysLoading && <div className="w-3.5 h-3.5 border border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr style={{ background: "hsl(222 44% 4%)", borderBottom: "1px solid hsl(222 40% 10%)" }}>
                          {["License Key", "Rate", "Current PF", "Rec. PF", "Margin%", "Decart Savings", "Risk", "Recommendation"].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-[9px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {keys.slice(0, 30).map(k => (
                          <tr key={k.licenseKeyId}
                            className="border-b hover:bg-white/[0.02] transition-colors"
                            style={{ borderColor: "hsl(222 40% 9%)" }}>
                            <td className="px-3 py-2.5 text-foreground whitespace-nowrap">
                              {fmtKey(k.licenseKey)}
                              {k.isHighUsage && <span className="ml-1 text-[9px] text-yellow-400">HI-USE</span>}
                              {k.activeSessions > 0 && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" />}
                            </td>
                            <td className="px-3 py-2.5 text-foreground">{k.effectiveRate} cr/s</td>
                            <td className="px-3 py-2.5" style={{ color: "hsl(187 100% 52%)" }}>{k.currentPacingFactor}</td>
                            <td className="px-3 py-2.5" style={{ color: "hsl(266 100% 72%)" }}>
                              {k.recommendedPacingFactor}
                              {k.recommendedPacingFactor < k.currentPacingFactor && (
                                <span className="text-green-400 ml-1">↓</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5" style={{ color: k.expectedProfitMarginPct >= 0 ? "#26de81" : "#fc5c65" }}>
                              {k.expectedProfitMarginPct}%
                            </td>
                            <td className="px-3 py-2.5 text-green-400">{k.expectedDecartSavingsPct}%</td>
                            <td className="px-3 py-2.5">
                              <span className="px-1.5 py-0.5 rounded text-[9px] uppercase"
                                style={{ background: `${riskColor(k.riskScore)}15`, color: riskColor(k.riskScore), border: `1px solid ${riskColor(k.riskScore)}30` }}>
                                {k.riskScore}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground max-w-[200px] truncate" title={k.recommendation}>
                              {k.recommendation}
                            </td>
                          </tr>
                        ))}
                        {keys.length === 0 && !keysLoading && (
                          <tr>
                            <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                              No license keys found
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Footer */}
              <p className="text-[10px] font-mono text-muted-foreground text-right">
                POE advisory · computed {summary.computedAt ? new Date(summary.computedAt).toLocaleTimeString() : "—"} · auto-refreshes 15s
              </p>
            </>
          ) : (
            <div className="py-8 text-center text-muted-foreground text-sm font-mono">
              Profit Optimizer backend not available
            </div>
          )}
        </div>
      )}
    </div>
  );
}
