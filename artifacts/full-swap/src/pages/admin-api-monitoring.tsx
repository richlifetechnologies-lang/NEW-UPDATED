import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Activity, Users, Clock, Zap, ChevronDown, ChevronRight, Key } from "lucide-react";

function M0() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("fullswap_admin_token")}` };
}

interface LicenseKeyRow {
  id: number; key: string;
  totalSecondsUsed: number; totalMinutesUsed: number;
}
interface KeyStats { assignedLicenseKeys: number; totalSecondsUsed: number; totalMinutesUsed: number; }
interface ApiKey {
  id: number; label: string; isActive: boolean; maxLicenseKeys: number | null; createdAt: string;
  stats: KeyStats; licenses: LicenseKeyRow[];
}
interface MonitoringData {
  keys: ApiKey[];
  unassigned: { stats: { licenseKeyCount: number; totalSecondsUsed: number; totalMinutesUsed: number; }; licenses: LicenseKeyRow[] };
  totals: { totalKeys: number; activeKeys: number; totalLicenseKeys: number; totalSecondsUsed: number; totalMinutesUsed: number; };
}

function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background">
    <div className="max-w-7xl mx-auto p-4 md:p-6">{children}</div>
  </div>;
}

function fmt(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60); const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function KeyCard({ apiKey, isExpanded, onToggle }: { apiKey: ApiKey; isExpanded: boolean; onToggle: () => void }) {
  const s = apiKey.stats;
  return <div className="bg-card border border-border rounded-lg overflow-hidden">
    <button onClick={onToggle} className="w-full p-4 flex items-center justify-between hover:bg-accent/5 transition-colors cursor-pointer">
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${apiKey.isActive ? "bg-green-500" : "bg-red-500"}`} />
        <div className="text-left">
          <h3 className="font-semibold text-foreground">{apiKey.label}</h3>
          <p className="text-xs text-muted-foreground">{apiKey.isActive ? "Active" : "Inactive"} \u00b7 Created {new Date(apiKey.createdAt).toLocaleDateString()}</p>
        </div>
      </div>
      <div className="flex items-center gap-6 text-sm">
        <div className="text-center"><div className="font-bold text-foreground">{s.assignedLicenseKeys}</div><div className="text-xs text-muted-foreground">License Keys</div></div>
        <div className="text-center"><div className="font-bold text-foreground">{fmt(s.totalSecondsUsed)}</div><div className="text-xs text-muted-foreground">Used</div></div>
        {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </div>
    </button>
    {isExpanded && apiKey.licenses.length > 0 && <div className="border-t border-border">
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-muted-foreground border-b border-border">
          <th className="p-3 text-left">License Key</th>
          <th className="p-3 text-right">Time Used</th>
        </tr></thead>
        <tbody>{apiKey.licenses.map(l => <tr key={l.id} className="border-b border-border last:border-0 hover:bg-accent/5">
          <td className="p-3 font-mono text-foreground text-xs">{l.key}</td>
          <td className="p-3 text-right font-mono text-foreground">{fmt(l.totalSecondsUsed)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {isExpanded && apiKey.licenses.length === 0 && <div className="border-t border-border p-6 text-center text-muted-foreground text-sm">No license keys assigned to this API key</div>}
  </div>;
}

export default function AdminApiMonitoringPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number | string>>(new Set());

  useEffect(() => { if (!localStorage.getItem("fullswap_admin_token")) navigate("/admin"); }, [navigate]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/api-monitoring", { headers: M0() });
      if (r.ok) setData(await r.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);

  const toggle = (id: number | string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const t = data?.totals;

  return <AdminLayout>
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-foreground">API Key Monitoring</h1>
        <p className="text-muted-foreground mt-1">Real-time streaming consumption per licence key</p></div>

      {t && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-lg p-4"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Key className="w-3.5 h-3.5" />API Keys</div><div className="text-2xl font-bold text-foreground">{t.activeKeys}<span className="text-sm text-muted-foreground font-normal">/{t.totalKeys}</span></div></div>
        <div className="bg-card border border-border rounded-lg p-4"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Users className="w-3.5 h-3.5" />License Keys</div><div className="text-2xl font-bold text-foreground">{t.totalLicenseKeys}</div></div>
        <div className="bg-card border border-border rounded-lg p-4"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Clock className="w-3.5 h-3.5" />Total Consumed</div><div className="text-2xl font-bold text-foreground">{fmt(t.totalSecondsUsed)}</div></div>
      </div>}

      {loading && <div className="text-center py-12 text-muted-foreground">Loading monitoring data...</div>}

      {data && data.keys.length > 0 && <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><Activity className="w-5 h-5" />API Keys ({data.keys.length})</h2>
        {data.keys.map(k => <KeyCard key={k.id} apiKey={k} isExpanded={expanded.has(k.id)} onToggle={() => toggle(k.id)} />)}
      </div>}

      {data && data.keys.length === 0 && !loading && <div className="bg-card border border-border rounded-lg p-8 text-center">
        <Key className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No API keys configured yet. Add keys in the <a href="/admin/decart-keys" className="text-primary underline">API Keys</a> page first.</p>
      </div>}

      {data && data.unassigned.licenses.length > 0 && <div className="space-y-3">
        <button onClick={() => toggle("unassigned")} className="flex items-center gap-2 text-lg font-semibold text-foreground cursor-pointer hover:text-muted-foreground transition-colors">
          <Users className="w-5 h-5" />Unassigned License Keys ({data.unassigned.stats.licenseKeyCount})
          {expanded.has("unassigned") ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {expanded.has("unassigned") && <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground border-b border-border">
              <th className="p-3 text-left">License Key</th>
              <th className="p-3 text-right">Time Used</th>
            </tr></thead>
            <tbody>{data.unassigned.licenses.map(l => <tr key={l.id} className="border-b border-border last:border-0 hover:bg-accent/5">
              <td className="p-3 font-mono text-foreground text-xs">{l.key}</td>
              <td className="p-3 text-right font-mono text-foreground">{fmt(l.totalSecondsUsed)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </div>}
    </div>
  </AdminLayout>;
}
