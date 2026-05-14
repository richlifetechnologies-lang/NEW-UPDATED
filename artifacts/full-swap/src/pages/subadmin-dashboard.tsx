import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { getAdminToken, clearAdminToken, clearAdminProfile } from "@/lib/auth";
import { Coins, Activity, LogOut, RefreshCw, CheckCircle, Zap, Clock,
         UserCog, UserPlus, Eye, EyeOff, Search, CreditCard,
         Copy, CheckCheck, Wallet, Users, Play, X,
         CheckCircle2, XCircle, Clock3, Ban, History } from "lucide-react";
import { Button } from "@/components/ui/button";

const API = (p: string) => `/api${p}`;
const authH = () => ({ "Content-Type": "application/json", "Authorization": `Bearer ${getAdminToken() ?? ""}` });

type Me = { id: number; email: string; username: string; membership: string; subAdminMinutesBalance: number; totalMinutesPurchased: number };
type Session = { id: string; userId: number; username: string; email: string; style: string; startedAt: string };
type UserResult = { id: number; email: string; username: string; membership: string; totalMinutesPurchased: number; totalMinutesUsed: number; freeSecondsRemaining: number };
type RecentSession = { id: string; username: string; status: string; startedAt: string; durationSeconds?: number; style?: string };
type Tier = { id: number; minutes: number; priceUsdt: number; label: string };
type Invoice = { id: string; minutes: number; amountUsdt: number; status: string; walletAddress: string; createdAt: string; paidAt?: string };
type MyUser  = { id: number; email: string; username: string; membership: string; totalMinutesPurchased: number; createdAt: string };
type LicenseKey = { id: number; key: string; deviceId: string | null; isActive: boolean; activatedAt: string | null; minutesAllocated: number; minutesCredited: boolean; createdAt: string; notes: string | null };

