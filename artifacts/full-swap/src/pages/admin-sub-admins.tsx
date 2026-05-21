import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getAdminToken } from "@/lib/auth";
import {
  UserCog, Plus, Trash2, Ban, CheckCircle, Coins, Eye, EyeOff,
  RefreshCw, Activity, LogIn, Key, Zap, RotateCcw, ChevronDown, ChevronRight,
  Shield, Radio, BarChart3, Settings2, TrendingUp, AlertTriangle,
  CheckCircle2, XCircle, Loader2,
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
  usedMinutes: number; unusedMinutes: number; burnRate: number;
  notes: string | null; minutesCredited: boolean;
  assignedDecartKeyId: number | null; decartKeyLabel: string | null;
  customBillingRate: number | null; useCustomBillingRate: boolean;
  createdBySubAdminId: number | null;
  subAdminUsername: string; subAdminEmail: string;
};
type DecartKey = { id: number; label: string; isActive: boolean };

const TABS = ["accounts", "breakdown", "keys", "audit", "create"] as const;
type Tab = typeof TABS[number];

const TAB_LABELS: Record<Tab, string> = {
  accounts: "Accounts", breakdown: "Breakdown", keys: "All Keys", audit: "Audit Log", create: "Create New",
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
  const [emailCheck, setEmailCheck] = useState<null | "checking" | "available" | "taken" | "error">(null);

  const [minuteInputs, setMinuteInputs] = useState<Record<number, string>>({});
  const [recallInputs, setRecallInputs] = useState<Record<number, string>>({});
  const [rateInputs, setRateInputs] = useState<Record<number, string>>({});
  const [keySelects, setKeySelects] = useState<Record<number, string>>({});
  const [expandedSub, setExpandedSub] = useState<number | null>(null);

  const [keyFilter, setKeyFilter] = useState("");
  const [topUpInputs, setTopUpInputs] = useState<Record<number, string>>({});
  const [expandedBreakdown, setExpandedBreakdown] = useState<number | null>(null);

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

  async function checkEmail() {
    const email = form.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      toast({ title: "Enter a valid email first", variant: "destructive" }); return;
    }
    setEmailCheck("checking");
    try {
      const r = await fetch(API(`/admin/sub-admins/check-email?email=${encodeURIComponent(email)}`), { headers: H() });
      if (r.ok) {
        const d = await r.json();
        setEmailCheck(d.available ? "available" : "taken");
      } else {
        setEmailCheck("error");
      }
    } catch {
      setEmailCheck("error");
    }
  }

  async function createSubAdmin() {
    if (!form.email || !form.username || !form.password || form.password.length < 8) {
      toast({ title: "Validation error", description: "All fields required, password min 8 chars", variant: "destructive" }); return;
    }
    if (emailCheck === "taken") {
      toast({ title: "Email already in use", description: "This email is already registered in the system and cannot be reused.", variant: "destructive" }); return;
    }
    setLoading(true);
    try {
      const r = await fetch(API("/admin/sub-admins"), { method: "POST", headers: H(), body: JSON.stringify(form) });
      if (r.ok) {
        toast({ title: "Sub admin created", description: `Account created for ${form.email}` });
        setForm({ email: "", username: "", password: "" });
        setEmailCheck(null);
        setTab("accounts"); fetchSubs(); fetchAudit();
      } else {
        let msg = "Failed to create sub admin";
        try { const d = await r.json(); msg = d.error ?? msg; } catch { /* non-JSON response */ }
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the server. Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
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

  async function revokeLicenseKey(key: string) {
    if (!confirm(`Revoke licence key ${key}?\n\nThis will disable the key — the holder will lose access immediately.\nYou can re-activate it later if needed.`)) return;
    const r = await fetch(API(`/license/${key}/revoke`), { method: "DELETE", headers: H() });
    if (r.ok) {
      toast({ title: "Key revoked", description: `${key} has been disabled` });
      fetchLicKeys();
    } else {
      const d = await r.json().catch(() => ({}));
      toast({ title: "Error revoking key", description: (d as any).error ?? "Server error", variant: "destructive" });
    }
  }

  async function reactivateLicenseKey(key: string) {
    if (!confirm(`Re-activate licence key ${key}?\n\nThe holder will regain access immediately.`)) return;
    const r = await fetch(API(`/license/${key}`), {
      method: "PUT",
      headers: H(),
      body: JSON.stringify({ isActive: true }),
    });
    if (r.ok) {
      toast({ title: "Key re-activated", description: `${key} is now active again` });
      fetchLicKeys();
    } else {
      const d = await r.json().catch(() => ({}));
      toast({ title: "Error re-activating key", description: (d as any).error ?? "Server error", variant: "destructive" });
    }
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
              {t === "accounts" ? `Accounts (${subs.length})`
                : t === "breakdown" ? "Breakdown"
                : t === "keys" ? `All Keys (${licKeys.length})`
                : t === "audit" ? `Audit (${audit.length})`
                : "Create New"}
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

        {/* ── BREAKDOWN TAB ── */}
        {tab === "breakdown" && (() => {
          // Group licKeys by sub-admin, merge with subs for balance/status info
          const byId: Record<number, { sub: SubAdmin | null; keys: LicKey[] }> = {};
          licKeys.forEach(k => {
            const saId = k.createdBySubAdminId ?? -1;
            if (!byId[saId]) {
              const sub = subs.find(s => s.email === k.subAdminEmail) ?? null;
              byId[saId] = { sub, keys: [] };
            }
            byId[saId].keys.push(k);
          });
          // Also include subs that have no keys yet
          subs.forEach(s => {
            if (!Object.values(byId).some(g => g.sub?.id === s.id)) {
              byId[s.id] = { sub: s, keys: [] };
            }
          });
          const groups = Object.entries(byId).map(([, g]) => g).sort((a, b) => (b.keys.length) - (a.keys.length));
          if (groups.length === 0) return (
            <div className={`${card} text-center py-12`}>
              <UserCog className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No sub admins yet.</p>
            </div>
          );
          return (
            <div className="space-y-4">
              {groups.map((g, gi) => {
                const sub = g.sub;
                const keys = g.keys;
                const subId = sub?.id ?? -(gi + 1);
                const totalAlloc = keys.reduce((s, k) => s + (k.minutesAllocated ?? 0), 0);
                const totalUsed = keys.reduce((s, k) => s + (k.usedMinutes ?? k.minutesConsumed ?? 0), 0);
                const totalUnused = keys.reduce((s, k) => s + (k.unusedMinutes ?? Math.max(0, (k.minutesAllocated ?? 0) - (k.usedMinutes ?? k.minutesConsumed ?? 0))), 0);
                const burn = totalAlloc > 0 ? Math.min(100, Math.round((totalUsed / totalAlloc) * 100)) : 0;
                const burnColor = burn >= 90 ? "text-red-400" : burn >= 60 ? "text-yellow-400" : "text-green-400";
                const burnBarColor = burn >= 90 ? "bg-red-500" : burn >= 60 ? "bg-yellow-500" : "bg-green-500";
                const isExpanded = expandedBreakdown === subId;
                const hasNoApiKey = sub && !sub.assignedDecartKeyId;
                const activeKeys = keys.filter(k => k.isActive && k.activatedAt).length;
                return (
                  <div key={subId} className={`${card} !p-0 overflow-hidden`}>
                    {/* Header row */}
                    <div className="flex items-start gap-3 p-4 cursor-pointer select-none"
                         onClick={() => setExpandedBreakdown(isExpanded ? null : subId)}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-bold text-foreground">{sub?.username ?? g.keys[0]?.subAdminUsername ?? "Unknown"}</span>
                          <span className="text-xs text-muted-foreground">{sub?.email ?? g.keys[0]?.subAdminEmail}</span>
                          {sub && (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${sub.membership === "active" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                              {sub.membership}
                            </span>
                          )}
                          {hasNoApiKey && (
                            <span className="flex items-center gap-1 text-xs text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-full">
                              <AlertTriangle className="w-3 h-3" /> No API key
                            </span>
                          )}
                          {burn >= 80 && totalAlloc > 0 && (
                            <span className="flex items-center gap-1 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
                              <TrendingUp className="w-3 h-3" /> High burn
                            </span>
                          )}
                        </div>
                        {/* Stats inline */}
                        <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
                          <span><span className="font-bold text-primary">{keys.length}</span> keys</span>
                          <span><span className="font-bold text-foreground">{totalAlloc}</span> allocated min</span>
                          <span><span className="font-bold text-orange-400">{Math.round(totalUsed * 10) / 10}</span> used min</span>
                          <span><span className="font-bold text-cyan-400">{Math.round(totalUnused * 10) / 10}</span> unused min</span>
                          {sub && <span>Balance: <span className="font-bold text-green-400">{sub.subAdminMinutesBalance}</span> min</span>}
                          {activeKeys > 0 && <span><span className="font-bold text-emerald-400">{activeKeys}</span> active</span>}
                        </div>
                        {/* Burn rate bar */}
                        {totalAlloc > 0 && (
                          <div className="flex items-center gap-2 mt-2">
                            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-[200px]">
                              <div className={`h-full ${burnBarColor} rounded-full transition-all`} style={{ width: `${burn}%` }} />
                            </div>
                            <span className={`text-xs font-bold ${burnColor}`}>{burn}% burn</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Quick top-up */}
                        {sub && (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <input
                              type="number" min={1} placeholder="min"
                              value={topUpInputs[sub.id] ?? ""}
                              onChange={e => setTopUpInputs(p => ({ ...p, [sub.id]: e.target.value }))}
                              className="w-16 text-xs px-2 py-1 rounded-md bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                            />
                            <Button size="sm" variant="outline" className="text-xs text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10 h-7"
                              onClick={async () => {
                                const mins = parseInt(topUpInputs[sub.id] ?? "0");
                                if (!mins || mins < 1) { toast({ title: "Enter valid minutes", variant: "destructive" }); return; }
                                const r = await fetch(API(`/admin/sub-admins/${sub.id}/minutes`), { method: "PUT", headers: H(), body: JSON.stringify({ minutes: mins }) });
                                if (r.ok) { toast({ title: `${mins} min allocated to ${sub.username}` }); setTopUpInputs(p => ({ ...p, [sub.id]: "" })); fetchSubs(); fetchLicKeys(); }
                                else { const d = await r.json(); toast({ title: "Error", description: d.error, variant: "destructive" }); }
                              }}>
                              <Coins className="w-3 h-3 mr-1" /> Top Up
                            </Button>
                          </div>
                        )}
                        {isExpanded
                          ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      </div>
                    </div>

                    {/* Expanded key list */}
                    {isExpanded && (
                      <div className="border-t border-border bg-background/40">
                        {keys.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-4">No keys generated yet.</p>
                        ) : (
                          <div className="divide-y divide-border">
                            {/* Column headers */}
                            <div className="grid grid-cols-7 gap-2 px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                              <span className="col-span-2">Key</span>
                              <span>Status</span>
                              <span>Used Min</span>
                              <span>Unused Min</span>
                              <span>Burn</span>
                              <span>Action</span>
                            </div>
                            {keys.map(k => {
                              const kBurn = k.burnRate ?? (k.minutesAllocated > 0 ? Math.min(100, Math.round(((k.usedMinutes ?? k.minutesConsumed) / k.minutesAllocated) * 100)) : 0);
                              const kBurnColor = kBurn >= 90 ? "bg-red-500" : kBurn >= 60 ? "bg-yellow-500" : "bg-green-500";
                              const kBurnText = kBurn >= 90 ? "text-red-400" : kBurn >= 60 ? "text-yellow-400" : "text-muted-foreground";
                              const kUnused = k.unusedMinutes ?? Math.max(0, k.minutesAllocated - (k.usedMinutes ?? k.minutesConsumed));
                              return (
                                <div key={k.id} className="grid grid-cols-7 gap-2 px-4 py-2.5 items-center hover:bg-background/60">
                                  <div className="col-span-2 min-w-0">
                                    <code className="text-[11px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded truncate block">{k.key}</code>
                                    {k.notes && <p className="text-[9px] text-muted-foreground truncate">{k.notes}</p>}
                                  </div>
                                  <span className={`text-xs font-bold ${k.isActive ? (k.activatedAt ? "text-green-400" : "text-blue-400") : "text-red-400"}`}>
                                    {k.isActive ? (k.activatedAt ? "Active" : "Unused") : "Inactive"}
                                  </span>
                                  <span className={`text-xs font-mono font-bold ${(k.usedMinutes ?? k.minutesConsumed) > 0 ? "text-orange-400" : "text-muted-foreground"}`}>
                                    {k.usedMinutes ?? k.minutesConsumed} min
                                  </span>
                                  <span className={`text-xs font-mono font-bold ${kUnused > 0 ? "text-cyan-400" : "text-muted-foreground"}`}>
                                    {Math.round(kUnused * 10) / 10} min
                                  </span>
                                  <div className="flex items-center gap-1.5">
                                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                      <div className={`h-full ${kBurnColor} rounded-full`} style={{ width: `${kBurn}%` }} />
                                    </div>
                                    <span className={`text-[10px] font-bold w-7 text-right ${kBurnText}`}>{kBurn}%</span>
                                  </div>
                                  <div>
                                    {k.isActive ? (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        title="Revoke"
                                        className="h-6 px-2 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 gap-1"
                                        onClick={() => revokeLicenseKey(k.key)}
                                      >
                                        <XCircle className="w-3 h-3" /> Revoke
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        title="Re-activate"
                                        className="h-6 px-2 text-[10px] text-green-400 hover:text-green-300 hover:bg-green-500/10 border border-green-500/20 gap-1"
                                        onClick={() => reactivateLicenseKey(k.key)}
                                      >
                                        <CheckCircle2 className="w-3 h-3" /> Re-activate
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* ── KEYS TAB ── */}
        {tab === "keys" && (
          <div className="space-y-4">
            {/* Summary stats */}
            {licKeys.length > 0 && (() => {
              const totalAlloc = licKeys.reduce((s, k) => s + (k.minutesAllocated ?? 0), 0);
              const totalUsed  = licKeys.reduce((s, k) => s + (k.usedMinutes ?? k.minutesConsumed ?? 0), 0);
              const totalUnused = licKeys.reduce((s, k) => s + (k.unusedMinutes ?? Math.max(0, (k.minutesAllocated ?? 0) - (k.usedMinutes ?? k.minutesConsumed ?? 0))), 0);
              const overallBurn = totalAlloc > 0 ? Math.min(100, Math.round((totalUsed / totalAlloc) * 100)) : 0;
              const burnColor = overallBurn >= 90 ? "text-red-400" : overallBurn >= 60 ? "text-yellow-400" : "text-green-400";
              return (
                <div className={card}>
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">All Sub-Admin Keys — Summary</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-background rounded-lg p-3 border border-border text-center">
                      <div className="text-xl font-bold font-mono text-primary">{totalAlloc}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">Total Allocated Min</div>
                    </div>
                    <div className="bg-background rounded-lg p-3 border border-border text-center">
                      <div className="text-xl font-bold font-mono text-orange-400">{Math.round(totalUsed * 10) / 10}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">Total Used Min</div>
                    </div>
                    <div className="bg-background rounded-lg p-3 border border-border text-center">
                      <div className="text-xl font-bold font-mono text-cyan-400">{Math.round(totalUnused * 10) / 10}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">Total Unused Min</div>
                    </div>
                    <div className="bg-background rounded-lg p-3 border border-border text-center">
                      <div className={`text-xl font-bold font-mono ${burnColor}`}>{overallBurn}%</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">Overall Burn Rate</div>
                    </div>
                  </div>
                </div>
              );
            })()}

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
                        <th className={th}>Used Min</th>
                        <th className={th}>Unused Min</th>
                        <th className={th}>Burn Rate</th>
                        <th className={th}>API Key</th>
                        <th className={th}>Rate</th>
                        <th className={th}>Created</th>
                        <th className={th}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredKeys.map(k => {
                        const pct = k.burnRate ?? (k.minutesAllocated > 0 ? Math.min(100, Math.round(((k.usedMinutes ?? k.minutesConsumed) / k.minutesAllocated) * 100)) : 0);
                        const pctColor = pct >= 90 ? "bg-red-500" : pct >= 60 ? "bg-yellow-500" : "bg-green-500";
                        const pctTextColor = pct >= 90 ? "text-red-400" : pct >= 60 ? "text-yellow-400" : "text-muted-foreground";
                        const unusedMin = k.unusedMinutes ?? Math.max(0, k.minutesAllocated - (k.usedMinutes ?? k.minutesConsumed));
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
                              <span className={`font-mono font-bold ${(k.usedMinutes ?? k.minutesConsumed) > 0 ? "text-orange-400" : "text-muted-foreground"}`}>
                                {k.usedMinutes ?? k.minutesConsumed}
                              </span>
                              <span className="text-muted-foreground text-xs ml-1">min</span>
                            </td>
                            <td className={td}>
                              <span className={`font-mono font-bold ${unusedMin > 0 ? "text-cyan-400" : "text-muted-foreground"}`}>
                                {Math.round(unusedMin * 10) / 10}
                              </span>
                              <span className="text-muted-foreground text-xs ml-1">min</span>
                            </td>
                            <td className={td}>
                              <div className="flex items-center gap-2 min-w-[80px]">
                                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div className={`h-full ${pctColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                                </div>
                                <span className={`text-xs w-8 text-right font-bold ${pctTextColor}`}>{pct}%</span>
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
                            <td className={td}>
                              {k.isActive ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="Revoke this licence key"
                                  className="h-7 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 hover:border-red-500/40 gap-1"
                                  onClick={() => revokeLicenseKey(k.key)}
                                >
                                  <XCircle className="w-3 h-3" /> Revoke
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="Re-activate this licence key"
                                  className="h-7 px-2 text-xs text-green-400 hover:text-green-300 hover:bg-green-500/10 border border-green-500/20 hover:border-green-500/40 gap-1"
                                  onClick={() => reactivateLicenseKey(k.key)}
                                >
                                  <CheckCircle2 className="w-3 h-3" /> Re-activate
                                </Button>
                              )}
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
              {/* Email field with inline Check Availability button */}
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">Email Address</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="email"
                    placeholder="subadmin@example.com"
                    value={form.email}
                    onChange={e => { setForm(p => ({ ...p, email: e.target.value })); setEmailCheck(null); }}
                    className={`${inp} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={checkEmail}
                    disabled={emailCheck === "checking" || !form.email}
                    className="shrink-0 text-xs font-bold px-3 py-2 rounded-md border border-border bg-muted hover:bg-muted/80 text-foreground disabled:opacity-50 whitespace-nowrap transition-colors"
                  >
                    {emailCheck === "checking"
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : "Check Availability"}
                  </button>
                </div>
                {emailCheck === "available" && (
                  <p className="flex items-center gap-1 text-xs text-green-400 mt-1.5 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Email is available
                  </p>
                )}
                {emailCheck === "taken" && (
                  <p className="flex items-center gap-1 text-xs text-red-400 mt-1.5 font-medium">
                    <XCircle className="w-3.5 h-3.5" /> Email is already in use and cannot be reused
                  </p>
                )}
                {emailCheck === "error" && (
                  <p className="flex items-center gap-1 text-xs text-yellow-400 mt-1.5 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" /> Could not verify — check your connection
                  </p>
                )}
              </div>

              {/* Username field */}
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">Username</label>
                <input type="text" placeholder="reseller_name" value={form.username}
                  onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                  className={`${inp} w-full`} />
              </div>

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
              <Button
                className="w-full gap-2 mt-2"
                disabled={loading || emailCheck === "taken"}
                onClick={createSubAdmin}
              >
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
