import { useState, useEffect, useCallback, useMemo } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, RefreshCw, DollarSign, Clock, Coins, Calculator, Users, UserCog } from "lucide-react";

const API = (p: string) => `/api${p}`;
const token = () => localStorage.getItem("fullswap_admin_token") ?? localStorage.getItem("fullswap_token") ?? "";
const authH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token()}` });

type Tier = {
  id: number; minutes: number; credits: number;
  priceUsd: number; priceUsdt: number; priceGhs: number;
  label: string; planType: string; isActive: boolean;
};
type Rates = { usdtPerUsd: number; ghsPerUsd: number; creditsPerMinute: number };
type FormData = {
  label: string; minutes: string; priceUsd: string; planType: string; isActive: boolean;
};

const emptyForm: FormData = { label: "", minutes: "", priceUsd: "", planType: "topup", isActive: true };

// Decart fixed rates — 5 credits/sec = 300/min = 18000/hr → $0.01/credit → $180/hr
const CREDITS_PER_MINUTE = 300;
const DECART_COST_PER_CREDIT = 0.01; // USD per credit

function calcFromForm(form: FormData, rates: Rates) {
  const mins = parseInt(form.minutes) || 0;
  const usd = parseFloat(form.priceUsd) || 0;
  const credits = Math.round(mins * CREDITS_PER_MINUTE);
  return {
    credits,
    decartCostUsd: +(credits * DECART_COST_PER_CREDIT).toFixed(2),
    priceUsdt: +(usd * rates.usdtPerUsd).toFixed(2),
    priceGhs: +(usd * rates.ghsPerUsd).toFixed(2),
  };
}

function PricingSection({
  title, icon: Icon, color, tiers, rates, apiBase, onRefresh,
}: {
  title: string; icon: any; color: string; tiers: Tier[]; rates: Rates;
  apiBase: string; onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormData>(emptyForm);
    const [billingRate, setBillingRate] = useState(5);
    useEffect(() => {
      const t = token();
      fetch(API("/admin/billing-rate"), { headers: { Authorization: `Bearer ${t}` } })
        .then(r => r.ok ? r.json() : { rate: 5 })
        .then(d => setBillingRate(d.rate ?? 5))
        .catch(() => {});
    }, []);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [saving, setSaving] = useState(false);

  const calc = useMemo(() => calcFromForm(form, rates), [form, rates]);

  const openCreate = () => { setForm(emptyForm); setEditingId(null); setShowDialog(true); };
  const openEdit = (t: Tier) => {
    setForm({ label: t.label, minutes: String(t.minutes), priceUsd: String(t.priceUsd), planType: t.planType, isActive: t.isActive });
    setEditingId(t.id); setShowDialog(true);
  };

  const handleSave = async () => {
    if (!form.label.trim() || !form.minutes || !form.priceUsd) {
      toast({ title: "Missing fields", description: "Label, minutes, and USD price are required", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const body = {
        label: form.label.trim(), minutes: parseInt(form.minutes),
        credits: calc.credits, priceUsd: form.priceUsd,
        priceUsdt: String(calc.priceUsdt), priceGhs: String(calc.priceGhs),
        planType: form.planType, isActive: form.isActive,
      };
      const url = editingId ? API(`${apiBase}/${editingId}`) : API(apiBase);
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: authH(), body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast({ title: editingId ? "Package Updated" : "Package Created" });
      setShowDialog(false); onRefresh();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this pricing package?")) return;
    try {
      await fetch(API(`${apiBase}/${id}`), { method: "DELETE", headers: authH() });
      toast({ title: "Package Deleted" }); onRefresh();
    } catch { toast({ title: "Error", variant: "destructive" }); }
  };

  const handleToggle = async (t: Tier) => {
    await fetch(API(`${apiBase}/${t.id}`), {
      method: "PUT", headers: authH(),
      body: JSON.stringify({ isActive: !t.isActive }),
    });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Icon className="w-5 h-5" style={{ color }} />
          {title}
        </h2>
        <Button size="sm" onClick={openCreate} style={{ boxShadow: `0 0 12px ${color}40` }}>
          <Plus className="w-4 h-4 mr-1" /> Add Package
        </Button>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
        <Table>
          <TableHeader>
            <TableRow style={{ background: "hsl(222 44% 6%)" }}>
              <TableHead className="text-muted-foreground font-mono text-xs">Package</TableHead>
              <TableHead className="text-muted-foreground font-mono text-xs">Minutes</TableHead>
              <TableHead className="text-muted-foreground font-mono text-xs">Credits</TableHead>
              <TableHead className="text-muted-foreground font-mono text-xs">USD</TableHead>
              <TableHead className="text-muted-foreground font-mono text-xs">USDT</TableHead>
              <TableHead className="text-muted-foreground font-mono text-xs">GHS</TableHead>
              <TableHead className="text-muted-foreground font-mono text-xs">Active</TableHead>
              <TableHead className="text-muted-foreground font-mono text-xs text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tiers.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No packages yet. Click Add Package to create one.</TableCell></TableRow>
            ) : tiers.map(t => (
              <TableRow key={t.id} style={{ borderColor: "hsl(222 40% 11%)" }}>
                <TableCell className="font-semibold text-foreground">{t.label}</TableCell>
                <TableCell className="font-mono text-sm">{t.minutes}</TableCell>
                <TableCell className="font-mono text-sm text-primary">{t.credits}</TableCell>
                <TableCell className="font-mono text-sm">${t.priceUsd}</TableCell>
                <TableCell className="font-mono text-sm">{t.priceUsdt} USDT</TableCell>
                <TableCell className="font-mono text-sm">GHS {t.priceGhs}</TableCell>
                <TableCell><Switch checked={t.isActive} onCheckedChange={() => handleToggle(t)} /></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(t)} className="h-7 px-2"><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(t.id)} className="h-7 px-2 text-red-400 hover:text-red-300"><Trash2 className="w-3.5 h-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create/Edit Dialog with Live Calculator */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent style={{ background: "hsl(222 44% 6%)", border: `1px solid ${color}40`, maxWidth: 520 }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color }}>
              <Calculator className="w-5 h-5" />
              {editingId ? "Edit Package" : "Create Package"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Package Name</label>
              <Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Starter, Pro, Elite" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)" }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Minutes</label>
                <Input type="number" min="1" value={form.minutes} onChange={e => setForm(f => ({ ...f, minutes: e.target.value }))}
                  placeholder="60" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)" }} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Price (USD)</label>
                <Input type="number" min="0" step="0.01" value={form.priceUsd} onChange={e => setForm(f => ({ ...f, priceUsd: e.target.value }))}
                  placeholder="12.00" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)" }} />
              </div>
            </div>

            {/* Live Calculator Output */}
            <div className="rounded-lg p-3 space-y-2" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(187 100% 52% / 0.15)" }}>
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-2">Auto-Calculated ({billingRate} credits/sec · $0.01/credit · ${Math.round(billingRate * 36)}/hr)</p>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="text-center p-2 rounded" style={{ background: "hsl(187 100% 52% / 0.06)" }}>
                  <p className="text-lg font-bold text-primary font-mono">{calc.credits.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">Decart Credits</p>
                  <p className="text-[10px] text-muted-foreground">({CREDITS_PER_MINUTE} credits/min)</p>
                </div>
                <div className="text-center p-2 rounded" style={{ background: "hsl(0 84% 60% / 0.06)" }}>
                  <p className="text-lg font-bold text-red-400 font-mono">${calc.decartCostUsd}</p>
                  <p className="text-[10px] text-muted-foreground">Decart Cost (USD)</p>
                  <p className="text-[10px] text-muted-foreground">($0.01 per credit)</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center p-2 rounded" style={{ background: "hsl(187 100% 52% / 0.06)" }}>
                  <p className="text-lg font-bold text-foreground font-mono">{calc.priceUsdt}</p>
                  <p className="text-[10px] text-muted-foreground">Your Price (USDT)</p>
                </div>
                <div className="text-center p-2 rounded" style={{ background: "hsl(187 100% 52% / 0.06)" }}>
                  <p className="text-lg font-bold text-foreground font-mono">GHS {calc.priceGhs}</p>
                  <p className="text-[10px] text-muted-foreground">Your Price (GHS)</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Plan Type</label>
                <select value={form.planType} onChange={e => setForm(f => ({ ...f, planType: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)", color: "var(--foreground)" }}>
                  <option value="topup">Top-Up</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="flex items-end pb-1 gap-2">
                <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
                <span className="text-sm text-muted-foreground">{form.isActive ? "Active" : "Inactive"}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} style={{ boxShadow: `0 0 12px ${color}40` }}>
              {saving ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              {saving ? "Saving..." : editingId ? "Update Package" : "Create Package"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminPricingPage() {
  const { toast } = useToast();
  const [userTiers, setUserTiers] = useState<Tier[]>([]);
  const [subAdminTiers, setSubAdminTiers] = useState<Tier[]>([]);
  const [rates, setRates] = useState<Rates>({ usdtPerUsd: 1, ghsPerUsd: 15.3, creditsPerMinute: 1 });
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [userRes, subRes, ratesRes] = await Promise.all([
        fetch(API("/admin/pricing"), { headers: authH() }).then(r => r.json()),
        fetch(API("/admin/sub-admin-pricing"), { headers: authH() }).then(r => r.json()),
        fetch(API("/admin/exchange-rates"), { headers: authH() }).then(r => r.json()),
      ]);
      if (Array.isArray(userRes)) setUserTiers(userRes);
      if (Array.isArray(subRes)) setSubAdminTiers(subRes);
      if (ratesRes.usdtPerUsd) setRates(ratesRes);
    } catch {
      toast({ title: "Error loading pricing data", variant: "destructive" });
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-wide flex items-center gap-2">
              <DollarSign className="w-6 h-6 text-primary" />
              Pricing Dashboard
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Manage pricing for users and sub-admins. All conversions are automatic.
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <div className="text-xs text-muted-foreground font-mono px-3 py-1.5 rounded-lg" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 11%)" }}>
              1 USD = {rates.usdtPerUsd.toFixed(4)} USDT · {rates.ghsPerUsd.toFixed(2)} GHS
            </div>
            <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        {/* Section A: User Pricing */}
        <PricingSection
          title="User Pricing Packages"
          icon={Users}
          color="hsl(187, 100%, 52%)"
          tiers={userTiers}
          rates={rates}
          apiBase="/admin/pricing"
          onRefresh={fetchAll}
        />

        {/* Divider */}
        <div className="flex items-center gap-3 py-2">
          <div className="flex-1 h-px" style={{ background: "hsl(222 40% 14%)" }} />
          <span className="text-xs font-mono text-muted-foreground tracking-widest uppercase">Sub-Admin Pricing</span>
          <div className="flex-1 h-px" style={{ background: "hsl(222 40% 14%)" }} />
        </div>

        {/* Section B: Sub-Admin Pricing */}
        <PricingSection
          title="Sub-Admin Pricing Packages"
          icon={UserCog}
          color="hsl(262, 83%, 77%)"
          tiers={subAdminTiers}
          rates={rates}
          apiBase="/admin/sub-admin-pricing"
          onRefresh={fetchAll}
        />
      </div>
    </AdminLayout>
  );
}
