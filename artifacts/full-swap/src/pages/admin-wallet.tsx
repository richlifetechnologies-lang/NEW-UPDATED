import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAdminUpdateWallet } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAdminToken } from "@/lib/auth";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Save, Wallet, Plus, Trash2, RefreshCw, CheckCircle, Info } from "lucide-react";

const NETWORK_OPTIONS = [
  "TRC-20 (Tron)",
  "ERC-20 (Ethereum)",
  "BEP-20 (BSC)",
  "Polygon (MATIC)",
  "Solana (SPL)",
  "Avalanche (AVAX-C)",
];

const NETWORK_COLORS: Record<string, string> = {
  "TRC-20": "hsl(38 92% 55%)",
  "ERC-20": "hsl(235 86% 70%)",
  "BEP-20": "hsl(45 100% 55%)",
  "Polygon": "hsl(270 80% 70%)",
  "Solana": "hsl(280 90% 65%)",
  "Avalanche": "hsl(4 90% 58%)",
};

function networkColor(network: string) {
  const key = Object.keys(NETWORK_COLORS).find(k => network.includes(k));
  return key ? NETWORK_COLORS[key] : "hsl(210 40% 65%)";
}

interface WalletEntry {
  address: string;
  network: string;
}

export default function AdminWalletPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [wallets, setWallets] = useState<WalletEntry[]>([{ address: "", network: "TRC-20 (Tron)" }]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("fullswap_admin_token")) {
      setLocation("/admin");
    }
  }, [setLocation]);

  const walletQuery = useQuery({
    queryKey: ["admin-wallet"],
    queryFn: async () => {
      const token = getAdminToken();
      const res = await fetch("/api/admin/wallet", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      return res.json() as Promise<{ address: string; network: string; wallets: Array<{ address: string; network: string }> }>;
    },
    staleTime: 0,
  });

  useEffect(() => {
    if (walletQuery.data) {
      const data = walletQuery.data as any;
      if (Array.isArray(data.wallets) && data.wallets.length > 0) {
        setWallets(data.wallets);
      } else if (data.address) {
        setWallets([{ address: data.address, network: data.network || "TRC-20 (Tron)" }]);
      }
    }
  }, [walletQuery.data]);

  const updateWallet = useAdminUpdateWallet({
    mutation: {
      onSuccess: () => {
        toast({ title: "Wallets saved", description: "Your payment wallets are now live." });
        queryClient.invalidateQueries({ queryKey: ["admin-wallet"] });
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      },
      onError: () => toast({ title: "Save failed", description: "Could not update wallets. Please try again.", variant: "destructive" }),
    },
  });

  const addWallet = () => {
    if (wallets.length >= 3) {
      toast({ title: "Maximum 3 wallets", description: "You can configure up to 3 payment wallets.", variant: "destructive" });
      return;
    }
    setWallets(w => [...w, { address: "", network: "TRC-20 (Tron)" }]);
  };

  const removeWallet = (i: number) => {
    if (wallets.length === 1) {
      toast({ title: "At least 1 wallet required", variant: "destructive" });
      return;
    }
    setWallets(w => w.filter((_, idx) => idx !== i));
  };

  const updateField = (i: number, field: keyof WalletEntry, value: string) => {
    setWallets(w => w.map((entry, idx) => idx === i ? { ...entry, [field]: value } : entry));
  };

  const save = () => {
    const valid = wallets.filter(w => w.address.trim().length > 0);
    if (valid.length === 0) {
      toast({ title: "At least one wallet address is required", variant: "destructive" });
      return;
    }
    updateWallet.mutate({
      data: {
        address: valid[0].address,
        network: valid[0].network,
        wallets: valid,
      } as any,
    });
  };

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-6" data-testid="admin-wallet-page">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Payment Wallets</h1>
            <p className="text-muted-foreground mt-1">
              Configure up to 3 USDT wallet addresses — users can pay to any of them
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={addWallet}
              disabled={wallets.length >= 3}
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Wallet
            </Button>
            <Button
              onClick={save}
              disabled={updateWallet.isPending}
              className="gap-2"
              style={saved ? { background: "hsl(143 72% 42%)", color: "white" } : {}}
            >
              {updateWallet.isPending ? (
                <><RefreshCw className="w-4 h-4 animate-spin" />Saving...</>
              ) : saved ? (
                <><CheckCircle className="w-4 h-4" />Saved!</>
              ) : (
                <><Save className="w-4 h-4" />Save Wallets</>
              )}
            </Button>
          </div>
        </div>

        {/* Info banner */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-3">
          <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            All configured wallets are shown to users at checkout so they can pick the network they prefer.
            The <span className="text-foreground font-medium">first wallet</span> is used as the primary address for new invoices.
            You can add up to <span className="text-foreground font-medium">3 wallets</span> across different networks.
          </p>
        </div>

        {walletQuery.isLoading ? (
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => <div key={i} className="h-32 bg-card rounded-xl animate-pulse border border-border" />)}
          </div>
        ) : (
          <div className="space-y-4">
            {wallets.map((wallet, i) => (
              <div
                key={i}
                data-testid={`wallet-entry-${i}`}
                className="bg-card border border-border rounded-xl p-5 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: networkColor(wallet.network) }}
                    >
                      {i + 1}
                    </div>
                    <span className="text-sm font-semibold text-foreground">
                      {i === 0 ? "Primary Wallet" : `Wallet ${i + 1}`}
                    </span>
                    {i === 0 && (
                      <span className="text-[10px] bg-primary/15 text-primary font-bold px-2 py-0.5 rounded-full">
                        PRIMARY
                      </span>
                    )}
                  </div>
                  {wallets.length > 1 && (
                    <button
                      onClick={() => removeWallet(i)}
                      className="text-destructive hover:text-destructive/80 p-1.5 rounded hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Wallet Address
                    </label>
                    <Input
                      data-testid={`input-wallet-address-${i}`}
                      value={wallet.address}
                      onChange={e => updateField(i, "address", e.target.value)}
                      placeholder="0x... or T..."
                      className="bg-background border-border font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Network
                    </label>
                    <div className="relative">
                      <select
                        data-testid={`input-wallet-network-${i}`}
                        value={wallet.network}
                        onChange={e => updateField(i, "network", e.target.value)}
                        className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground appearance-none pr-8"
                        style={{ colorScheme: "dark" }}
                      >
                        {NETWORK_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                        {!NETWORK_OPTIONS.includes(wallet.network) && wallet.network && (
                          <option value={wallet.network}>{wallet.network}</option>
                        )}
                      </select>
                      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Preview */}
                {wallet.address && (
                  <div
                    className="flex items-center gap-3 p-3 rounded-lg border"
                    style={{
                      background: `${networkColor(wallet.network)}12`,
                      borderColor: `${networkColor(wallet.network)}35`,
                    }}
                  >
                    <Wallet className="w-4 h-4 shrink-0" style={{ color: networkColor(wallet.network) }} />
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: networkColor(wallet.network) }}>
                        {wallet.network} · USDT
                      </p>
                      <p className="text-xs font-mono text-foreground/70 truncate">{wallet.address}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {wallets.length < 3 && (
              <button
                onClick={addWallet}
                className="w-full rounded-xl border border-dashed border-border hover:border-primary/50 p-5 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-all"
              >
                <Plus className="w-4 h-4" />
                Add another wallet ({3 - wallets.length} remaining)
              </button>
            )}
          </div>
        )}

        {/* Save button at bottom */}
        <div className="flex justify-end">
          <Button
            onClick={save}
            disabled={updateWallet.isPending}
            className="gap-2 min-w-36"
            style={saved ? { background: "hsl(143 72% 42%)", color: "white" } : {}}
          >
            {updateWallet.isPending ? (
              <><RefreshCw className="w-4 h-4 animate-spin" />Saving...</>
            ) : saved ? (
              <><CheckCircle className="w-4 h-4" />Saved!</>
            ) : (
              <><Save className="w-4 h-4" />Save Wallets</>
            )}
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
