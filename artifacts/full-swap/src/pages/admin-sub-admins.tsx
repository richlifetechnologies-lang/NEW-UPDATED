import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getAdminToken } from "@/lib/auth";
import {
  UserCog, Plus, Trash2, Ban, CheckCircle, Coins, Eye, EyeOff,
  RefreshCw, Activity, LogIn, Key, Zap, RotateCcw, ChevronDown,
  Shield, Radio, BarChart3, Settings2,
} from "lucide-react";

const API = (path: string) => `/api${path}`;
const H = () => ({ "Content-Type": "application/json", "Authorization": `Bearer ${getAdminToken() ?? ""}` });

type SubAdmin = {
  id: number; email: string; username: string; membership: string;
  subAdminMinutesBalance: number; createdAt: string;
  assignedDecartKeyId: number | null; assignedKeyLabel: string | null;
  billingRate: number | null;
};
type AuditRow = {
  id: number; subAdminId: number; subAdminEmail?: string; subAdminUsername?: string;
  action: string; targetUserId?: number; minutesAmount?: number; note?: string;
  performedBy?: number; createdAt: string;
};
type LicKey = {
  id: number; key: string; isActive: boolean; activatedAt: string | null;
  createdAt: string; minutesAllocated: number; minutesConsumed: number;
  notes: string | null; minutesCredited: boolean;
  assignedDecartKeyId: number | null; decartKeyLabel: string | null;
  customBillingRate: number | null; useCustomBillingRate: boolean;
  subAdminUsername: string; subAdminEmail: string;
};
type DecartKey = { id: number; label: string; isActive: boolean };

const TABS = ["accounts", "keys", "audit", "create"] as const;
type Tab = typeof TABS[number];

const TAB_LABELS: Record<Tab, string> = {
  accounts: "Accounts", keys: "Keys", audit: "Audit Log", create: "Create New",
};

const ACTION_ICON: Record<string, React.ReactElement> = {
  login: <LogIn className="w-3 h-3" />,
  credit_user: <Coins className="w-3 h-3" />,
  minutes_allocated: <Activity className="w-3 h-3" />,
  minutes_recalled: <RotateCcw className="w-3 h-3" />,
  suspended: <Ban className="w-3 h-3" />,
  deleted: <Trash2 className="w-3 h-3" />,
  created: <Plus className="w-3 h-3" />,
  generate_license_key: <Key className="w-3 h-3" />,
  api_key_assigned: <Radio className="w-3 h-3" />,
  billing_rate_set: <Zap className="w-3 h-3" />,
};
const ACTION_COLOR: Record<string, string> = {
  login: "text-blue-400", credit_user: "text-green-400",
  minutes_allocated: "text-cyan-400", minutes_recalled: "text-orange-400",
  suspended: "text-red-400", deleted: "text-red-500", created: "text-emerald-400",
  generate_license_key: "text-purple-400", api_key_assigned: "text-yellow-400",
  billing_rate_set: "text-pink-400",
};