export default function SubAdminDashboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [searchEmail, setSearchEmail] = useState("");
  const [licenseKeys, setLicenseKeys] = useState<LicenseKey[]>([]);
  const [genMinutes, setGenMinutes] = useState("");
  const [genNotes, setGenNotes] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [foundUser, setFoundUser] = useState<UserResult | null>(null);
  const [creditMins, setCreditMins] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [searching, setSearching] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const [tab, setTab] = useState<"credit"|"create"|"sessions"|"activity"|"users"|"billing"|"streaming">("credit");
  const [createForm, setCreateForm] = useState({ email: "", username: "", password: "" });
  const [showCreatePwd, setShowCreatePwd] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdUser, setCreatedUser] = useState<{ email: string; username: string } | null>(null);
  const [myUsers, setMyUsers] = useState<MyUser[]>([]);
  const [myUsersLoaded, setMyUsersLoaded] = useState(false);
  // Billing state
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [pendingInvoice, setPendingInvoice] = useState<any>(null);
  const [topping, setTopping] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [payCountdown, setPayCountdown] = useState<number | null>(null); // seconds remaining
  const [refreshing, setRefreshing] = useState(false);

  const logout = () => { clearAdminToken(); clearAdminProfile(); localStorage.removeItem("fullswap_sub_admin"); setLocation("/subadmin"); };

  const fetchAll = useCallback(async () => {
    const token = getAdminToken();
    if (!token) { setLocation("/subadmin"); return; }
    const [meR, sessR, actR] = await Promise.all([
      fetch(API("/subadmin/me"), { headers: authH() }),
      fetch(API("/subadmin/active-sessions"), { headers: authH() }),
      fetch(API("/subadmin/recent-activity"), { headers: authH() }),
    ]);
    if (!meR.ok) { logout(); return; }
    setMe(await meR.json());
    if (sessR.ok) { const d = await sessR.json(); setSessions(d.sessions ?? []); }
    if (actR.ok) { const d = await actR.json(); setRecentSessions(d.recentSessions ?? []); }
  }, []);

  const fetchBillingData = useCallback(async () => {
    const [tiersR, invsR] = await Promise.all([
      fetch(API("/subadmin/pricing"), { headers: authH() }),
      fetch(API("/subadmin/invoices"), { headers: authH() }),
    ]);
    if (tiersR.ok) setTiers(await tiersR.json());
    if (invsR.ok) setInvoices(await invsR.json());
  }, []);

  useEffect(() => {
    if (!getAdminToken() || localStorage.getItem("fullswap_sub_admin") !== "1") { setLocation("/subadmin"); return; }
    fetchAll();
    const iv = setInterval(fetchAll, 15000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  useEffect(() => {
    if (tab === "billing") fetchBillingData();
  }, [tab, fetchBillingData]);

  useEffect(() => {
    if (tab === "users" && !myUsersLoaded) {
      fetch(API("/subadmin/my-users"), { headers: authH() })
        .then(r => r.ok ? r.json() : [])
        .then(data => { setMyUsers(data); setMyUsersLoaded(true); })
        .catch(() => {});
    }
  }, [tab, myUsersLoaded]);

  async function searchUser() {
    if (!searchEmail.trim()) return;
    setSearching(true); setFoundUser(null);
    const r = await fetch(API(`/subadmin/users/search?email=${encodeURIComponent(searchEmail.trim())}`), { headers: authH() });
    setSearching(false);
    if (r.ok) setFoundUser(await r.json());
    else toast({ title: "User not found", description: "No account with that email in your created users", variant: "destructive" });
  }

  async function creditUser() {
    if (!foundUser) return;
    const mins = parseInt(creditMins);
    if (!mins || mins < 1) { toast({ title: "Enter valid minutes", variant: "destructive" }); return; }
    setCrediting(true);
    const r = await fetch(API(`/subadmin/users/${foundUser.id}/credit`), {
      method: "POST", headers: authH(),
      body: JSON.stringify({ minutes: mins, note: creditNote.trim() || undefined }),
    });
    setCrediting(false);
    if (r.ok) {
      const d = await r.json();
      toast({ title: `${mins} min credited!`, description: `Balance: ${d.subAdminBalanceRemaining} min remaining` });
      setCreditMins(""); setCreditNote(""); setFoundUser(null); setSearchEmail(""); fetchAll();
    } else {
      const d = await r.json(); toast({ title: "Credit failed", description: d.error, variant: "destructive" });
    }
  }

  async function createUser() {
    if (!createForm.email.trim() || !createForm.username.trim() || createForm.password.length < 8) {
      toast({ title: "All fields required", description: "Password min 8 chars", variant: "destructive" }); return;
    }
    setCreating(true); setCreatedUser(null);
    const r = await fetch(API("/subadmin/users/create"), { method: "POST", headers: authH(), body: JSON.stringify(createForm) });
    setCreating(false);
    if (r.ok) {
      const d = await r.json();
      setCreatedUser({ email: d.email, username: d.username });
      setCreateForm({ email: "", username: "", password: "" });
      toast({ title: "User created!", description: `${d.email} — no free credits` });
    } else {
      const d = await r.json(); toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  }

  async function startTopup() {
    if (!selectedTier) return;
    setTopping(true);
    const r = await fetch(API("/subadmin/topup"), { method: "POST", headers: authH(), body: JSON.stringify({ minutes: selectedTier.minutes }) });
    setTopping(false);
    if (r.ok) {
      const d = await r.json();
      setPendingInvoice(d);
      setPayCountdown(5 * 60); // 5 minutes
      fetchBillingData();
    } else {
      const d = await r.json(); toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  }

  // Manual cancel — user clicked "Cancel Order" → status becomes "cancelled"
  async function cancelPayment() {
    if (!pendingInvoice) return;
    try {
      await fetch(API(`/subadmin/invoices/${pendingInvoice.id}/cancel`), { method: "POST", headers: authH() });
    } catch { /* best-effort */ }
    setPendingInvoice(null);
    setSelectedTier(null);
    setPayCountdown(null);
    fetchBillingData();
    toast({ title: "Order cancelled", description: "Your payment order has been cancelled.", variant: "destructive" });
  }

  // Timer expiry — countdown hit 0 → status becomes "failed" (not paid, not manually cancelled)
  async function expirePayment(invoiceId: string) {
    try {
      await fetch(API(`/subadmin/invoices/${invoiceId}/fail`), { method: "POST", headers: authH() });
    } catch { /* best-effort */ }
    setPendingInvoice(null);
    setSelectedTier(null);
    setPayCountdown(null);
    fetchBillingData();
    toast({ title: "Order Failed", description: "No payment received within the time limit. The order has been marked as failed.", variant: "destructive" });
  }

  // Countdown timer effect — auto-expires when it reaches 0
  useEffect(() => {
    if (payCountdown === null) return;
    if (payCountdown <= 0) {
      // Capture invoice id NOW before state is cleared
      const invoiceId = pendingInvoice?.id;
      if (invoiceId) expirePayment(invoiceId);
      return;
    }
    const id = setTimeout(() => setPayCountdown(c => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(id);
  }, [payCountdown]);

  function formatCountdown(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function copyAddr(addr: string) {
    navigator.clipboard?.writeText(addr).catch(() => {});
    setCopiedAddr(true); setTimeout(() => setCopiedAddr(false), 2000);
  }

  if (!me) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex items-center gap-3 text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin" /><span>Loading...</span></div>
    </div>
  );

  const card = "bg-card border border-border rounded-xl p-5";
  const totalBalance = Number(me.subAdminMinutesBalance ?? 0) + Number(me.totalMinutesPurchased ?? 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-sm px-6 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <UserCog className="w-4 h-4 text-primary" />
        </div>
        <div>
          <span className="text-sm font-bold text-foreground font-mono">FULL SWAP BY RICH</span>
          <span className="text-xs text-muted-foreground ml-2">Sub Admin Portal</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground hidden sm:block">{me.email}</span>
          <Button
            size="sm"
            onClick={logout}
            className="gap-2 font-bold text-white hover:text-white hover:bg-destructive/20 border border-white/30 hover:border-destructive/60 transition-all"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </div>
      </header>

      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">Welcome, {me.username}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Sub Admin Dashboard</p>
          </div>
          <Button
            size="sm"
            variant="destructive"
            onClick={logout}
            className="gap-2 font-bold"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          <div className={card}>
            <div className="flex items-center gap-2 mb-2"><Coins className="w-4 h-4 text-primary" /><span className="text-xs text-muted-foreground font-bold uppercase tracking-wide">Total Balance</span></div>
            <div className="text-3xl font-bold font-mono text-primary">{totalBalance}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {me.subAdminMinutesBalance} allocated + {me.totalMinutesPurchased} purchased
            </div>
          </div>
          <div className={card}>
            <div className="flex items-center gap-2 mb-2"><Activity className="w-4 h-4 text-green-400" /><span className="text-xs text-muted-foreground font-bold uppercase tracking-wide">Live Streams</span></div>
            <div className="text-3xl font-bold font-mono text-green-400">{sessions.length}</div>
            <div className="text-xs text-muted-foreground mt-1">your users active now</div>
          </div>
          <div className={card}>
            <div className="flex items-center gap-2 mb-2"><Clock className="w-4 h-4 text-blue-400" /><span className="text-xs text-muted-foreground font-bold uppercase tracking-wide">Recent</span></div>
            <div className="text-3xl font-bold font-mono text-blue-400">{recentSessions.length}</div>
            <div className="text-xs text-muted-foreground mt-1">recent sessions</div>
          </div>
        </div>

        {/* Stream Launch button */}
        <div className={`${card} flex items-center justify-between gap-4 mb-0`}
             style={{ background: "hsl(187 100% 52% / 0.06)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
          <div>
            <div className="flex items-center gap-2 mb-1"><Play className="w-4 h-4 text-primary" /><span className="text-sm font-bold text-primary">Streaming Studio</span></div>
            <p className="text-xs text-muted-foreground">
              {me.totalMinutesPurchased > 0
                ? `${me.totalMinutesPurchased} min available — ready to stream`
                : "Purchase minutes via Billing tab to stream"}
            </p>
          </div>
          <Button
            className="gap-2 shrink-0"
            disabled={me.totalMinutesPurchased <= 0}
            onClick={() => setLocation("/subadmin/stream")}
            style={me.totalMinutesPurchased > 0 ? { boxShadow: "0 0 20px hsl(187 100% 52% / 0.3)" } : {}}
          >
            <Play className="w-4 h-4" />
            {me.totalMinutesPurchased > 0 ? "Launch Stream" : "No Minutes"}
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-card border border-border rounded-lg p-1 flex-wrap">
          {(["credit","create","sessions","activity","users","billing","streaming"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all ${tab===t?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground"}`}>
              {t === "credit" ? "Credit User" : t === "create" ? "Create User" :
               t === "sessions" ? `Live (${sessions.length})` : t === "billing" ? "Software License Prices" :
               t === "users" ? `My Users (${myUsers.length || "..."})` : t === "streaming" ? "Streaming" : "Activity"}
            </button>
          ))}
        </div>

        {/* CREDIT USER */}
        {tab === "credit" && (
          <div className="space-y-4">
            <div className={card}>
              <h3 className="text-sm font-bold text-foreground mb-3">Find User by Email</h3>
              <div className="flex gap-2">
                <input type="email" placeholder="user@example.com" value={searchEmail}
                  onChange={e => { setSearchEmail(e.target.value); setFoundUser(null); }}
                  onKeyDown={e => e.key === "Enter" && searchUser()}
                  className="flex-1 h-10 rounded-lg border border-border bg-background text-sm px-3 text-foreground" />
                <Button className="gap-2" onClick={searchUser} disabled={searching}>
                  <Search className="w-4 h-4" />{searching ? "..." : "Search"}
                </Button>
              </div>
            </div>
            {foundUser && (
              <div className={card}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="font-bold text-foreground">{foundUser.username}</p>
                    <p className="text-xs text-muted-foreground">{foundUser.email}</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${foundUser.membership==="active"?"bg-green-500/15 text-green-400":"bg-orange-500/15 text-orange-400"}`}>{foundUser.membership}</span>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: "Minutes Purchased", val: foundUser.totalMinutesPurchased },
                    { label: "Minutes Used", val: Math.round(Number(foundUser.totalMinutesUsed ?? 0)) },
                    { label: "Free Secs Left", val: foundUser.freeSecondsRemaining },
                  ].map(s => (
                    <div key={s.label} className="bg-background rounded-lg p-3 border border-border text-center">
                      <div className="text-xl font-bold font-mono text-foreground">{s.val}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input type="number" min={1} max={totalBalance} placeholder={`Max ${totalBalance} min`}
                      value={creditMins} onChange={e => setCreditMins(e.target.value)}
                      className="w-36 h-10 rounded-lg border border-border bg-background text-sm px-3 text-foreground" />
                    <input type="text" placeholder="Note (optional)" value={creditNote} onChange={e => setCreditNote(e.target.value)}
                      className="flex-1 h-10 rounded-lg border border-border bg-background text-sm px-3 text-foreground" />
                  </div>
                  <Button className="w-full gap-2" disabled={crediting || !creditMins || totalBalance < 1} onClick={creditUser}>
                    <Zap className="w-4 h-4" />{crediting ? "Crediting..." : `Credit ${creditMins || "?"} Minutes`}
                  </Button>
                  {totalBalance < 1 && <p className="text-xs text-red-400 text-center">Balance empty — top up via the Billing tab.</p>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* CREATE USER */}
        {tab === "create" && (
          <div className="space-y-4">
            <div className={`${card} max-w-md`}>
              <div className="flex items-center gap-2 mb-4"><UserPlus className="w-4 h-4 text-primary" /><h3 className="text-sm font-bold text-foreground">Create New User Account</h3></div>
              <div className="mb-3 p-3 rounded-lg bg-orange-500/10 border border-orange-500/25">
                <p className="text-xs text-orange-300 font-semibold">Users created here start with <span className="text-orange-200">zero free credits</span>.</p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">Email</label>
                  <input type="email" placeholder="user@example.com" value={createForm.email}
                    onChange={e => setCreateForm(p => ({ ...p, email: e.target.value }))}
                    className="w-full h-10 rounded-lg border border-border bg-background text-sm px-3 text-foreground" />
                </div>
                <div>
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">Username</label>
                  <input type="text" placeholder="username" value={createForm.username}
                    onChange={e => setCreateForm(p => ({ ...p, username: e.target.value }))}
                    className="w-full h-10 rounded-lg border border-border bg-background text-sm px-3 text-foreground" />
                </div>
                <div>
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">Password</label>
                  <div className="relative">
                    <input type={showCreatePwd ? "text" : "password"} placeholder="Min 8 characters"
                      value={createForm.password} onChange={e => setCreateForm(p => ({ ...p, password: e.target.value }))}
                      className="w-full h-10 rounded-lg border border-border bg-background text-sm px-3 pr-10 text-foreground" />
                    <button type="button" onClick={() => setShowCreatePwd(v => !v)}
                      className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground">
                      {showCreatePwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <Button className="w-full gap-2 mt-1" disabled={creating} onClick={createUser}>
                  <UserPlus className="w-4 h-4" />{creating ? "Creating..." : "Create User Account"}
                </Button>
              </div>
            </div>
            {createdUser && (
              <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/25 max-w-md">
                <div className="flex items-center gap-2 mb-1"><CheckCircle className="w-4 h-4 text-green-400" /><span className="text-sm font-bold text-green-400">Created</span></div>
                <p className="text-sm text-foreground"><span className="font-semibold">{createdUser.username}</span> · {createdUser.email}</p>
                <p className="text-xs text-muted-foreground mt-1">0 free credits. Use Credit User tab to add minutes.</p>
              </div>
            )}
          </div>
        )}

        {/* LIVE SESSIONS */}
        {tab === "sessions" && (
          <div className={card}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-foreground">Your Users — Live Sessions</h3>
              <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={fetchAll}><RefreshCw className="w-3 h-3" /> Refresh</Button>
            </div>
            {sessions.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">None of your users are streaming right now.</p> : (
              <div className="space-y-2">
                {sessions.map(s => (
                  <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg bg-background border border-border">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{s.username}</p>
                      <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-mono">{s.style ?? "natural"}</span>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(s.startedAt).toLocaleTimeString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* MY USERS */}
        {tab === "users" && (
          <div className={card}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><Users className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Users You Created</h3>
              </div>
              <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={() => { setMyUsersLoaded(false); }}>
                <RefreshCw className="w-3 h-3" /> Refresh
              </Button>
            </div>
            {myUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">You haven't created any user accounts yet.</p>
            ) : (
              <div className="space-y-2">
                {myUsers.map(u => (
                  <div key={u.id} className="flex items-center justify-between p-3 rounded-lg bg-background border border-border">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{u.username}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${u.membership==="active"?"bg-green-500/15 text-green-400":"bg-orange-500/15 text-orange-400"}`}>
                        {u.membership}
                      </span>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{u.totalMinutesPurchased} min</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ACTIVITY */}
        {tab === "activity" && (
          <div className={card}>
            <h3 className="text-sm font-bold text-foreground mb-4">Your Users — Recent Sessions</h3>
            {recentSessions.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No recent activity from your users.</p> : (
              <div className="space-y-2">
                {recentSessions.map(s => (
                  <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg bg-background border border-border">
                    <span className={`w-2 h-2 rounded-full ${s.status==="active"?"bg-green-400 animate-pulse":"bg-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{s.username}</p>
                      <p className="text-xs text-muted-foreground">{s.status}{s.durationSeconds ? ` · ${Math.round(s.durationSeconds/60)} min` : ""}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground whitespace-nowrap">{new Date(s.startedAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STREAMING */}
        {tab === "streaming" && (
          <div className="space-y-4">
            {totalBalance > 0 ? (
              <div className={`${card}`}
                   style={{ background: "hsl(187 100% 52% / 0.06)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
                <div className="flex items-center gap-2 mb-3"><Play className="w-5 h-5 text-primary" /><h3 className="text-sm font-bold text-primary">Streaming Studio</h3></div>
                <p className="text-sm text-muted-foreground mb-4">
                  You have <span className="font-bold text-primary">{totalBalance} minutes</span> available. Launch the streaming studio to start your session.
                </p>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: "Available Minutes", val: totalBalance, color: "text-primary" },
                    { label: "Live Streams", val: sessions.length, color: "text-green-400" },
                    { label: "Recent Sessions", val: recentSessions.length, color: "text-blue-400" },
                  ].map(s => (
                    <div key={s.label} className="bg-background rounded-lg p-3 border border-border text-center">
                      <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
                <Button
                  className="w-full gap-2"
                  onClick={() => setLocation("/subadmin/stream")}
                  style={{ boxShadow: "0 0 20px hsl(187 100% 52% / 0.3)" }}
                >
                  <Play className="w-4 h-4" />
                  Launch Streaming Studio
                </Button>
              </div>
            ) : (
              <div className={card}>
                <div className="flex flex-col items-center text-center py-6">
                  <div className="w-16 h-16 rounded-full bg-orange-500/10 border border-orange-500/25 flex items-center justify-center mb-4">
                    <Coins className="w-8 h-8 text-orange-400" />
                  </div>
                  <h3 className="text-lg font-bold text-foreground mb-2">No Minutes Available</h3>
                  <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                    You need to purchase streaming minutes before you can use the Streaming Studio. Head over to the Billing section to top up your account.
                  </p>
                  <Button
                    className="gap-2"
                    onClick={() => setTab("billing")}
                  >
                    <CreditCard className="w-4 h-4" />
                    Go to Billing
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* BILLING */}
        {tab === "billing" && (
          <div className="space-y-4">
            {/* Balance summary */}
            <div className={card}>
              <div className="flex items-center gap-2 mb-3"><Wallet className="w-4 h-4 text-primary" /><h3 className="text-sm font-bold text-foreground">Your Minutes Balance</h3></div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Allocated by Admin", val: me.subAdminMinutesBalance, color: "text-primary" },
                  { label: "Self-Purchased", val: me.totalMinutesPurchased, color: "text-cyan-400" },
                  { label: "Total Available", val: totalBalance, color: "text-green-400" },
                ].map(s => (
                  <div key={s.label} className="bg-background rounded-lg p-3 border border-border text-center">
                    <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top up */}
            {!pendingInvoice ? (
              <div className={card}>
                <div className="flex items-center gap-2 mb-3"><CreditCard className="w-4 h-4 text-primary" /><h3 className="text-sm font-bold text-foreground">Top Up Minutes</h3></div>
                <p className="text-xs text-muted-foreground mb-4">Purchase minutes in USD. Purchased minutes are added to your balance to distribute to users.</p>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {tiers.map(tier => (
                    <button key={tier.id} onClick={() => setSelectedTier(tier)}
                      className={`p-3 rounded-lg border text-left transition-all ${selectedTier?.id === tier.id ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"}`}>
                      <p className="font-bold text-foreground">{tier.minutes} min</p>
                      <p className="text-xs text-muted-foreground">${tier.priceUsdt} · {tier.label}</p>
                    </button>
                  ))}
                </div>
                <Button className="w-full gap-2" disabled={!selectedTier || topping} onClick={startTopup}>
                  <Zap className="w-4 h-4" />{topping ? "Creating invoice..." : selectedTier ? `Pay $${selectedTier.priceUsdt} for ${selectedTier.minutes} min` : "Select a plan first"}
                </Button>
              </div>
            ) : (
              <div className={card}>
                <div className="flex items-center gap-2 mb-4"><Wallet className="w-4 h-4 text-yellow-400" /><h3 className="text-sm font-bold text-foreground">Payment Pending</h3></div>
                <p className="text-xs text-muted-foreground mb-1">Send exactly:</p>
                <p className="text-2xl font-bold font-mono text-primary mb-1">${pendingInvoice.amountUsdt}</p>
                <p className="text-xs text-muted-foreground mb-3">{pendingInvoice.walletNetwork} · {pendingInvoice.minutes} minutes</p>
                <p className="text-xs text-muted-foreground mb-1">To wallet address:</p>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-background border border-border mb-4">
                  <p className="text-xs font-mono text-foreground flex-1 break-all">{pendingInvoice.walletAddress}</p>
                  <button onClick={() => copyAddr(pendingInvoice.walletAddress)} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                    {copiedAddr ? <CheckCheck className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                {/* Countdown timer */}
                {payCountdown !== null && (
                  <div className={`flex items-center gap-2 p-2 rounded-lg mb-3 text-xs font-mono font-bold ${payCountdown <= 60 ? "bg-red-500/15 text-red-400 border border-red-500/30" : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"}`}>
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>Order expires in: {formatCountdown(payCountdown)}</span>
                    {payCountdown <= 60 && <span className="ml-auto animate-pulse">⚠ Expiring soon!</span>}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" className="flex-1 gap-1.5" onClick={cancelPayment}>
                    <X className="w-3 h-3" /> Cancel Order
                  </Button>
                  <Button size="sm" className="flex-1 gap-2" onClick={() => { fetchAll(); fetchBillingData(); toast({ title: "Checking payment..." }); }}>
                    <RefreshCw className="w-3 h-3" /> Check Payment
                  </Button>
                </div>
              </div>
            )}

            {/* Invoice history */}
            <div className={card}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Payment History</h3>
                </div>
                <Button
                  size="sm" variant="ghost"
                  className="h-7 gap-1.5 text-xs"
                  disabled={refreshing}
                  onClick={async () => {
                    setRefreshing(true);
                    await Promise.all([fetchAll(), fetchBillingData()]);
                    setRefreshing(false);
                    toast({ title: "Refreshed", description: "Payment history updated." });
                  }}
                >
                  <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
                  {refreshing ? "Refreshing..." : "Refresh"}
                </Button>
              </div>

              {/* Status legend */}
              <div className="flex flex-wrap gap-2 mb-4">
                {[
                  { label: "Completed", color: "bg-green-500/15 text-green-400 border border-green-500/25" },
                  { label: "Cancelled", color: "bg-red-500/15 text-red-400 border border-red-500/25" },
                  { label: "Failed",    color: "bg-orange-500/15 text-orange-400 border border-orange-500/25" },
                ].map(s => (
                  <span key={s.label} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.color}`}>{s.label}</span>
                ))}
              </div>

              {invoices.filter(inv => inv.status !== "pending").length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                  <History className="w-8 h-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No payment history yet</p>
                  <p className="text-xs text-muted-foreground/60">Completed, cancelled, and failed orders will appear here</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {invoices.filter(inv => inv.status !== "pending").map(inv => {
                    const isPaid      = inv.status === "paid";
                    const isCancelled = inv.status === "cancelled";
                    const isFailed    = inv.status === "failed" || inv.status === "expired";

                    const statusCfg = isPaid
                      ? { label: "Completed", icon: <CheckCircle2 className="w-3 h-3" />, badge: "bg-green-500/15 text-green-400 border border-green-500/25",    row: "border-green-500/15" }
                      : isCancelled
                      ? { label: "Cancelled", icon: <XCircle className="w-3 h-3" />,      badge: "bg-red-500/15 text-red-400 border border-red-500/25",          row: "border-red-500/15" }
                      : isFailed
                      ? { label: "Failed",    icon: <Ban className="w-3 h-3" />,           badge: "bg-orange-500/15 text-orange-400 border border-orange-500/25", row: "border-orange-500/15" }
                      : { label: "Unknown",   icon: <Clock3 className="w-3 h-3" />,        badge: "bg-muted text-muted-foreground",                               row: "border-muted" };

                  
  // License Key Generation
  const handleGenerateLicenseKey = async () => {
    const mins = parseInt(genMinutes);
    if (!mins || mins < 1) { toast({ title: "Invalid minutes", variant: "destructive" }); return; }
    const totalBal = (me?.subAdminMinutesBalance ?? 0) + (me?.totalMinutesPurchased ?? 0);
    if (mins > totalBal) { toast({ title: "Insufficient balance", description: `You only have ${totalBal} minutes available`, variant: "destructive" }); return; }
    setIsGenerating(true);
    try {
      const res = await fetch(API("/subadmin/license/generate"), {
        method: "POST", headers: authH(),
        body: JSON.stringify({ minutes: mins, notes: genNotes || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setNewKey(data.key);
      toast({ title: "License Key Generated!", description: `${data.key} (${mins} min)` });
      setGenMinutes(""); setGenNotes("");
      // Refresh
      const meRes = await fetch(API("/subadmin/me"), { headers: authH() }).then(r => r.json());
      setMe(meRes);
      const licRes = await fetch(API("/subadmin/license/list"), { headers: authH() }).then(r => r.json());
      if (Array.isArray(licRes)) setLicenseKeys(licRes);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setIsGenerating(false); }
  };

  return (
                      <div key={inv.id} className={`flex items-center justify-between p-3 rounded-lg bg-background border ${statusCfg.row} hover:bg-muted/10 transition-colors`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-xs font-mono text-muted-foreground">#{inv.id.slice(0, 8).toUpperCase()}</span>
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${statusCfg.badge}`}>
                              {statusCfg.icon} {statusCfg.label}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-foreground">{inv.minutes} min &middot; ${inv.amountUsdt}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {isPaid && inv.paidAt
                              ? `Paid on ${new Date(inv.paidAt).toLocaleDateString()}`
                              : isCancelled
                              ? `Cancelled · ${new Date(inv.createdAt).toLocaleDateString()}`
                              : isFailed
                              ? `Failed · ${new Date(inv.createdAt).toLocaleDateString()}`
                              : `${new Date(inv.createdAt).toLocaleDateString()}`}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      
        {/* ── License Key Generator ────────────────────────────────────────── */}
        <div className="rounded-xl p-6" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 11%)" }}>
          <h3 className="font-bold text-foreground mb-4 flex items-center gap-2 text-lg">
            <Zap className="w-5 h-5 text-primary" />
            License Key Generator
          </h3>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input type="number" min="1" placeholder="Minutes to allocate"
              className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
              value={genMinutes} onChange={e => setGenMinutes(e.target.value)}
              disabled={isGenerating || ((me?.subAdminMinutesBalance ?? 0) + (me?.totalMinutesPurchased ?? 0)) === 0} />
            <input type="text" placeholder="Notes (optional)"
              className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-foreground"
              value={genNotes} onChange={e => setGenNotes(e.target.value)} disabled={isGenerating} />
            <Button onClick={handleGenerateLicenseKey}
              disabled={isGenerating || !genMinutes || ((me?.subAdminMinutesBalance ?? 0) + (me?.totalMinutesPurchased ?? 0)) === 0}
              className="gap-2 whitespace-nowrap" style={{ boxShadow: "0 0 16px hsl(187 100% 52% / 0.2)" }}>
              <Zap className="w-4 h-4" />{isGenerating ? "Generating..." : "Generate Key"}
            </Button>
          </div>
          {((me?.subAdminMinutesBalance ?? 0) + (me?.totalMinutesPurchased ?? 0)) === 0 && (
            <p className="text-amber-400 text-xs mb-3">Purchase minutes first to generate license keys.</p>
          )}
          {newKey && (
            <div className="flex items-center gap-2 p-3 rounded-lg mb-4" style={{ background: "hsl(187 100% 52% / 0.08)", border: "1px solid hsl(187 100% 52% / 0.25)" }}>
              <span className="font-mono text-primary tracking-widest flex-1">{newKey}</span>
              <button onClick={() => { navigator.clipboard.writeText(newKey); toast({ title: "Copied!" }); }} className="text-muted-foreground hover:text-primary cursor-pointer"><Copy className="w-4 h-4" /></button>
            </div>
          )}
          {licenseKeys.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              <p className="text-xs text-muted-foreground mb-2">{licenseKeys.length} key(s) generated</p>
              {licenseKeys.map(lk => (
                <div key={lk.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-foreground tracking-wider text-xs">{lk.key}</span>
                    <span className="text-xs text-primary font-mono">{lk.minutesAllocated}min</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {lk.deviceId ? <span className="text-xs text-emerald-400">Activated</span> : <span className="text-xs text-sky-400">Unused</span>}
                    {!lk.isActive && <span className="text-xs text-red-400">Revoked</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

</div>
    </div>
  );
}
