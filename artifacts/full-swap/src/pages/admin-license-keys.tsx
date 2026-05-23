import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Key, Plus, Trash2, Unplug, Plug, RefreshCw, Copy, CheckCircle, XCircle, Clock, Monitor, Wifi, Repeat, ShieldAlert, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";

const API = (p: string) => `/api${p}`;
const token = () => localStorage.getItem("fullswap_admin_token") ?? localStorage.getItem("fullswap_token") ?? "";
const authH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token()}` });

type LicenseKey = {
  id: number; key: string; deviceId: string | null; isActive: boolean;
  activatedAt: string | null; expiresAt: string | null; createdAt: string;
  notes: string | null; minutesAllocated?: number; minutesCredited?: boolean;
  assignedApiKey?: string | null;
  usedSeconds?: number;
  remainingSeconds?: number;
  assignedDecartKeyId?: number | null;
  tokenWindowMinutes?: number | null;
};

type DeviceSecurityEvent = {
  id: number;
  licenseKey: string;
  eventType: "bound" | "blocked";
  attemptedDeviceId: string;
  boundDeviceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

type DecartApiKey = {
  id: number;
  label: string;
  isActive: boolean;
  assignedLicenseKeys: number;
  maxLicenseKeys: number | null;
};

type PricingTier = {
  id: number;
  label: string;
  minutes: number;
  credits: number;
  priceUsd: number;
  priceUsdt: number;
  priceGhs: number;
  planType: string;
};

function getStatus(lic: LicenseKey): string {
  if (!lic.isActive) return "revoked";
  if (lic.expiresAt && new Date(lic.expiresAt) < new Date()) return "expired";
  if (lic.deviceId) return "in_use";           // Bound to a specific device
  if (lic.minutesCredited) return "activated"; // Credited but not device-bound
  return "available";                          // Fresh, ready to use
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    in_use:    { label: "In Use",    cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
    activated: { label: "Activated", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    available: { label: "Available", cls: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
    unused:    { label: "Available", cls: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
    revoked:   { label: "Revoked",   cls: "bg-red-500/10 text-red-400 border-red-500/20" },
    expired:   { label: "Expired",   cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  };
  const { label, cls } = map[status] ?? map.available;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>{label}</span>;
}

function fmt(d: string | null): string {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminLicenseKeysPage() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<LicenseKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGen, setShowGen] = useState(false);
  const [genMinutes, setGenMinutes] = useState("60");
  const [genNotes, setGenNotes] = useState("");
  const [genExpiry, setGenExpiry] = useState("");
  const [genApiKeyId, setGenApiKeyId] = useState<number | null>(null);
  const [genPricingId, setGenPricingId] = useState<number | null>(null);
  // genTokenWindow removed — token window is now always set by the system default
  const [generating, setGenerating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [availableApis, setAvailableApis] = useState<DecartApiKey[]>([]);
  const [loadingApis, setLoadingApis] = useState(false);
  const [availablePricings, setAvailablePricings] = useState<PricingTier[]>([]);
  const [loadingPricings, setLoadingPricings] = useState(false);
  const [reassigningKey, setReassigningKey] = useState<string | null>(null);
  const [reassignTargetApi, setReassignTargetApi] = useState<number | null>(null);
  const [reassigning, setReassigning] = useState(false);
  const [bindingKey, setBindingKey] = useState<string | null>(null);
  const [bindDeviceId, setBindDeviceId] = useState("");
  const [binding, setBinding] = useState(false);
  const [securityEvents, setSecurityEvents] = useState<DeviceSecurityEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [showSecurityPanel, setShowSecurityPanel] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearingTokenWindows, setClearingTokenWindows] = useState(false);
  const [tokenWindowKey, setTokenWindowKey] = useState<LicenseKey | null>(null);
  const [tokenWindowInput, setTokenWindowInput] = useState("");
  const [savingTokenWindow, setSavingTokenWindow] = useState(false);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(API("/license/list"), { headers: authH() });
      if (res.ok) setKeys(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  const fetchSecurityEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const res = await fetch(API("/admin/device-security-events?limit=100"), { headers: authH() });
      if (res.ok) setSecurityEvents(await res.json());
    } catch {} finally { setLoadingEvents(false); }
  }, []);

  const handleClearTokenWindows = async () => {
    setClearingTokenWindows(true);
    try {
      const res = await fetch(API("/admin/token-window/bulk-clear"), {
        method: "DELETE",
        headers: authH(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to clear token windows");
      toast({ title: "Token windows cleared", description: data.message });
      setShowClearConfirm(false);
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to clear token windows",
        variant: "destructive",
      });
    } finally {
      setClearingTokenWindows(false);
    }
  };

  /** Returns the recommended token window in minutes for a given allocation. */
  function getRecommendedWindow(mins: number): number {
    if (mins <= 10) return 0.5;
    if (mins <= 20) return 1;
    if (mins <= 35) return 1.5;
    if (mins <= 50) return 2;
    if (mins <= 70) return 2.5;
    return 3;
  }

  const handleSetTokenWindow = async (minutes: number | null) => {
    if (!tokenWindowKey) return;
    setSavingTokenWindow(true);
    try {
      const res = await fetch(API(`/admin/token-window/key/${encodeURIComponent(tokenWindowKey.key)}`), {
        method: "PUT",
        headers: authH(),
        body: JSON.stringify({ minutes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update token window");
      toast({
        title: minutes === null ? "Token window cleared" : "Token window set",
        description: minutes === null
          ? `Key will now use the system default (30s hard cap).`
          : `Token window set to ${minutes} min (${Math.round(minutes * 60)}s).`,
      });
      setTokenWindowKey(null);
      setTokenWindowInput("");
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update token window",
        variant: "destructive",
      });
    } finally {
      setSavingTokenWindow(false);
    }
  };

  const fetchApis = useCallback(async () => {
    setLoadingApis(true);
    try {
      const res = await fetch(API("/admin/decart-keys"), { headers: authH() });
      if (res.ok) {
        const body = await res.json();
        // The endpoint returns { keys: [...] } — unwrap before filtering
        const keysArray: any[] = Array.isArray(body) ? body : (body.keys ?? []);
        setAvailableApis(
          keysArray
            .filter((a: any) => a.isActive)
            .map((a: any) => ({
              id: a.id,
              label: a.label,
              isActive: a.isActive,
              // API returns assignedLicenseKeyCount; map to the frontend field name
              assignedLicenseKeys: a.assignedLicenseKeyCount ?? a.assignedLicenseKeys ?? 0,
              // API returns maxUsers; map to the frontend field name
              maxLicenseKeys: a.maxUsers ?? a.maxLicenseKeys ?? null,
            }))
        );
      } else {
        toast({ title: "Failed to load API keys", description: `Status ${res.status} — check your admin session.`, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Failed to load API keys", description: err?.message ?? "Network error", variant: "destructive" });
    } finally { setLoadingApis(false); }
  }, [toast]);

  const fetchPricings = useCallback(async () => {
    setLoadingPricings(true);
    try {
      const res = await fetch(API("/pricing"), { headers: authH() });
      if (res.ok) {
        const allPricings = await res.json();
        setAvailablePricings(allPricings);
      }
    } catch {} finally { setLoadingPricings(false); }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  useEffect(() => {
    if (showSecurityPanel) fetchSecurityEvents();
  }, [showSecurityPanel, fetchSecurityEvents]);

  useEffect(() => {
    if (showGen) {
      fetchApis();
      fetchPricings();
    }
  }, [showGen, fetchApis, fetchPricings]);

  // FIX: Load available API keys when the Reassign dialog opens.
  // Previously fetchApis() was ONLY called when showGen changed (Generate dialog),
  // so opening the Reassign modal left availableApis empty — causing blank dropdown.
  useEffect(() => {
    if (reassigningKey !== null) fetchApis();
  }, [reassigningKey, fetchApis]);

  const handleGenerate = async () => {
    // tokenWindowMinutes validation removed — no longer sent




    if (!genApiKeyId) {
      toast({ title: "API Key required", description: "Select a Decart API key to assign to this licence key.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(API("/license/generate"), {
        method: "POST", headers: authH(),
        body: JSON.stringify({
          notes: genNotes || null,
          expiresAt: genExpiry || null,
          minutesAllocated: parseFloat(genMinutes) || 0,
          decartApiKeyId: genApiKeyId || undefined,
          pricingId: genPricingId || undefined,
          // tokenWindowMinutes not sent — system default (30s) used
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.message ?? data.error ?? "Unknown error";
        throw new Error(msg);
      }
      setNewKey(data.key);
      toast({ title: "License Key Generated", description: data.key });
      setGenNotes(""); setGenExpiry(""); setGenMinutes("60"); setGenApiKeyId(null); setGenPricingId(null);
      await fetchKeys();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setGenerating(false); }
  };

  const handleReassign = async () => {
    if (!reassigningKey || reassignTargetApi === null) return;
    setReassigning(true);
    try {
      const res = await fetch(API(`/license/${reassigningKey}/reassign`), {
        method: "PATCH",
        headers: authH(),
        body: JSON.stringify({ decartApiKeyId: reassignTargetApi || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reassign");
      toast({ title: "License Reassigned", description: `Key reassigned to selected API` });
      setReassigningKey(null);
      setReassignTargetApi(null);
      await fetchKeys();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setReassigning(false); }
  };

  const handleBind = async () => {
    if (!bindingKey || !bindDeviceId.trim()) return;
    setBinding(true);
    try {
      const res = await fetch(API(`/license/${bindingKey}/bind`), {
        method: "PATCH",
        headers: authH(),
        body: JSON.stringify({ deviceId: bindDeviceId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to bind device");
      toast({ title: "Device Bound", description: `Device bound to key ${bindingKey}` });
      setBindingKey(null);
      setBindDeviceId("");
      await fetchKeys();
    } catch (e: any) {
      toast({ title: "Bind Failed", description: e.message, variant: "destructive" });
    } finally { setBinding(false); }
  };

  // FIX: deleted keys no longer reappear — removed fetchKeys() from outside the if-block.
  // The setKeys filter immediately removes the key from state; no re-fetch needed.
  const handleDelete = async (key: string, hasDevice: boolean, hasBalance: boolean) => {
    const deviceWarn  = hasDevice  ? "\n\u26a0 This key is currently bound to a device." : "";
    const balanceWarn = hasBalance ? "\n\u26a0 This key still has streaming minutes remaining." : "";
    if (!confirm(`Permanently delete license key ${key}?${deviceWarn}${balanceWarn}\n\nThis cannot be undone.`)) return;
    const res = await fetch(API(`/license/${key}`), { method: "DELETE", headers: authH() });
    if (res.ok) {
      // Immediately remove from local state — key will not reappear
      setKeys(prev => prev.filter(k => k.key !== key));
      if (newKey === key) setNewKey(null);
      toast({ title: "Key Deleted", description: "License key permanently removed." });
    } else {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Delete failed", description: body.error ?? "Could not delete the key.", variant: "destructive" });
    }
  };

  // FIX: unlink updates local state immediately — no full re-fetch needed
  const handleUnbind = async (key: string, deviceId: string) => {
    if (!confirm(`Unlink device "${deviceId.slice(0, 16)}\u2026" from key ${key}?\n\nThe key will become available for activation on a new device.`)) return;
    const res = await fetch(API(`/license/${key}/unbind`), { method: "DELETE", headers: authH() });
    if (res.ok) {
      setKeys(prev => prev.map(k => k.key === key ? { ...k, deviceId: null, activatedAt: null } : k));
      toast({ title: "Device Unlinked", description: "Key is now available for a new device." });
    } else {
      toast({ title: "Unlink failed", description: "Could not unlink the device.", variant: "destructive" });
    }
  };

  const copyKey = (k: string) => { navigator.clipboard.writeText(k); setCopiedKey(k); setTimeout(() => setCopiedKey(null), 2000); };

  const total     = keys.length;
  const inUse     = keys.filter(k => !!k.deviceId && k.isActive).length;
  const available = keys.filter(k => !k.deviceId && k.isActive && !(k.expiresAt && new Date(k.expiresAt) < new Date())).length;
  const revoked   = keys.filter(k => !k.isActive).length;

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-wide flex items-center gap-2">
              <Key className="w-6 h-6 text-primary" /> License Keys
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">Generate, track and manage license keys — admin only</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchKeys} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowClearConfirm(true)}
              disabled={clearingTokenWindows}
              className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
            >
              <XCircle className="w-4 h-4 mr-2" /> Clear Token Windows
            </Button>
            <Button size="sm" onClick={() => { setShowGen(true); setNewKey(null); setGenApiKeyId(null); }} style={{ boxShadow: "0 0 16px hsl(187 100% 52% / 0.25)" }}>
              <Plus className="w-4 h-4 mr-2" /> Generate Key
            </Button>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total",     value: total,     icon: Key,     color: "text-primary"    },
            { label: "In Use",    value: inUse,     icon: Wifi,    color: "text-orange-400" },
            { label: "Available", value: available, icon: Clock,   color: "text-sky-400"    },
            { label: "Revoked",   value: revoked,   icon: XCircle, color: "text-red-400"    },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl p-4" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 11%)" }}>
              <Icon className={`w-4 h-4 ${color} mb-1`} />
              <p className="text-2xl font-bold text-foreground font-mono">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
          <Table>
            <TableHeader>
              <TableRow style={{ background: "hsl(222 44% 6%)" }}>
                <TableHead className="text-muted-foreground font-mono text-xs">Key</TableHead>
                <TableHead className="text-muted-foreground font-mono text-xs">Status</TableHead>
                <TableHead className="text-muted-foreground font-mono text-xs hidden md:table-cell">Assigned API</TableHead>
                <TableHead className="text-muted-foreground font-mono text-xs hidden md:table-cell">Allocated</TableHead>
                <TableHead className="text-muted-foreground font-mono text-xs hidden md:table-cell">Used</TableHead>
                <TableHead className="text-muted-foreground font-mono text-xs hidden md:table-cell">Remaining</TableHead>
                <TableHead className="text-muted-foreground font-mono text-xs hidden md:table-cell">Device</TableHead>
                <TableHead className="text-muted-foreground font-mono text-xs hidden lg:table-cell">Created</TableHead>
                <TableHead className="text-muted-foreground font-mono text-xs hidden lg:table-cell">Notes</TableHead>
                <TableHead className="text-muted-foreground font-mono text-xs text-right">Admin Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />Loading...
                </TableCell></TableRow>
              ) : keys.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                  <Key className="w-8 h-8 mx-auto mb-3 opacity-30" />No license keys yet.
                </TableCell></TableRow>
              ) : keys.map(lk => {
                const status = getStatus(lk);
                const hasBalance = (lk.remainingSeconds ?? 0) > 0;
                return (
                  <TableRow key={lk.id} className={newKey === lk.key ? "bg-primary/5" : ""} style={{ borderColor: "hsl(222 40% 11%)" }}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-foreground tracking-wider">{lk.key}</span>
                        <button onClick={() => copyKey(lk.key)} className="text-muted-foreground hover:text-primary cursor-pointer">
                          {copiedKey === lk.key ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={status} /></TableCell>
                    <TableCell className="hidden md:table-cell">
                      {lk.assignedApiKey ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">{lk.assignedApiKey}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">None</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell font-mono text-sm">
                      <span className="text-primary">{lk.minutesAllocated ?? 0} min</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell font-mono text-sm">
                      {lk.usedSeconds !== undefined
                        ? `${Math.round((lk.usedSeconds / 60) * 100) / 100} min`
                        : "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell font-mono text-sm">
                      {lk.remainingSeconds !== undefined
                        ? `${Math.max(0, Math.round((lk.remainingSeconds / 60) * 100) / 100)} min`
                        : "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs">
                      {lk.deviceId ? (
                        <span className="flex items-center gap-1 text-orange-400 font-mono">
                          <Monitor className="w-3 h-3 flex-shrink-0" />{lk.deviceId.slice(0, 14)}&hellip;
                        </span>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{fmt(lk.createdAt)}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground truncate max-w-32">{lk.notes || "&mdash;"}</TableCell>
                    <TableCell className="text-right">
                      {/* Reassign API — allow reassignment to another Decart API */}
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => { setReassigningKey(lk.key); setReassignTargetApi(lk.assignedDecartKeyId ?? null); }}
                        className="h-7 px-2 text-cyan-400 hover:bg-cyan-400/10"
                        title="Reassign this license to a different API"
                      >
                        <Repeat className="w-3.5 h-3.5" />
                      </Button>
                      {/* Bind device — always shown; disabled when key already has a device */}
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => { if (!lk.deviceId) { setBindingKey(lk.key); setBindDeviceId(""); } }}
                        className={`h-7 px-2 ${lk.deviceId ? "text-muted-foreground opacity-40 cursor-not-allowed" : "text-emerald-400 hover:bg-emerald-400/10"}`}
                        title={lk.deviceId ? "Already bound — unbind first" : "Bind a device to this key"}
                        disabled={!!lk.deviceId}
                      >
                        <Plug className="w-3.5 h-3.5" />
                      </Button>
                      {/* Unbind device — always shown; disabled when no device is bound */}
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => { if (lk.deviceId) handleUnbind(lk.key, lk.deviceId); }}
                        className={`h-7 px-2 ${lk.deviceId && lk.isActive ? "text-amber-400 hover:bg-amber-400/10" : "text-muted-foreground opacity-40 cursor-not-allowed"}`}
                        title={lk.deviceId ? "Unbind device from this key" : "No device bound"}
                        disabled={!lk.deviceId || !lk.isActive}
                      >
                        <Unplug className="w-3.5 h-3.5" />
                      </Button>
                      {/* Token Window — set per-key override */}
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => { setTokenWindowKey(lk); setTokenWindowInput(lk.tokenWindowMinutes != null ? String(lk.tokenWindowMinutes) : ""); }}
                        className="h-7 px-2 text-sky-400 hover:bg-sky-400/10"
                        title={lk.tokenWindowMinutes != null ? `Token window: ${lk.tokenWindowMinutes} min — click to change` : "Set token window override"}
                      >
                        <Clock className="w-3.5 h-3.5" />
                      </Button>
                      {/* Delete — admin only, works even with remaining balance */}
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => handleDelete(lk.key, !!lk.deviceId, hasBalance)}
                        className="h-7 px-2 text-red-400 hover:bg-red-400/10"
                        title="Permanently delete this key (admin only)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Device Security Events Panel */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(222 40% 11%)" }}>
        <button
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-foreground hover:bg-white/5 transition-colors"
          style={{ background: "hsl(222 44% 6%)" }}
          onClick={() => setShowSecurityPanel(v => !v)}
        >
          <span className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            Device Security Events
            {securityEvents.filter(e => e.eventType === "blocked").length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                {securityEvents.filter(e => e.eventType === "blocked").length} blocked
              </span>
            )}
          </span>
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="text-xs font-normal">License key → device mapping &amp; violation log</span>
            {showSecurityPanel ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </button>

        {showSecurityPanel && (
          <div className="border-t" style={{ borderColor: "hsl(222 40% 11%)" }}>
            <div className="flex items-center justify-between px-4 py-2" style={{ background: "hsl(222 47% 4%)" }}>
              <p className="text-xs text-muted-foreground font-mono">Last 100 events · newest first</p>
              <Button variant="ghost" size="sm" onClick={fetchSecurityEvents} disabled={loadingEvents} className="h-6 px-2 text-xs">
                <RefreshCw className={`w-3 h-3 mr-1 ${loadingEvents ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow style={{ background: "hsl(222 44% 6%)" }}>
                  <TableHead className="text-muted-foreground font-mono text-xs">Event</TableHead>
                  <TableHead className="text-muted-foreground font-mono text-xs">License Key</TableHead>
                  <TableHead className="text-muted-foreground font-mono text-xs">Attempted Device</TableHead>
                  <TableHead className="text-muted-foreground font-mono text-xs hidden md:table-cell">Bound Device</TableHead>
                  <TableHead className="text-muted-foreground font-mono text-xs hidden lg:table-cell">IP</TableHead>
                  <TableHead className="text-muted-foreground font-mono text-xs hidden lg:table-cell">User Agent</TableHead>
                  <TableHead className="text-muted-foreground font-mono text-xs">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingEvents ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1" />Loading...
                  </TableCell></TableRow>
                ) : securityEvents.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <ShieldCheck className="w-6 h-6 mx-auto mb-2 text-emerald-400 opacity-60" />
                    No security events yet. Events are logged when devices bind or are blocked.
                  </TableCell></TableRow>
                ) : securityEvents.map(ev => (
                  <TableRow key={ev.id} style={{ borderColor: "hsl(222 40% 11%)" }}>
                    <TableCell>
                      {ev.eventType === "blocked" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border bg-red-500/10 text-red-400 border-red-500/20">
                          <ShieldAlert className="w-3 h-3" /> BLOCKED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                          <ShieldCheck className="w-3 h-3" /> BOUND
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-primary">{ev.licenseKey}</TableCell>
                    <TableCell className="font-mono text-xs text-foreground">{ev.attemptedDeviceId.slice(0, 20)}{ev.attemptedDeviceId.length > 20 ? "…" : ""}</TableCell>
                    <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">
                      {ev.boundDeviceId ? `${ev.boundDeviceId.slice(0, 16)}…` : "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">{ev.ipAddress ?? "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-48 truncate" title={ev.userAgent ?? ""}>
                      {ev.userAgent ? ev.userAgent.slice(0, 40) + (ev.userAgent.length > 40 ? "…" : "") : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(ev.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Generate Dialog */}
      <Dialog open={showGen} onOpenChange={setShowGen}>
        <DialogContent style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground"><Key className="w-5 h-5 text-primary" />Generate License Key</DialogTitle>
          </DialogHeader>
          {newKey ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Key generated. Copy it now &mdash; it will not be shown again.</p>
              <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(187 100% 52% / 0.3)" }}>
                <span className="font-mono text-primary text-sm flex-1 tracking-widest">{newKey}</span>
                <button onClick={() => copyKey(newKey)} className="text-muted-foreground hover:text-primary cursor-pointer">
                  {copiedKey === newKey ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <Button className="w-full" onClick={() => setShowGen(false)}>Done</Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">Pricing Package (for financial tracking)</label>
                {loadingPricings ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading packages...
                  </div>
                ) : (
                  <select
                    value={genPricingId ?? ""}
                    onChange={e => setGenPricingId(e.target.value ? parseInt(e.target.value) : null)}
                    style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)", color: "hsl(var(--foreground))", padding: "0.5rem 0.75rem", borderRadius: "0.375rem" }}
                    className="w-full text-sm"
                  >
                    <option value="">— Select a package —</option>
                    {availablePricings.map(pkg => (
                      <option key={pkg.id} value={pkg.id}>
                        {pkg.label} — {pkg.minutes} min @ ${pkg.priceUsd}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-muted-foreground mt-1">Links revenue and costs for analytics. Financial transaction is auto-recorded.</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">Minutes to allocate <span className="text-xs opacity-60">(decimals ok, e.g. 0.5 = 30s)</span></label>
                <div className="flex items-center gap-2">
                  <Input type="number" min="0" step="0.5" value={genMinutes} onChange={e => setGenMinutes(e.target.value)}
                    style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)" }} />
                  <span className="text-sm text-muted-foreground font-mono">min</span>
                </div>
              </div>























              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">Decart API <span className="text-xs text-red-400 font-semibold">*required</span></label>
                {loadingApis ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading APIs...
                  </div>
                ) : (
                  <select
                    value={genApiKeyId ?? ""}
                    onChange={e => setGenApiKeyId(e.target.value ? parseInt(e.target.value) : null)}
                    style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)", color: "hsl(var(--foreground))", padding: "0.5rem 0.75rem", borderRadius: "0.375rem" }}
                    className="w-full text-sm"
                  >
                    <option value="">Auto-assign (first active API)</option>
                    {availableApis.map(api => (
                      <option key={api.id} value={api.id}>
                        {api.label} ({api.assignedLicenseKeys}/{api.maxLicenseKeys || "unlimited"})
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-muted-foreground mt-1">Select which Decart API this license should use, or leave blank to auto-assign.</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">Notes (optional)</label>
                <Input value={genNotes} onChange={e => setGenNotes(e.target.value)} placeholder="Customer name, order..."
                  style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)" }} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">Expiry (optional)</label>
                <Input type="datetime-local" value={genExpiry} onChange={e => setGenExpiry(e.target.value)}
                  style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)" }} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowGen(false)}>Cancel</Button>
                <Button onClick={handleGenerate} disabled={generating} style={{ boxShadow: "0 0 16px hsl(187 100% 52% / 0.25)" }}>
                  {generating ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  {generating ? "Generating..." : "Generate"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reassign Dialog */}
      <Dialog open={reassigningKey !== null} onOpenChange={(open) => { if (!open) { setReassigningKey(null); setReassignTargetApi(null); } }}>
        <DialogContent style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground"><Repeat className="w-5 h-5 text-cyan-400" />Reassign License to API</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Select a new Decart API to assign this license to.</p>
            <div>
              <label className="text-sm text-muted-foreground mb-2 block font-medium">Target Decart API</label>
              {loadingApis ? (
                <div className="flex items-center justify-center py-6 text-muted-foreground">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading APIs...
                </div>
              ) : (
                <select
                  value={reassignTargetApi ?? ""}
                  onChange={e => setReassignTargetApi(e.target.value ? parseInt(e.target.value) : null)}
                  style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)", color: "hsl(var(--foreground))", padding: "0.5rem 0.75rem", borderRadius: "0.375rem" }}
                  className="w-full text-sm"
                >
                  <option value="">Select an API...</option>
                  {availableApis.map(api => (
                    <option key={api.id} value={api.id}>
                      {api.label} ({api.assignedLicenseKeys}/{api.maxLicenseKeys || "unlimited"})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReassigningKey(null)}>Cancel</Button>
              <Button onClick={handleReassign} disabled={reassigning || reassignTargetApi === null} style={{ boxShadow: "0 0 16px hsl(187 100% 52% / 0.25)" }}>
                {reassigning ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Repeat className="w-4 h-4 mr-2" />}
                {reassigning ? "Reassigning..." : "Reassign"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bind Device Dialog */}
      <Dialog open={bindingKey !== null} onOpenChange={(open) => { if (!open) { setBindingKey(null); setBindDeviceId(""); } }}>
        <DialogContent style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground"><Plug className="w-5 h-5 text-emerald-400" />Bind Device to License</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Enter the device ID to bind to license key <span className="font-mono text-primary">{bindingKey}</span>. Once bound, this key is locked to that device.</p>
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block font-medium">Device ID</label>
              <Input
                value={bindDeviceId}
                onChange={e => setBindDeviceId(e.target.value)}
                placeholder="e.g. device-uuid-1234"
                style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 16%)" }}
              />
              <p className="text-xs text-muted-foreground mt-1">Use Unbind to release the key and allow a different device to activate it.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBindingKey(null)}>Cancel</Button>
              <Button onClick={handleBind} disabled={binding || !bindDeviceId.trim()} style={{ boxShadow: "0 0 16px hsl(140 100% 40% / 0.25)" }}>
                {binding ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Plug className="w-4 h-4 mr-2" />}
                {binding ? "Binding..." : "Bind Device"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Clear Token Windows Confirm Dialog ─────────────────────────── */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <ShieldAlert className="w-5 h-5 text-amber-400" /> Clear Token Window Overrides
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>This will set <span className="text-foreground font-semibold">token_window_minutes</span> to <span className="text-foreground font-semibold">NULL</span> on every license key.</p>
            <p>All keys immediately fall back to the system default <span className="text-foreground font-semibold">(30-second hard cap)</span>. This cannot be undone.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowClearConfirm(false)} disabled={clearingTokenWindows}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleClearTokenWindows}
              disabled={clearingTokenWindows}
              className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
            >
              {clearingTokenWindows
                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Clearing...</>
                : <><XCircle className="w-4 h-4 mr-2" />Yes, Clear All</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Per-Key Token Window Override Dialog ───────────────────────────── */}
      <Dialog open={!!tokenWindowKey} onOpenChange={open => { if (!open) { setTokenWindowKey(null); setTokenWindowInput(""); } }}>
        <DialogContent style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.2)", maxWidth: 520 }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Clock className="w-5 h-5 text-sky-400" /> Token Window Override
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {tokenWindowKey && (
              <>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
                  <Key className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <span className="text-primary tracking-widest truncate">{tokenWindowKey.key}</span>
                  <span className="ml-auto text-muted-foreground flex-shrink-0">{tokenWindowKey.minutesAllocated ?? 0} min allocated</span>
                </div>

                {/* ── Recommendation Chart ──────────────────────────────────── */}
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Recommended token window by allocation — shorter windows cost fewer credits when a session freezes.
                  </p>
                  <svg viewBox="0 0 400 210" className="w-full" style={{ height: 185 }}>
                    {/* Grid lines + Y labels */}
                    {([0, 30, 60, 90, 120, 150, 180] as number[]).map(s => {
                      const y = 162 - (s / 180) * 140;
                      return (
                        <g key={s}>
                          <text x="33" y={y + 4} textAnchor="end" fontSize="9" fill="#6b7280">{s}s</text>
                          <line x1="36" y1={y} x2="392" y2={y} stroke="#1f2937" strokeWidth="0.8" />
                        </g>
                      );
                    })}
                    {/* X axis baseline */}
                    <line x1="36" y1="162" x2="392" y2="162" stroke="#4b5563" strokeWidth="1" />
                    {/* Recommendation bars */}
                    {([
                      { xMin: 0,  xMax: 10,  secs: 30,  color: "#10b981", label: "30s" },
                      { xMin: 10, xMax: 20,  secs: 60,  color: "#06b6d4", label: "60s" },
                      { xMin: 20, xMax: 35,  secs: 90,  color: "#eab308", label: "90s" },
                      { xMin: 35, xMax: 50,  secs: 120, color: "#f97316", label: "2m" },
                      { xMin: 50, xMax: 70,  secs: 150, color: "#f87171", label: "2.5m" },
                      { xMin: 70, xMax: 100, secs: 180, color: "#ef4444", label: "3m" },
                    ] as { xMin:number;xMax:number;secs:number;color:string;label:string }[]).map(({ xMin, xMax, secs, color, label }) => {
                      const chartW = 356;
                      const x = 36 + (xMin / 100) * chartW;
                      const w = ((xMax - xMin) / 100) * chartW - 1;
                      const h = (secs / 180) * 140;
                      const y = 162 - h;
                      const alloc = tokenWindowKey.minutesAllocated ?? 0;
                      const isActive = alloc > xMin && alloc <= xMax;
                      return (
                        <g key={xMin}>
                          <rect x={x} y={y} width={w} height={h} fill={color} opacity={isActive ? 0.85 : 0.3} rx="2" />
                          {isActive && <rect x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeWidth="1.5" rx="2" />}
                          <text x={x + w / 2} y={y - 5} textAnchor="middle" fontSize={isActive ? "10" : "8"} fontWeight={isActive ? "bold" : "normal"} fill={color} opacity={isActive ? 1 : 0.7}>{label}</text>
                        </g>
                      );
                    })}
                    {/* Current allocation marker line */}
                    {(tokenWindowKey.minutesAllocated ?? 0) > 0 && (tokenWindowKey.minutesAllocated ?? 0) <= 100 && (
                      <>
                        <line
                          x1={36 + ((tokenWindowKey.minutesAllocated ?? 0) / 100) * 356}
                          y1={18} x2={36 + ((tokenWindowKey.minutesAllocated ?? 0) / 100) * 356} y2={162}
                          stroke="#60a5fa" strokeWidth="1.5" strokeDasharray="3,2"
                        />
                        <text
                          x={Math.min(36 + ((tokenWindowKey.minutesAllocated ?? 0) / 100) * 356 + 3, 370)}
                          y={14} fontSize="9" fill="#60a5fa" fontWeight="bold"
                        >{tokenWindowKey.minutesAllocated}m</text>
                      </>
                    )}
                    {/* X axis labels */}
                    {([0, 10, 20, 35, 50, 70, 100] as number[]).map(m => (
                      <text key={m} x={36 + (m / 100) * 356} y={178} textAnchor="middle" fontSize="9" fill="#6b7280">{m}</text>
                    ))}
                    <text x={214} y={196} textAnchor="middle" fontSize="9" fill="#4b5563">Minutes Allocated</text>
                  </svg>
                  {/* Recommended value callout */}
                  <div className="mt-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
                    <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span className="text-muted-foreground">Recommended for <span className="text-foreground font-semibold">{tokenWindowKey.minutesAllocated ?? 0} min</span>:</span>
                    <span className="text-emerald-400 font-bold font-mono ml-auto">{getRecommendedWindow(tokenWindowKey.minutesAllocated ?? 0)} min ({Math.round(getRecommendedWindow(tokenWindowKey.minutesAllocated ?? 0) * 60)}s)</span>
                    <button
                      className="text-xs text-primary underline cursor-pointer hover:text-primary/80 flex-shrink-0"
                      onClick={() => setTokenWindowInput(String(getRecommendedWindow(tokenWindowKey.minutesAllocated ?? 0)))}
                    >Use</button>
                  </div>
                </div>

                {/* ── Input ──────────────────────────────────────────────────── */}
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">Custom override (minutes, 0.5–480) — leave blank to use system default</label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={0.5} max={480} step={0.5}
                      placeholder={`Recommended: ${getRecommendedWindow(tokenWindowKey.minutesAllocated ?? 0)} min`}
                      value={tokenWindowInput}
                      onChange={e => setTokenWindowInput(e.target.value)}
                      className="flex-1 font-mono"
                      style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 18%)" }}
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        const v = parseFloat(tokenWindowInput);
                        if (isNaN(v) || v < 0.5 || v > 480) {
                          toast({ title: "Invalid value", description: "Enter a number between 0.5 and 480.", variant: "destructive" });
                          return;
                        }
                        handleSetTokenWindow(v);
                      }}
                      disabled={savingTokenWindow || !tokenWindowInput.trim()}
                      className="shrink-0"
                    >
                      {savingTokenWindow ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Save"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline" size="sm"
              onClick={() => handleSetTokenWindow(null)}
              disabled={savingTokenWindow}
              className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
            >
              <XCircle className="w-3.5 h-3.5 mr-1.5" /> Clear Override
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setTokenWindowKey(null); setTokenWindowInput(""); }} disabled={savingTokenWindow}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
