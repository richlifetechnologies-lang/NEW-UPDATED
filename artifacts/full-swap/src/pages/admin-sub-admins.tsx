import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getAdminToken } from "@/lib/auth";
import { UserCog, Plus, Trash2, Ban, CheckCircle, Coins, Eye, EyeOff, RefreshCw, ClockIcon, Activity, LogIn } from "lucide-react";

const API = (path: string) => `/api${path}`;
const authHeaders = () => ({ "Content-Type": "application/json", "Authorization": `Bearer ${getAdminToken() ?? ""}` });

type SubAdmin = { id: number; email: string; username: string; membership: string; subAdminMinutesBalance: number; createdAt: string };
type AuditRow  = { id: number; subAdminId: number; subAdminEmail?: string; subAdminUsername?: string; action: string; targetUserId?: number; minutesAmount?: number; note?: string; performedBy?: number; createdAt: string };

export default function AdminSubAdminsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [subs, setSubs] = useState<SubAdmin[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [tab, setTab] = useState<"list"|"create"|"audit">("list");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", username: "", password: "" });
  const [showPwd, setShowPwd] = useState(false);
  const [minuteInputs, setMinuteInputs] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!getAdminToken()) { setLocation("/admin"); return; }
    fetchSubs(); fetchAudit();
  }, []);

  async function fetchSubs() {
    const r = await fetch(API("/admin/sub-admins"), { headers: authHeaders() });
    if (r.ok) setSubs(await r.json());
  }
  async function fetchAudit() {
    const r = await fetch(API("/admin/sub-admin-audit"), { headers: authHeaders() });
    if (r.ok) setAudit(await r.json());
  }

  async function createSubAdmin() {
    if (!form.email || !form.username || form.password.length < 8) {
      toast({ title: "Validation error", description: "All fields required, password min 8 chars", variant: "destructive" }); return;
    }
    setLoading(true);
    const r = await fetch(API("/admin/sub-admins"), { method: "POST", headers: authHeaders(), body: JSON.stringify(form) });
    setLoading(false);
    if (r.ok) {
      toast({ title: "Sub admin created" });
      setForm({ email: "", username: "", password: "" });
      setTab("list"); fetchSubs(); fetchAudit();
    } else {
      const d = await r.json(); toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  }

  async function allocateMinutes(id: number) {
    const mins = parseInt(minuteInputs[id] ?? "0");
    if (!mins || mins < 1) { toast({ title: "Enter valid minutes", variant: "destructive" }); return; }
    const r = await fetch(API(`/admin/sub-admins/${id}/minutes`), { method: "PUT", headers: authHeaders(), body: JSON.stringify({ minutes: mins }) });
    if (r.ok) {
      toast({ title: `${mins} min allocated` });
      setMinuteInputs(p => ({ ...p, [id]: "" }));
      fetchSubs(); fetchAudit();
    } else {
      const d = await r.json(); toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  }

  async function suspendSub(id: number) {
    const r = await fetch(API(`/admin/sub-admins/${id}/suspend`), { method: "POST", headers: authHeaders() });
    if (r.ok) { toast({ title: "Sub admin suspended" }); fetchSubs(); fetchAudit(); }
  }
  async function activateSub(id: number) {
    const r = await fetch(API(`/admin/sub-admins/${id}/activate`), { method: "POST", headers: authHeaders() });
    if (r.ok) { toast({ title: "Sub admin activated" }); fetchSubs(); }
  }
  async function deleteSub(id: number) {
    if (!confirm("Remove this sub admin? They will no longer be able to log in.")) return;
    const r = await fetch(API(`/admin/sub-admins/${id}`), { method: "DELETE", headers: authHeaders() });
    if (r.ok) { toast({ title: "Sub admin removed" }); fetchSubs(); fetchAudit(); }
  }

  const actionIcon: Record<string, JSX.Element> = {
    login: <LogIn className="w-3 h-3" />, credit_user: <Coins className="w-3 h-3" />,
    minutes_allocated: <Activity className="w-3 h-3" />, suspended: <Ban className="w-3 h-3" />,
    deleted: <Trash2 className="w-3 h-3" />, created: <Plus className="w-3 h-3" />,
  };
  const actionColor: Record<string, string> = {
    login: "text-blue-400", credit_user: "text-green-400", minutes_allocated: "text-cyan-400",
    suspended: "text-red-400", deleted: "text-red-500", created: "text-emerald-400",
  };

  const card = "bg-card border border-border rounded-xl p-5";
  const th = "text-left text-xs font-bold text-muted-foreground uppercase tracking-widest py-2 px-3";
  const td = "py-2.5 px-3 text-sm border-t border-border";

  return (
    <AdminLayout>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <UserCog className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Sub Admin Management</h1>
            <p className="text-xs text-muted-foreground">Create accounts, allocate minutes, monitor activity</p>
          </div>
          <Button size="sm" variant="outline" className="ml-auto gap-2" onClick={() => { fetchSubs(); fetchAudit(); }}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-card border border-border rounded-lg p-1 w-fit">
          {(["list","create","audit"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all capitalize ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "list" ? `Sub Admins (${subs.length})` : t === "create" ? "Create New" : "Audit Log"}
            </button>
          ))}
        </div>

        {/* LIST tab */}
        {tab === "list" && (
          <div className={card}>
            {subs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <UserCog className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No sub admins yet. Create one to get started.</p>
                <Button size="sm" className="mt-4 gap-2" onClick={() => setTab("create")}><Plus className="w-3.5 h-3.5" /> Create Sub Admin</Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr>
                    <th className={th}>Username / Email</th>
                    <th className={th}>Status</th>
                    <th className={th}>Minutes Balance</th>
                    <th className={th}>Allocate</th>
                    <th className={th}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {subs.map(sub => (
                      <tr key={sub.id}>
                        <td className={td}>
                          <p className="font-semibold text-foreground">{sub.username}</p>
                          <p className="text-xs text-muted-foreground">{sub.email}</p>
                        </td>
                        <td className={td}>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${sub.membership === "active" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                            {sub.membership}
                          </span>
                        </td>
                        <td className={td}>
                          <span className="text-lg font-bold text-primary font-mono">{sub.subAdminMinutesBalance}</span>
                          <span className="text-xs text-muted-foreground ml-1">min</span>
                        </td>
                        <td className={td}>
                          <div className="flex gap-2 items-center">
                            <input type="number" min={1} placeholder="min" value={minuteInputs[sub.id] ?? ""}
                              onChange={e => setMinuteInputs(p => ({ ...p, [sub.id]: e.target.value }))}
                              className="w-20 h-8 rounded-md border border-border bg-background text-sm px-2 text-foreground" />
                            <Button size="sm" className="h-8 gap-1" onClick={() => allocateMinutes(sub.id)}>
                              <Plus className="w-3 h-3" /> Add
                            </Button>
                          </div>
                        </td>
                        <td className={td}>
                          <div className="flex gap-1">
                            {sub.membership === "active"
                              ? <Button size="sm" variant="ghost" className="h-7 px-2 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10" onClick={() => suspendSub(sub.id)}><Ban className="w-3.5 h-3.5" /></Button>
                              : <Button size="sm" variant="ghost" className="h-7 px-2 text-green-400 hover:text-green-300 hover:bg-green-500/10" onClick={() => activateSub(sub.id)}><CheckCircle className="w-3.5 h-3.5" /></Button>
                            }
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => deleteSub(sub.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* CREATE tab */}
        {tab === "create" && (
          <div className={`${card} max-w-md`}>
            <h2 className="text-base font-bold text-foreground mb-4">Create Sub Admin Account</h2>
            <div className="space-y-3">
              {[
                { label: "Email Address", key: "email" as const, type: "email", placeholder: "subadmin@example.com" },
                { label: "Username", key: "username" as const, type: "text", placeholder: "subadmin_name" },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder} value={form[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full h-10 rounded-lg border border-border bg-background text-sm px-3 text-foreground" />
                </div>
              ))}
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">Password</label>
                <div className="relative">
                  <input type={showPwd ? "text" : "password"} placeholder="Min 8 characters" value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    className="w-full h-10 rounded-lg border border-border bg-background text-sm px-3 pr-10 text-foreground" />
                  <button type="button" onClick={() => setShowPwd(v => !v)}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground">
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

        {/* AUDIT tab */}
        {tab === "audit" && (
          <div className={card}>
            <h2 className="text-base font-bold text-foreground mb-4">Sub Admin Activity Log</h2>
            {audit.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No activity recorded yet.</p>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {audit.map(row => (
                  <div key={row.id} className="flex items-start gap-3 p-3 rounded-lg bg-background/60 border border-border">
                    <div className={`mt-0.5 ${actionColor[row.action] ?? "text-muted-foreground"}`}>
                      {actionIcon[row.action] ?? <Activity className="w-3 h-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-foreground">{row.subAdminUsername ?? `ID:${row.subAdminId}`}</span>
                        <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${actionColor[row.action] ?? ""} bg-current/10`}>{row.action}</span>
                        {row.minutesAmount && <span className="text-xs text-primary font-bold">{row.minutesAmount} min</span>}
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
      </div>
    </AdminLayout>
  );
}
