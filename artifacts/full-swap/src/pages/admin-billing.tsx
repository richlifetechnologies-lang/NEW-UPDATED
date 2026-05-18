import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Zap, RefreshCw, TrendingUp, Clock, DollarSign, AlertTriangle } from "lucide-react";

const API   = (p: string) => `/api${p}`;
const token = () => localStorage.getItem("fullswap_admin_token") ?? localStorage.getItem("fullswap_token") ?? "";
const authH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token()}` });

const PRESETS = [
  { label: "2 cr/s",  value: 2,  badge: "original",  desc: "$0.02/s · $72/hr"  },
  { label: "3 cr/s",  value: 3,  badge: "",           desc: "$0.03/s · $108/hr" },
  { label: "4 cr/s",  value: 4,  badge: "",           desc: "$0.04/s · $144/hr" },
  { label: "5 cr/s",  value: 5,  badge: "default",    desc: "$0.05/s · $180/hr" },
  { label: "8 cr/s",  value: 8,  badge: "",           desc: "$0.08/s · $288/hr" },
  { label: "10 cr/s", value: 10, badge: "",           desc: "$0.10/s · $360/hr" },
];

function calcImpact(rate: number) {
  const perSec              = rate * 0.01;
  const perHr               = perSec * 3600;
  const drainFactor         = rate / 2;
  const realMinsPerAllocHr  = 60 / drainFactor;
  return { perSec, perHr, drainFactor, realMinsPerAllocHr };
}

export default function AdminBillingPage() {
  const { toast } = useToast();
  const [currentRate, setCurrentRate]   = useState<number | null>(null);
  const [inputRate,   setInputRate]     = useState("");
  const [saving,      setSaving]        = useState(false);
  const [loading,     setLoading]       = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res  = await fetch(API("/admin/billing-rate"), { headers: authH() });
      const data = await res.json();
      setCurrentRate(data.rate);
      setInputRate(String(data.rate));
    } catch {
      toast({ title: "Failed to load billing rate", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    const rate = parseInt(inputRate, 10);
    if (!Number.isFinite(rate) || rate < 1 || rate > 100) {
      toast({ title: "Invalid rate", description: "Enter a whole number from 1 to 100", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(API("/admin/billing-rate"), {
        method: "PUT",
        headers: authH(),
        body: JSON.stringify({ rate }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      setCurrentRate(rate);
      toast({ title: "Billing rate updated", description: `Active rate is now ${rate} credits/sec` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const preview = parseInt(inputRate, 10) || currentRate || 5;
  const impact  = calcImpact(preview);
  const dirty   = currentRate !== null && parseInt(inputRate, 10) !== currentRate;

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-2xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              Billing Rate
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Controls how fast licence keys deplete while streaming is active
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Active rate banner */}
        <div className="rounded-xl border border-yellow-700/40 bg-yellow-950/20 p-5 flex items-center gap-5">
          <div className="text-5xl font-black text-yellow-400 font-mono leading-none">
            {loading ? "—" : currentRate}
          </div>
          <div className="space-y-0.5">
            <div className="text-sm font-semibold text-yellow-300">credits / second — active rate</div>
            {currentRate !== null && (
              <>
                <div className="text-xs text-slate-400">
                  ${(currentRate * 0.01).toFixed(2)}/sec &nbsp;·&nbsp;
                  ${(currentRate * 0.01 * 3600).toFixed(0)}/hr &nbsp;·&nbsp;
                  {(currentRate / 2).toFixed(1)}× faster than real-time
                </div>
                <div className="text-xs text-slate-500">
                  A 60-min licence gives {(60 / (currentRate / 2)).toFixed(1)} min of real streaming
                </div>
              </>
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-200">Set New Rate</h2>

          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => {
              const selected = parseInt(inputRate, 10) === p.value;
              return (
                <button
                  key={p.value}
                  onClick={() => setInputRate(String(p.value))}
                  className={`relative px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                    selected
                      ? "bg-yellow-600/30 border-yellow-500 text-yellow-200"
                      : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                  }`}
                >
                  <span className="font-bold text-sm">{p.value}</span>
                  <span className="ml-1 opacity-80">{p.label.split(" ")[1]}</span>
                  <div className="text-[10px] opacity-60 mt-0.5">{p.desc}</div>
                  {p.badge && (
                    <span className={`absolute -top-1.5 -right-1.5 text-[9px] font-bold px-1 rounded-full ${
                      p.badge === "default" ? "bg-yellow-600 text-white" : "bg-slate-600 text-slate-200"
                    }`}>
                      {p.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Custom input */}
          <div className="flex items-center gap-3 pt-1">
            <Input
              type="number"
              min={1}
              max={100}
              value={inputRate}
              onChange={e => setInputRate(e.target.value)}
              placeholder="custom…"
              className="w-28 h-9 text-sm font-mono"
            />
            <span className="text-sm text-slate-500">credits / sec</span>
            <Button
              size="sm"
              onClick={save}
              disabled={saving || loading || !dirty}
              className="ml-auto"
            >
              {saving ? "Saving…" : dirty ? "Save Rate" : "Saved"}
            </Button>
          </div>

          {parseInt(inputRate, 10) < 2 && inputRate !== "" && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-950/30 border border-amber-800/40 rounded-lg p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Rates below 2 approach original speed. Licence keys will deplete very slowly.
            </div>
          )}
          {parseInt(inputRate, 10) > 20 && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/30 border border-red-800/40 rounded-lg p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Very high rates will exhaust licence keys extremely quickly. Confirm before saving.
            </div>
          )}
        </div>

        {/* Impact preview */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-slate-400" />
            Impact Preview
            <span className="text-xs font-normal text-slate-500 ml-1">@ {preview} cr/s</span>
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-800/60 rounded-lg px-3 py-2.5">
              <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1">
                <DollarSign className="w-3 h-3" /> Cost per second
              </div>
              <div className="text-xl font-bold text-slate-100">${impact.perSec.toFixed(2)}</div>
            </div>
            <div className="bg-slate-800/60 rounded-lg px-3 py-2.5">
              <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1">
                <DollarSign className="w-3 h-3" /> Cost per hour
              </div>
              <div className="text-xl font-bold text-slate-100">${impact.perHr.toFixed(0)}</div>
            </div>
            <div className="bg-slate-800/60 rounded-lg px-3 py-2.5">
              <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1">
                <Zap className="w-3 h-3" /> Drain speed
              </div>
              <div className="text-xl font-bold text-yellow-400">{impact.drainFactor.toFixed(1)}×</div>
              <div className="text-xs text-slate-600">faster than real-time</div>
            </div>
            <div className="bg-slate-800/60 rounded-lg px-3 py-2.5">
              <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1">
                <Clock className="w-3 h-3" /> 60-min key gives
              </div>
              <div className="text-xl font-bold text-slate-100">{impact.realMinsPerAllocHr.toFixed(1)} min</div>
              <div className="text-xs text-slate-600">of real streaming</div>
            </div>
          </div>
          <p className="text-xs text-slate-600 pt-1">
            Formula: licence drain = wall-clock seconds × rate ÷ 2 (baseline).
            The rate is cached for 60 s server-side; changes take effect within the next heartbeat cycle.
          </p>
        </div>

      </div>
    </AdminLayout>
  );
}
