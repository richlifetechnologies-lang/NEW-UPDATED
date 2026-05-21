import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { getAdminToken, clearAdminToken, clearAdminProfile } from "@/lib/auth";
import { Coins, Activity, LogOut, RefreshCw, Zap, Clock,
         UserCog, Search, CreditCard,
         Wallet, Users, Key,
         TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";

const API = (p: string) => `/api${p}`;
const authH = () => ({ "Content-Type": "application/json", "Authorization": `Bearer ${getAdminToken() ?? ""}` });

type Me = { id: number; email: string; username: string; membership: string; subAdminMinutesBalance: number; totalMinutesPurchased: number };
type Session = { id: string; userId: number; username: string; email: string; style: string; startedAt: string };
type RecentSession = { id: string; username: string; status: string; startedAt: string; durationSeconds?: number; style?: string };
type Tier = { id: number; minutes: number; priceUsdt: number; label: string };
type MyUser  = { id: number; email: string; username: string; membership: string; totalMinutesPurchased: number; createdAt: string };
type LicenseKey = { id: number; key: string; deviceId: string | null; isActive: boolean; activatedAt: string | null; minutesAllocated: number; minutesCredited: boolean; createdAt: string; notes: string | null };

export default function SubAdminDashboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [searchKey, setSearchKey] = useState("");
  const [licenseKeys, setLicenseKeys] = useState<LicenseKey[]>([]);
  const [genMinutes, setGenMinutes] = useState("");
  const [genNotes, setGenNotes] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [foundKey, setFoundKey] = useState<LicenseKey | null>(null);
  const [addMins, setAddMins] = useState("");
  const [addNote, setAddNote] = useState("");
  const [searching, setSearching] = useState(false);
  const [addingToKey, setAddingToKey] = useState(false);
  const [tab, setTab] = useState<"credit"|"sessions"|"activity"|"users"|"billing">("credit");
  const [myUsers, setMyUsers] = useState<MyUser[]>([]);
  const [myUsersLoaded, setMyUsersLoaded] = useState(false);
  const [tiers, setTiers] = useState<Tier[]>([]);

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
    const r = await fetch(API("/subadmin/pricing"), { headers: authH() });
    if (r.ok) setTiers(await r.json());
  }, []);

  useEffect(() => {
    if (!getAdminToken() || localStorage.getItem("fullswap_sub_admin") !== "1") { setLocation("/subadmin"); return; }
    fetchAll();
    // Load license keys on mount so the overview counter is populated immediately
    fetch(API("/subadmin/license/list"), { headers: authH() })
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setLicenseKeys(data); })
      .catch(() => {});
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

  async function searchLicenseKey() {
    const key = searchKey.trim().toUpperCase();
    if (!key) return;
    setSearching(true); setFoundKey(null);
    try {
      const r = await fetch(API(`/subadmin/license/search?key=${encodeURIComponent(key)}`), { headers: authH() });
      if (r.ok) setFoundKey(await r.json());
      else toast({ title: "Key not found", description: "No licence key with that number found in your generated keys", variant: "destructive" });
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally { setSearching(false); }
  }

  async function addMinutesToKey() {
    if (!foundKey) return;
    const mins = parseInt(addMins);
    if (!mins || mins < 1) { toast({ title: "Enter valid minutes", variant: "destructive" }); return; }
    setAddingToKey(true);
    try {
      const r = await fetch(API(`/subadmin/license/${foundKey.id}/add-minutes`), {
        method: "POST", headers: authH(),
        body: JSON.stringify({ minutes: mins, note: addNote.trim() || undefined }),
      });
      const d = await r.json();
      if (r.ok) {
        toast({ title: `${mins} min added!`, description: `Key now has ${d.newMinutesAllocated} min · Your balance: ${d.subAdminBalanceRemaining} min remaining` });
        setAddMins(""); setAddNote(""); setFoundKey(null); setSearchKey(""); fetchAll();
      } else {
        toast({ title: "Failed", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally { setAddingToKey(false); }
  }

  async function handleGenerateLicenseKey() {
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
      toast({ title: "Key generated!", description: data.key });
      setGenMinutes(""); setGenNotes("");
      const meRes = await fetch(API("/subadmin/me"), { headers: authH() }).then(r => r.json());
      setMe(meRes);
      const licRes = await fetch(API("/subadmin/license/list"), { headers: authH() }).then(r => r.json());
      if (Array.isArray(licRes)) setLicenseKeys(licRes);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setIsGenerating(false); }
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
            <div className="text-xs text-muted-foreground mt-1">your licence keys active now</div>
          </div>
          <div className={card}>
            <div className="flex items-center gap-2 mb-2"><Clock className="w-4 h-4 text-blue-400" /><span className="text-xs text-muted-foreground font-bold uppercase tracking-wide">Recent</span></div>
            <div className="text-3xl font-bold font-mono text-blue-400">{recentSessions.length}</div>
            <div className="text-xs text-muted-foreground mt-1">recent sessions</div>
          </div>
        </div>

        {/* Minutes Overview card */}
        <div className={`${card} mb-0`}>
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold text-foreground">Minutes Overview</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-background rounded-lg p-3 border border-border text-center">
              <div className="text-2xl font-bold font-mono text-primary">{totalBalance}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Remaining Balance</div>
            </div>
            <div className="bg-background rounded-lg p-3 border border-border text-center">
              <div className="text-2xl font-bold font-mono text-cyan-400">{me.subAdminMinutesBalance}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Admin Allocated</div>
            </div>
            <div className="bg-background rounded-lg p-3 border border-border text-center">
              <div className="text-2xl font-bold font-mono text-green-400">{me.totalMinutesPurchased}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Self Purchased</div>
            </div>
            <div className="bg-background rounded-lg p-3 border border-border text-center">
              <div className="text-2xl font-bold font-mono text-purple-400">{licenseKeys.length}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Keys Generated</div>
            </div>
          </div>
          {totalBalance < 50 && (
            <div className="mt-3 p-2.5 rounded-lg bg-orange-500/10 border border-orange-500/25 flex items-center gap-2">
              <Coins className="w-4 h-4 text-orange-400 shrink-0" />
              <p className="text-xs text-orange-300">
                <span className="font-bold">Low balance:</span> Only {totalBalance} minutes remaining. Top up via the <button className="underline font-semibold" onClick={() => setTab("billing")}>Billing tab</button>.
              </p>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-card border border-border rounded-lg p-1 flex-wrap">
          {(["credit","sessions","activity","users","billing"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all ${tab===t?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground"}`}>
              {t === "credit" ? "Credit Licence Key" :
               t === "sessions" ? `Live (${sessions.length})` : t === "billing" ? "Top Up" :
               t === "users" ? `My Licence Keys (${myUsers.length || "..."})` : "Activity"}
            </button>
          ))}
        </div>

        {/* CREDIT LICENCE KEY */}
        {tab === "credit" && (
          <div className="space-y-4">
            <div className={card}>
              <h3 className="text-sm font-bold text-foreground mb-3">Find Licence Key by Key Number</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. ABCD-EFGH-IJKL-MNOP"
                  value={searchKey}
                  onChange={e => { setSearchKey(e.target.value); setFoundKey(null); }}
                  onKeyDown={e => e.key === "Enter" && searchLicenseKey()}
                  className="flex-1 h-10 rounded-lg border border-border bg-background text-sm px-3 text-foreground font-mono"
                />
                <Button className="gap-2" onClick={searchLicenseKey} disabled={searching || !searchKey.trim()}>
                  <Search className="w-4 h-4" />{searching ? "..." : "Search"}
                </Button>
              </div>
            </div>

            {foundKey && (
              <div className={card}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="font-bold text-foreground font-mono text-sm">{foundKey.key}</p>
                    {foundKey.notes && <p className="text-xs text-muted-foreground mt-0.5">{foundKey.notes}</p>}
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${foundKey.isActive ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                    {foundKey.isActive ? (foundKey.activatedAt ? "Activated" : "Unused") : "Revoked"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {[
                    { label: "Minutes Allocated", val: foundKey.minutesAllocated },
                    { label: "Activated", val: foundKey.activatedAt ? new Date(foundKey.activatedAt).toLocaleDateString() : "Not yet" },
                  ].map(s => (
                    <div key={s.label} className="bg-background rounded-lg p-3 border border-border text-center">
                      <div className="text-xl font-bold font-mono text-foreground">{s.val}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input type="number" min={1} max={totalBalance} placeholder={`Minutes to add (max ${totalBalance})`}
                      value={addMins} onChange={e => setAddMins(e.target.value)}
                      className="w-44 h-10 rounded-lg border border-border bg-background text-sm px-3 text-foreground" />
                    <input type="text" placeholder="Note (optional)" value={addNote} onChange={e => setAddNote(e.target.value)}
                      className="flex-1 h-10 rounded-lg border border-border bg-background text-sm px-3 text-foreground" />
                  </div>
                  <Button className="w-full gap-2" disabled={addingToKey || !addMins || totalBalance < 1} onClick={addMinutesToKey}>
                    <Zap className="w-4 h-4" />{addingToKey ? "Adding..." : `Add ${addMins || "?"} Minutes to Key`}
                  </Button>
                  {totalBalance < 1 && <p className="text-xs text-red-400 text-center">Your balance is empty — contact the admin to top up.</p>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* LIVE SESSIONS */}
        {tab === "sessions" && (
          <div className={card}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-foreground">Your Licence Keys — Live Sessions</h3>
              <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={fetchAll}><RefreshCw className="w-3 h-3" /> Refresh</Button>
            </div>
            {sessions.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">None of your licence keys are streaming right now.</p> : (
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
                <h3 className="text-sm font-bold text-foreground">Licence Keys You Created</h3>
              </div>
              <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={() => { setMyUsersLoaded(false); }}>
                <RefreshCw className="w-3 h-3" /> Refresh
              </Button>
            </div>
            {myUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">You haven't created any licence keys yet.</p>
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
            <h3 className="text-sm font-bold text-foreground mb-4">Your Licence Keys — Recent Sessions</h3>
            {recentSessions.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No recent activity from your licence keys.</p> : (
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

        {/* TOP UP */}
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

            {/* Available packages — read-only */}
            <div className={card}>
              <div className="flex items-center gap-2 mb-1">
                <CreditCard className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Sub Admin Packages</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">Available top-up packages for reference. See contact info below to request a top-up.</p>
              {tiers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No packages configured yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {tiers.map(tier => (
                    <div key={tier.id} className="p-3 rounded-lg border border-border bg-background">
                      <p className="font-bold text-foreground">{tier.minutes} min</p>
                      <p className="text-xs text-muted-foreground">${tier.priceUsdt} · {tier.label}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Contact admin notice */}
            <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 flex gap-3 items-start">
              <Coins className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-foreground mb-1">How to Top Up</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Top-ups are processed manually. To purchase more minutes, please <span className="text-primary font-semibold">contact the admin directly</span> outside the platform. Once payment is confirmed by the admin, your balance will be updated.
                </p>
              </div>
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