export default function AdminSubAdminsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [subs, setSubs] = useState<SubAdmin[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [licKeys, setLicKeys] = useState<LicKey[]>([]);
  const [decartKeys, setDecartKeys] = useState<DecartKey[]>([]);
  const [tab, setTab] = useState<Tab>("accounts");
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({ email: "", username: "", password: "" });
  const [showPwd, setShowPwd] = useState(false);

  const [minuteInputs, setMinuteInputs] = useState<Record<number, string>>({});
  const [recallInputs, setRecallInputs] = useState<Record<number, string>>({});
  const [rateInputs, setRateInputs] = useState<Record<number, string>>({});
  const [keySelects, setKeySelects] = useState<Record<number, string>>({});
  const [expandedSub, setExpandedSub] = useState<number | null>(null);

  const [keyFilter, setKeyFilter] = useState("");

  useEffect(() => {
    if (!getAdminToken()) { setLocation("/admin"); return; }
    fetchAll();
  }, []);

  async function fetchAll() {
    fetchSubs(); fetchAudit(); fetchLicKeys(); fetchDecartKeys();
  }
  async function fetchSubs() {
    const r = await fetch(API("/admin/sub-admins"), { headers: H() });
    if (r.ok) {
      const data: SubAdmin[] = await r.json();
      setSubs(data);
      const ks: Record<number, string> = {};
      const rs: Record<number, string> = {};
      data.forEach(s => {
        ks[s.id] = String(s.assignedDecartKeyId ?? "");
        rs[s.id] = s.billingRate != null ? String(s.billingRate) : "";
      });
      setKeySelects(ks);
      setRateInputs(rs);
    }
  }
  async function fetchAudit() {
    const r = await fetch(API("/admin/sub-admin-audit"), { headers: H() });
    if (r.ok) setAudit(await r.json());
  }
  async function fetchLicKeys() {
    const r = await fetch(API("/admin/sub-admins/all-license-keys"), { headers: H() });
    if (r.ok) setLicKeys(await r.json());
  }
  async function fetchDecartKeys() {
    const r = await fetch(API("/admin/decart-keys"), { headers: H() });
    if (r.ok) {
      const data = await r.json();
      setDecartKeys(Array.isArray(data) ? data : (data.keys ?? []));
    }
  }

  async function createSubAdmin() {
    if (!form.email || !form.username || form.password.length < 8) {
      toast({ title: "Validation error", description: "All fields required, password min 8 chars", variant: "destructive" }); return;
    }
    setLoading(true);
    const r = await fetch(API("/admin/sub-admins"), { method: "POST", headers: H(), body: JSON.stringify(form) });
    setLoading(false);
    if (r.ok) {
      toast({ title: "Sub admin created" });
      setForm({ email: "", username: "", password: "" });
      setTab("accounts"); fetchSubs(); fetchAudit();
    } else {
      const d = await r.json();
      toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  }

  async function allocateMinutes(id: number) {
    const mins = parseInt(minuteInputs[id] ?? "0");
    if (!mins || mins < 1) { toast({ title: "Enter valid minutes", variant: "destructive" }); return; }
    const r = await fetch(API(`/admin/sub-admins/${id}/minutes`), { method: "PUT", headers: H(), body: JSON.stringify({ minutes: mins }) });
    if (r.ok) {
      toast({ title: `${mins} min allocated` });
      setMinuteInputs(p => ({ ...p, [id]: "" }));
      fetchSubs(); fetchAudit();
    } else {
      const d = await r.json(); toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  }

  async function recallMinutes(id: number, clearAll: boolean) {
    const amount = clearAll ? undefined : parseInt(recallInputs[id] ?? "0");
    if (!clearAll && (!amount || amount < 1)) { toast({ title: "Enter amount to recall", variant: "destructive" }); return; }
    if (!confirm(clearAll ? "Clear ALL minutes for this sub admin?" : `Recall ${amount} minutes?`)) return;
    const r = await fetch(API(`/admin/sub-admins/${id}/recall`), {
      method: "PUT", headers: H(),
      body: JSON.stringify(clearAll ? {} : { amount }),
    });
    if (r.ok) {
      toast({ title: clearAll ? "Balance cleared" : `${amount} min recalled` });
      setRecallInputs(p => ({ ...p, [id]: "" }));
      fetchSubs(); fetchAudit();
    } else {
      const d = await r.json(); toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  }

  async function assignKey(id: number) {
    const val = keySelects[id];
    const decartKeyId = val ? parseInt(val) : null;
    const r = await fetch(API(`/admin/sub-admins/${id}/assign-key`), {
      method: "PUT", headers: H(), body: JSON.stringify({ decartKeyId }),
    });
    if (r.ok) {
      toast({ title: decartKeyId ? "API key assigned" : "API key cleared" });
      fetchSubs(); fetchAudit();
    } else {
      const d = await r.json(); toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  }

  async function setBillingRate(id: number) {
    const val = rateInputs[id];
    const rate = val ? parseFloat(val) : null;
    if (val && (isNaN(rate!) || rate! <= 0)) { toast({ title: "Enter a valid rate > 0", variant: "destructive" }); return; }
    const r = await fetch(API(`/admin/sub-admins/${id}/billing-rate`), {
      method: "PUT", headers: H(), body: JSON.stringify({ rate }),
    });
    if (r.ok) {
      toast({ title: rate ? `Rate set to ${rate} cr/s` : "Rate cleared (uses global)" });
      fetchSubs(); fetchAudit();
    } else {
      const d = await r.json(); toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  }

  async function suspendSub(id: number) {
    const r = await fetch(API(`/admin/sub-admins/${id}/suspend`), { method: "POST", headers: H() });
    if (r.ok) { toast({ title: "Sub admin suspended" }); fetchSubs(); fetchAudit(); }
  }
  async function activateSub(id: number) {
    const r = await fetch(API(`/admin/sub-admins/${id}/activate`), { method: "POST", headers: H() });
    if (r.ok) { toast({ title: "Sub admin activated" }); fetchSubs(); }
  }
  async function revokeSub(id: number) {
    if (!confirm("Revoke this sub admin? They will no longer be able to log in.")) return;
    const r = await fetch(API(`/admin/sub-admins/${id}`), { method: "DELETE", headers: H() });
    if (r.ok) { toast({ title: "Sub admin revoked" }); fetchSubs(); fetchAudit(); }
  }

  const card = "bg-card border border-border rounded-xl p-5";
  const th = "text-left text-xs font-bold text-muted-foreground uppercase tracking-widest py-2 px-3 whitespace-nowrap";
  const td = "py-2.5 px-3 text-sm border-t border-border";
  const inp = "h-9 rounded-lg border border-border bg-background text-sm px-3 text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  const filteredKeys = keyFilter
    ? licKeys.filter(k =>
        k.key.toLowerCase().includes(keyFilter.toLowerCase()) ||
        k.subAdminUsername.toLowerCase().includes(keyFilter.toLowerCase())
      )
    : licKeys;

  return (
    <AdminLayout>
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <UserCog className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Sub Admin Management</h1>
            <p className="text-xs text-muted-foreground">Accounts · Key issuance · Billing rates · Audit trail</p>
          </div>
          <Button size="sm" variant="outline" className="ml-auto gap-2" onClick={fetchAll}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Sub Admins", value: subs.length, icon: <UserCog className="w-4 h-4" />, color: "text-primary" },
            { label: "Active", value: subs.filter(s => s.membership === "active").length, icon: <CheckCircle className="w-4 h-4" />, color: "text-green-400" },
            { label: "Keys Issued", value: licKeys.length, icon: <Key className="w-4 h-4" />, color: "text-purple-400" },
            { label: "Min Distributed", value: licKeys.reduce((a, k) => a + (k.minutesAllocated ?? 0), 0), icon: <BarChart3 className="w-4 h-4" />, color: "text-cyan-400" },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
              <div className={`${s.color} opacity-80`}>{s.icon}</div>
              <div>
                <p className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-card border border-border rounded-lg p-1 w-fit flex-wrap">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "accounts" ? `Accounts (${subs.length})` : t === "keys" ? `Keys (${licKeys.length})` : t === "audit" ? `Audit (${audit.length})` : "Create New"}
            </button>
          ))}
        </div>

        {/* ── ACCOUNTS TAB ── */}
        {tab === "accounts" && (
          <div className="space-y-4">
            {subs.length === 0 ? (
              <div className={`${card} text-center py-12`}>
                <UserCog className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No sub admins yet.</p>
                <Button size="sm" className="mt-4 gap-2" onClick={() => setTab("create")}><Plus className="w-3.5 h-3.5" /> Create Sub Admin</Button>
              </div>
            ) : subs.map(sub => (
              <div key={sub.id} className={`${card} space-y-0`}>
                {/* Row header */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-foreground">{sub.username}</p>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${sub.membership === "active" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                        {sub.membership}
                      </span>
                      {sub.assignedKeyLabel && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 gap-1 flex items-center">
                          <Radio className="w-2.5 h-2.5" /> {sub.assignedKeyLabel}
                        </span>
                      )}
                      {sub.billingRate && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-400 border border-pink-500/20">
                          {sub.billingRate} cr/s
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{sub.email}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-xl font-bold font-mono text-primary">{sub.subAdminMinutesBalance}</p>
                      <p className="text-[10px] text-muted-foreground">min balance</p>
                    </div>

                    {/* Suspend / Activate / Revoke */}
                    {sub.membership === "active"
                      ? <Button size="sm" variant="ghost" title="Suspend" className="h-8 px-2 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10" onClick={() => suspendSub(sub.id)}><Ban className="w-4 h-4" /></Button>
                      : <Button size="sm" variant="ghost" title="Activate" className="h-8 px-2 text-green-400 hover:text-green-300 hover:bg-green-500/10" onClick={() => activateSub(sub.id)}><CheckCircle className="w-4 h-4" /></Button>
                    }
                    <Button size="sm" variant="ghost" title="Revoke account" className="h-8 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => revokeSub(sub.id)}><Trash2 className="w-4 h-4" /></Button>

                    <button onClick={() => setExpandedSub(expandedSub === sub.id ? null : sub.id)}
                      className="h-8 w-8 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground transition-all">
                      <ChevronDown className={`w-4 h-4 transition-transform ${expandedSub === sub.id ? "rotate-180" : ""}`} />
                    </button>
                  </div>
                </div>

                {/* Expanded controls */}
                {expandedSub === sub.id && (
                  <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 sm:grid-cols-3 gap-4">

                    {/* GROUP 1: Allocate minutes */}
                    <div className="bg-background/60 rounded-lg p-3 border border-border space-y-2">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                        <Coins className="w-3 h-3" /> Allocate Minutes
                      </p>
                      <div className="flex gap-2">
                        <input type="number" min={1} placeholder="mins" value={minuteInputs[sub.id] ?? ""}
                          onChange={e => setMinuteInputs(p => ({ ...p, [sub.id]: e.target.value }))}
                          className={`${inp} w-20`} />
                        <Button size="sm" className="gap-1 flex-1" onClick={() => allocateMinutes(sub.id)}>
                          <Plus className="w-3 h-3" /> Add
                        </Button>
                      </div>
                    </div>

                    {/* GROUP 2: Recall minutes */}
                    <div className="bg-background/60 rounded-lg p-3 border border-border space-y-2">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                        <RotateCcw className="w-3 h-3 text-orange-400" /> Recall Minutes
                      </p>
                      <div className="flex gap-2">
                        <input type="number" min={1} placeholder="or leave blank" value={recallInputs[sub.id] ?? ""}
                          onChange={e => setRecallInputs(p => ({ ...p, [sub.id]: e.target.value }))}
                          className={`${inp} w-28`} />
                        <Button size="sm" variant="outline" className="gap-1 text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
                          onClick={() => recallMinutes(sub.id, false)}>Reduce</Button>
                        <Button size="sm" variant="outline" className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                          onClick={() => recallMinutes(sub.id, true)}>Clear All</Button>
                      </div>
                    </div>

                    {/* GROUP 3: Assign API key + Set billing rate */}
                    <div className="bg-background/60 rounded-lg p-3 border border-border space-y-3">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                        <Settings2 className="w-3 h-3 text-yellow-400" /> Key Settings
                      </p>
                      {/* Assign Decart key */}
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Decart API Key (for generated license keys)</p>
                        <div className="flex gap-2">
                          <select
                            value={keySelects[sub.id] ?? ""}
                            onChange={e => setKeySelects(p => ({ ...p, [sub.id]: e.target.value }))}
                            className={`${inp} flex-1 bg-background`}>
                            <option value="">— None (auto-assign) —</option>
                            {decartKeys.filter(k => k.isActive).map(k => (
                              <option key={k.id} value={String(k.id)}>{k.label}</option>
                            ))}
                          </select>
                          <Button size="sm" variant="outline" className="text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10"
                            onClick={() => assignKey(sub.id)}>Set</Button>
                        </div>
                      </div>
                      {/* Billing rate */}
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Billing Rate cr/s (leave blank = global rate)</p>
                        <div className="flex gap-2">
                          <input type="number" step="0.1" min={0.1} placeholder="e.g. 2.3"
                            value={rateInputs[sub.id] ?? ""}
                            onChange={e => setRateInputs(p => ({ ...p, [sub.id]: e.target.value }))}
                            className={`${inp} flex-1`} />
                          <Button size="sm" variant="outline" className="text-pink-400 border-pink-500/30 hover:bg-pink-500/10"
                            onClick={() => setBillingRate(sub.id)}>Set</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── KEYS TAB ── */}
        {tab === "keys" && (
          <div className={card}>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <h2 className="text-base font-bold text-foreground flex-1">License Keys by Sub Admins</h2>
              <input placeholder="Filter by key or sub admin…" value={keyFilter}
                onChange={e => setKeyFilter(e.target.value)}
                className={`${inp} w-56`} />
              <span className="text-xs text-muted-foreground">{filteredKeys.length} keys</span>
            </div>
            {filteredKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No license keys generated by sub admins yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Key</th>
                      <th className={th}>Sub Admin</th>
                      <th className={th}>Status</th>
                      <th className={th}>Allocated</th>
                      <th className={th}>Consumed</th>
                      <th className={th}>Usage %</th>
                      <th className={th}>API Key</th>
                      <th className={th}>Rate</th>
                      <th className={th}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredKeys.map(k => {
                      const pct = k.minutesAllocated > 0 ? Math.min(100, Math.round((k.minutesConsumed / k.minutesAllocated) * 100)) : 0;
                      const pctColor = pct >= 90 ? "bg-red-500" : pct >= 60 ? "bg-yellow-500" : "bg-green-500";
                      return (
                        <tr key={k.id} className="hover:bg-background/40 transition-colors">
                          <td className={td}>
                            <code className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">{k.key}</code>
                            {k.notes && <p className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[140px]">{k.notes}</p>}
                          </td>
                          <td className={td}>
                            <p className="font-medium text-foreground">{k.subAdminUsername}</p>
                            <p className="text-[10px] text-muted-foreground">{k.subAdminEmail}</p>
                          </td>
                          <td className={td}>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${k.isActive ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                              {k.isActive ? (k.activatedAt ? "Active" : "Unused") : "Inactive"}
                            </span>
                          </td>
                          <td className={td}>
                            <span className="font-mono text-foreground">{k.minutesAllocated}</span>
                            <span className="text-muted-foreground text-xs ml-1">min</span>
                          </td>
                          <td className={td}>
                            <span className={`font-mono font-bold ${k.minutesConsumed > 0 ? "text-orange-400" : "text-muted-foreground"}`}>{k.minutesConsumed}</span>
                            <span className="text-muted-foreground text-xs ml-1">min</span>
                          </td>
                          <td className={td}>
                            <div className="flex items-center gap-2 min-w-[70px]">
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className={`h-full ${pctColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                            </div>
                          </td>
                          <td className={td}>
                            {k.decartKeyLabel
                              ? <span className="text-xs text-yellow-400 font-mono">{k.decartKeyLabel}</span>
                              : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className={td}>
                            {k.useCustomBillingRate && k.customBillingRate
                              ? <span className="text-xs text-pink-400 font-mono">{k.customBillingRate} cr/s</span>
                              : <span className="text-xs text-muted-foreground">global</span>}
                          </td>
                          <td className={td}>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(k.createdAt).toLocaleDateString()}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── AUDIT TAB ── */}
        {tab === "audit" && (
          <div className={card}>
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-base font-bold text-foreground flex-1">Activity Audit Feed</h2>
              <span className="text-xs text-muted-foreground">{audit.length} entries</span>
            </div>
            {audit.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No activity recorded yet.</p>
            ) : (
              <div className="space-y-2 max-h-[680px] overflow-y-auto pr-1">
                {audit.map(row => (
                  <div key={row.id} className="flex items-start gap-3 p-3 rounded-lg bg-background/60 border border-border">
                    <div className={`mt-0.5 ${ACTION_COLOR[row.action] ?? "text-muted-foreground"}`}>
                      {ACTION_ICON[row.action] ?? <Activity className="w-3 h-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-foreground">{row.subAdminUsername ?? `ID:${row.subAdminId}`}</span>
                        <span className={`text-xs font-mono px-1.5 py-0.5 rounded bg-muted ${ACTION_COLOR[row.action] ?? "text-muted-foreground"}`}>
                          {row.action.replace(/_/g, " ")}
                        </span>
                        {row.minutesAmount != null && (
                          <span className="text-xs text-primary font-bold">{row.minutesAmount} min</span>
                        )}
                      </div>
                      {row.note && <p className="text-xs text-muted-foreground mt-0.5 truncate">{row.note}</p>}
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── CREATE TAB ── */}
        {tab === "create" && (
          <div className={`${card} max-w-md`}>
            <h2 className="text-base font-bold text-foreground mb-1 flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" /> Create Sub Admin Account
            </h2>
            <p className="text-xs text-muted-foreground mb-4">Sub admins can generate license keys from their allocated minutes balance.</p>
            <div className="space-y-3">
              {([
                { label: "Email Address", key: "email" as const, type: "email", placeholder: "subadmin@example.com" },
                { label: "Username", key: "username" as const, type: "text", placeholder: "reseller_name" },
              ] as const).map(f => (
                <div key={f.key}>
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder} value={form[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className={`${inp} w-full`} />
                </div>
              ))}
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">Password</label>
                <div className="relative">
                  <input type={showPwd ? "text" : "password"} placeholder="Min 8 characters" value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    className={`${inp} w-full pr-10`} />
                  <button type="button" onClick={() => setShowPwd(v => !v)}
                    className="absolute right-3 top-2 text-muted-foreground hover:text-foreground">
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button className="w-full gap-2 mt-2" disabled={loading} onClick={createSubAdmin}>
                <Plus className="w-4 h-4" />
                {loading ? "Creating..." : "Create Sub Admin"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
