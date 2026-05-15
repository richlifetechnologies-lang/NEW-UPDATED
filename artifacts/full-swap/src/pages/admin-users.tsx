import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Search, Edit2, Check, X, Trash2, Gift, Copy, Unlink, Monitor } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface LicenseKey {
  id: number;
  key: string;
  isActive: boolean;
  activatedAt: string | null;
  expiresAt: string | null;
  minutesAllocated: number;
  minutesUsed: number;
  minutesRemaining: number;
  deviceId: string | null;
  notes: string | null;
  createdAt: string;
}

export default function AdminUsersPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<{ minutesAllocated: number; isActive: boolean; expiresAt: string; notes: string }>({ 
    minutesAllocated: 0, 
    isActive: true, 
    expiresAt: "",
    notes: ""
  });
  const [creditKeyId, setCreditKeyId] = useState<number | null>(null);
  const [creditKey, setCreditKey] = useState("");
  const [creditMinutes, setCreditMinutes] = useState("10");
  const [deleteKeyId, setDeleteKeyId] = useState<number | null>(null);
  const [deleteKey, setDeleteKey] = useState("");
  const [licenses, setLicenses] = useState<LicenseKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const token = localStorage.getItem("fullswap_admin_token");

  useEffect(() => {
    if (!token) {
      setLocation("/admin");
    }
  }, [setLocation, token]);

  const fetchLicenses = async () => {
    try {
      const res = await fetch("/api/admin/license-keys", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLicenses(data);
      }
    } catch (err) {
      console.error("Failed to fetch licenses:", err);
      toast({ title: "Failed to load license keys", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchLicenses();
    }
  }, [token]);

  const filtered = licenses.filter(l => {
    const matchesSearch = l.key.toLowerCase().includes(search.toLowerCase()) || 
      (l.notes?.toLowerCase().includes(search.toLowerCase()) || false);
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? l.isActive : !l.isActive);
    return matchesSearch && matchesStatus;
  });

  const startEdit = (license: LicenseKey) => {
    setEditingId(license.id);
    setEditData({
      minutesAllocated: license.minutesAllocated,
      isActive: license.isActive,
      expiresAt: license.expiresAt?.split('T')[0] || "",
      notes: license.notes || ""
    });
  };

  const saveEdit = async (keyId: number) => {
    try {
      const res = await fetch(`/api/admin/license-keys/${keyId}`, {
        method: "PATCH",
        headers: { 
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          minutesAllocated: editData.minutesAllocated,
          isActive: editData.isActive,
          expiresAt: editData.expiresAt || null,
          notes: editData.notes || null
        }),
      });

      if (res.ok) {
        toast({ title: "License key updated" });
        setEditingId(null);
        await fetchLicenses();
      } else {
        toast({ title: "Update failed", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  const deleteKeyMutation = async (keyId: number) => {
    try {
      const res = await fetch(`/api/admin/license-keys/${keyId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        toast({ title: "License key deleted" });
        setDeleteKeyId(null);
        await fetchLicenses();
      } else {
        toast({ title: "Delete failed", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const creditKeyMutation = async () => {
    if (creditKeyId === null || !creditMinutes) return;

    try {
      const res = await fetch(`/api/admin/license-keys/${creditKeyId}/credit`, {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ minutes: parseInt(creditMinutes) }),
      });

      if (res.ok) {
        const data = await res.json();
        toast({ title: `Credited ${data.creditedMinutes} min`, description: `New total: ${data.newTotal} min` });
        setCreditKeyId(null);
        setCreditMinutes("10");
        await fetchLicenses();
      } else {
        toast({ title: "Credit failed", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Credit failed", variant: "destructive" });
    }
  };

  const unbindDevice = async (licenseKey: string) => {
    try {
      const res = await fetch(`/api/license/${encodeURIComponent(licenseKey)}/unbind`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast({ title: "Device unbound", description: "The key can now be activated on a new device." });
        await fetchLicenses();
      } else {
        const data = await res.json().catch(() => ({}));
        toast({ title: "Unbind failed", description: data.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Unbind failed", variant: "destructive" });
    }
  };

  // Auto-refresh every 10 s so device bindings appear immediately when a user activates a key
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(fetchLicenses, 10_000);
    return () => clearInterval(interval);
  }, [token]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const statusColors: Record<string, string> = {
    active: "bg-green-500/20 text-green-400",
    inactive: "bg-red-500/20 text-red-400",
  };

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-6" data-testid="admin-users-page">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Licensed Keys</h1>
            <p className="text-muted-foreground mt-1">
              {filtered.length} of {licenses.length} keys
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              data-testid="select-status-filter"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-card border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input 
                data-testid="input-search-licenses" 
                value={search} 
                onChange={e => setSearch(e.target.value)} 
                placeholder="Search by key or notes..." 
                className="pl-9 w-full sm:w-64 bg-card border-border" 
              />
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="p-8 space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-background/50">
                    <th className="text-left p-4 text-muted-foreground font-medium">License Key</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Status</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Minutes</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Remaining</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Used</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Device Binding</th>
                    <th className="text-right p-4 text-muted-foreground font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((license) => (
                    <tr key={license.id} data-testid={`license-row-${license.id}`} className="border-b border-border last:border-0 hover:bg-accent/5">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div>
                            <p className="font-medium text-foreground font-mono text-xs cursor-pointer hover:text-primary" onClick={() => copyToClipboard(license.key)}>
                              {license.key.slice(0, 8)}…{license.key.slice(-4)}
                            </p>
                            {license.notes && <p className="text-xs text-muted-foreground mt-1">{license.notes}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        {editingId === license.id ? (
                          <select
                            value={editData.isActive ? "active" : "inactive"}
                            onChange={e => setEditData(d => ({ ...d, isActive: e.target.value === "active" }))}
                            className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground"
                            data-testid={`select-status-${license.id}`}
                          >
                            <option value="active">active</option>
                            <option value="inactive">inactive</option>
                          </select>
                        ) : (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[license.isActive ? "active" : "inactive"]}`}>
                            {license.isActive ? "active" : "inactive"}
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        {editingId === license.id ? (
                          <Input
                            type="number"
                            min="0"
                            value={editData.minutesAllocated}
                            onChange={e => setEditData(d => ({ ...d, minutesAllocated: parseInt(e.target.value) || 0 }))}
                            className="w-20 h-7 text-xs bg-background border-border"
                            data-testid={`input-minutes-${license.id}`}
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-foreground">{license.minutesAllocated}</span>
                            <button
                              data-testid={`button-credit-inline-${license.id}`}
                              title="Credit minutes"
                              className="w-5 h-5 rounded flex items-center justify-center text-teal-400 hover:bg-teal-500/15 transition-colors"
                              onClick={() => { setCreditKeyId(license.id); setCreditKey(license.key); setCreditMinutes("10"); }}
                            >
                              <Gift className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        <span className={`font-mono font-semibold ${license.minutesRemaining > 0 ? "text-green-400" : "text-red-400"}`}>
                          {license.minutesRemaining.toFixed(2)}
                        </span>
                      </td>
                      <td className="p-4 font-mono text-muted-foreground">{license.minutesUsed.toFixed(2)}</td>
                      <td className="p-4">
                        {license.deviceId ? (
                          <div className="flex items-start gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/20">
                                  <Monitor className="w-2.5 h-2.5" />
                                  BOUND
                                </span>
                              </div>
                              <p className="font-mono text-xs text-foreground/70 truncate" title={license.deviceId}>
                                {license.deviceId.slice(0, 8)}…{license.deviceId.slice(-4)}
                              </p>
                              {license.activatedAt && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {new Date(license.activatedAt).toLocaleString()}
                                </p>
                              )}
                            </div>
                            <button
                              title="Unbind device — admin only"
                              className="flex-shrink-0 mt-0.5 p-1 rounded text-orange-400 hover:bg-orange-500/15 hover:text-orange-300 transition-colors"
                              onClick={() => unbindDevice(license.key)}
                            >
                              <Unlink className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-muted-foreground bg-muted/40 border border-border">
                            No device
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        {editingId === license.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button 
                              data-testid={`button-save-${license.id}`} 
                              size="sm" 
                              onClick={() => saveEdit(license.id)}
                            >
                              <Check className="w-3 h-3" />
                            </Button>
                            <Button 
                              data-testid={`button-cancel-${license.id}`} 
                              size="sm" 
                              variant="ghost" 
                              onClick={() => setEditingId(null)}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <Button 
                              data-testid={`button-edit-${license.id}`} 
                              size="sm" 
                              variant="ghost" 
                              onClick={() => startEdit(license)}
                            >
                              <Edit2 className="w-3 h-3" />
                            </Button>
                            <Button
                              data-testid={`button-credit-${license.id}`}
                              size="sm"
                              variant="ghost"
                              title="Credit minutes"
                              className="text-teal-400 hover:text-teal-400 hover:bg-teal-500/10"
                              onClick={() => { setCreditKeyId(license.id); setCreditKey(license.key); setCreditMinutes("10"); }}
                            >
                              <Gift className="w-3 h-3" />
                            </Button>
                            <Button
                              data-testid={`button-copy-${license.id}`}
                              size="sm"
                              variant="ghost"
                              title="Copy key"
                              onClick={() => copyToClipboard(license.key)}
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                            <Button
                              data-testid={`button-delete-${license.id}`}
                              size="sm"
                              variant="ghost"
                              title="Delete key"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => { setDeleteKeyId(license.id); setDeleteKey(license.key); }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm">No license keys found</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Credit Minutes Dialog */}
      <Dialog open={creditKeyId !== null} onOpenChange={(open) => { if (!open) { setCreditKeyId(null); setCreditMinutes("10"); } }}>
        <DialogContent style={{ background: "hsl(222 44% 7%)", border: "1px solid hsl(222 40% 14%)" }}>
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Gift className="w-4 h-4 text-teal-400" />
              Credit Minutes
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Add minutes to license key <span className="text-foreground font-medium font-mono text-xs">{creditKey.slice(0, 8)}…</span>
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Minutes to credit</label>
              <Input
                data-testid="input-credit-minutes"
                type="number"
                min="1"
                step="1"
                placeholder="e.g. 10, 30, 60"
                value={creditMinutes}
                onChange={e => setCreditMinutes(e.target.value)}
                className="bg-background border-border"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setCreditKeyId(null)}>Cancel</Button>
            <Button
              data-testid="button-confirm-credit"
              disabled={!creditMinutes || parseInt(creditMinutes) < 1}
              className="bg-teal-600 hover:bg-teal-700 text-white"
              onClick={creditKeyMutation}
            >
              {`Credit ${creditMinutes || 0} min`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete License Key Confirmation Dialog */}
      <Dialog open={deleteKeyId !== null} onOpenChange={(open) => { if (!open) setDeleteKeyId(null); }}>
        <DialogContent style={{ background: "hsl(222 44% 7%)", border: "1px solid hsl(222 40% 14%)" }}>
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-destructive" />
              Delete License Key
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to permanently delete the license key{" "}
            <span className="text-foreground font-medium font-mono text-xs">{deleteKey.slice(0, 8)}…</span>?
            This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDeleteKeyId(null)}>Cancel</Button>
            <Button
              data-testid="button-confirm-delete-key"
              variant="destructive"
              onClick={() => deleteKeyId !== null && deleteKeyMutation(deleteKeyId)}
            >
              Delete License Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
