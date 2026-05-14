import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  useGetPricing, getGetPricingQueryKey,
  useSetUsageTime,
  useListInvoices, getListInvoicesQueryKey,
  useGetInvoiceStatus, getGetInvoiceStatusQueryKey,
  useGetUserDashboard, getGetUserDashboardQueryKey,
} from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  CreditCard, Check, Clock, CheckCircle, AlertCircle,
  Loader2, Zap, RefreshCw, TrendingUp, Download,
  Copy, CheckCheck, Wallet, FileText,
} from "lucide-react";
import { generateReceiptPdf } from "@/lib/generate-receipt";
import { usePaymentSSE } from "@/hooks/usePaymentSSE";
type PollStatus = "idle" | "polling" | "confirming" | "paid" | "error" | "cancelled";

// Network badge color mapping
const NETWORK_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  "TRC-20": { bg: "hsl(38 92% 50% / 0.12)", text: "hsl(38 92% 65%)", dot: "hsl(38 92% 55%)" },
  "ERC-20": { bg: "hsl(235 86% 65% / 0.12)", text: "hsl(235 86% 75%)", dot: "hsl(235 86% 65%)" },
  "BEP-20": { bg: "hsl(45 100% 50% / 0.12)", text: "hsl(45 100% 60%)", dot: "hsl(45 100% 50%)" },
  "USDT":   { bg: "hsl(143 72% 42% / 0.12)", text: "hsl(143 72% 58%)", dot: "hsl(143 72% 42%)" },
};

function networkStyle(network: string) {
  const key = Object.keys(NETWORK_COLORS).find(k => network.toUpperCase().includes(k));
  return key ? NETWORK_COLORS[key] : { bg: "hsl(222 44% 12%)", text: "hsl(210 40% 70%)", dot: "hsl(210 40% 50%)" };
}

function NetworkBadge({ network }: { network: string }) {
  const style = networkStyle(network);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide"
      style={{ background: style.bg, color: style.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: style.dot }} />
      {network}
    </span>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    // Secure clipboard API with textarea fallback
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(value).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(fallback);
    } else {
      fallback();
    }
  };

  const fallback = () => {
    try {
      const el = document.createElement("textarea");
      el.value = value;
      el.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all shrink-0 select-none"
      style={{
        background: copied ? "hsl(143 72% 42% / 0.15)" : "hsl(222 44% 14%)",
        borderColor: copied ? "hsl(143 72% 42% / 0.5)" : "hsl(222 40% 24%)",
        color: copied ? "hsl(143 72% 58%)" : "hsl(210 40% 75%)",
      }}
    >
      {copied ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function WalletCard({ wallet, amount }: { wallet: { address: string; network: string }; amount: string }) {
  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ background: "hsl(222 44% 6%)", borderColor: "hsl(222 40% 16%)" }}
    >
      {/* Network + amount row */}
      <div className="flex items-center justify-between">
        <NetworkBadge network={wallet.network} />
        <div className="text-right">
          <span className="text-xs font-mono font-bold text-primary">{amount} USDT</span>
        </div>
      </div>

      {/* Address row */}
      <div className="flex items-center gap-2">
        <p className="text-xs font-mono text-foreground/80 break-all flex-1 leading-relaxed select-all">
          {wallet.address}
        </p>
        <CopyButton value={wallet.address} />
      </div>

      <p className="text-base font-bold text-amber-400">
        ⚠ Send USDT only on {wallet.network}. Wrong network = lost funds.
      </p>
    </div>
  );
}

export default function BillingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingInvoice, setPendingInvoice] = useState<any>(null);
  const [pollStatus, setPollStatus] = useState<PollStatus>("idle");
  const [pollMessage, setPollMessage] = useState("");
  const [autoPollingInvoiceId, setAutoPollingInvoiceId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [fallbackWallets, setFallbackWallets] = useState<Array<{ address: string; network: string }>>([]);
  const [walletFetchError, setWalletFetchError] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Keep SSE alive while on billing page so webhook fires instantly
  usePaymentSSE();

  useEffect(() => {
    if (!localStorage.getItem("fullswap_token")) setLocation("/");
  }, [setLocation]);

  // Instant confirmation when bcon webhook fires via SSE — no waiting for next poll
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        invoiceId: string; minutes: number; amountUsdt: number; txHash: string;
      };
      // Only act if we have an active pending invoice that matches
      setPendingInvoice((prev: any) => {
        if (!prev || prev.id !== detail.invoiceId) return prev;
        return { ...prev, status: "paid", txHash: detail.txHash };
      });
      setPollStatus(prev => {
        if (prev === "polling" || prev === "confirming") {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
          setAutoPollingInvoiceId(null);
          setCountdown(null);
          setPollMessage("Payment confirmed via bcon.global!");
          return "paid";
        }
        return prev;
      });
    };
    window.addEventListener("fullswap:payment_confirmed", handler);
    return () => window.removeEventListener("fullswap:payment_confirmed", handler);
  }, []);

  const pricing = useGetPricing({
    query: { queryKey: getGetPricingQueryKey(), staleTime: 0, refetchOnMount: true },
  });
  const invoices = useListInvoices({ query: { queryKey: getListInvoicesQueryKey() } });
  const dashboard = useGetUserDashboard({ query: { queryKey: getGetUserDashboardQueryKey() } });

  const [selectedTier, setSelectedTier] = useState<any>(null);

  const setUsageTime = useSetUsageTime({
    mutation: {
      onSuccess: (inv: any) => {
        setFallbackWallets([]);
        setWalletFetchError(null);
        setPendingInvoice(inv);
        setAutoPollingInvoiceId(inv.id);
        setPollStatus("polling");
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        setPollMessage("Invoice created. Send the exact USDT amount to the wallet address below.");
        toast({ title: "Invoice created", description: "Send the exact USDT amount to the wallet address shown." });
      },
      onError: (err: any) => {
        const detail = err?.response?.data?.error ?? err?.message ?? "Please try again.";
        toast({ title: "Error creating invoice", description: detail, variant: "destructive" });
      },
    },
  });

  const statusQuery = useGetInvoiceStatus(
    autoPollingInvoiceId ?? "",
    {
      query: {
        queryKey: getGetInvoiceStatusQueryKey(autoPollingInvoiceId ?? ""),
        enabled: false,
      },
    }
  );

  // Cancel invoice after timeout — clears all payment details
  const cancelInvoice = useCallback(async (invoiceId: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    setAutoPollingInvoiceId(null);
    setCountdown(null);
    setPendingInvoice(null);
    setPollStatus("idle");
    setPollMessage("");
    const authToken = localStorage.getItem("fullswap_token");
    try {
      await fetch(`/api/payments/cancel/${invoiceId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
    } catch { /* silent */ }
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
    toast({ title: "Order cancelled", description: "No payment received within 5 minutes.", variant: "destructive" });
  }, [queryClient, toast]);

  // Manual cancel by user — clears all payment details and hides the panel
  const manualCancel = useCallback(async (invoiceId: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    setAutoPollingInvoiceId(null);
    setCountdown(null);
    setPendingInvoice(null);
    setPollStatus("idle");
    setPollMessage("");
    const authToken = localStorage.getItem("fullswap_token");
    try {
      await fetch(`/api/payments/cancel/${invoiceId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
    } catch { /* silent */ }
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
    toast({ title: "Order cancelled", description: "Payment details cleared.", variant: "destructive" });
  }, [queryClient, toast]);

  // Redirect to dashboard after payment is confirmed so user sees credited minutes
  useEffect(() => {
    if (pollStatus !== "paid") return;
    const t = setTimeout(() => setLocation("/dashboard"), 3000);
    return () => clearTimeout(t);
  }, [pollStatus, setLocation]);

  // Poll every 5s for payment status
  useEffect(() => {
    if (!autoPollingInvoiceId || pollStatus === "paid" || pollStatus === "cancelled") return;

    const poll = async () => {
      try {
        const result = await statusQuery.refetch();
        const data = result.data as any;
        if (!data) return;
        if (data.status === "paid") {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
          setPollStatus("paid");
          setPollMessage("Payment confirmed!");
          setAutoPollingInvoiceId(null);
          setCountdown(null);
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
          toast({ title: "Payment confirmed!", description: "Minutes added to your account" });
        }
      } catch { /* silent */ }
    };

    poll();
    pollIntervalRef.current = setInterval(poll, 5000);
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPollingInvoiceId, pollStatus]);

  // 5-minute countdown — cancels order on expiry
  useEffect(() => {
    if (!autoPollingInvoiceId || pollStatus !== "polling") return;

    setCountdown(300);
    let remaining = 300;
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        cancelInvoice(autoPollingInvoiceId);
      }
    }, 1000);

    return () => { if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPollingInvoiceId]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  // If the invoice response has no usable wallet addresses, fetch the fallback
  // wallet from the server so the payment panel always shows something actionable.
  useEffect(() => {
    if (!pendingInvoice) return;

    const fromInvoice: Array<{ address: string; network: string }> =
      Array.isArray(pendingInvoice.allWallets) && pendingInvoice.allWallets.length > 0
        ? pendingInvoice.allWallets.filter((w: any) => w?.address)
        : pendingInvoice.walletAddress
          ? [{ address: pendingInvoice.walletAddress, network: pendingInvoice.walletNetwork ?? "USDT" }]
          : [];

    if (fromInvoice.length > 0) {
      // Invoice already has wallet data — no fallback needed
      setFallbackWallets([]);
      setWalletFetchError(null);
      return;
    }

    // No wallet in invoice — fetch the admin-configured fallback wallet
    const authToken = localStorage.getItem("fullswap_token");
    setWalletFetchError(null);
    fetch("/api/payments/wallet", {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
      .then(r => r.json())
      .then((data: any) => {
        const wallets: Array<{ address: string; network: string }> =
          Array.isArray(data.wallets) && data.wallets.length > 0
            ? data.wallets.filter((w: any) => w?.address)
            : data.address
              ? [{ address: data.address, network: data.network ?? "TRC-20 (Tron)" }]
              : [];
        if (wallets.length > 0) {
          setFallbackWallets(wallets);
        } else {
          setWalletFetchError("No wallet address configured. Please contact support.");
        }
      })
      .catch(() => setWalletFetchError("Could not load wallet address. Please contact support."));
  }, [pendingInvoice]);

  const downloadReceipt = (inv: any) => {
    generateReceiptPdf({
      invoiceId: inv.id,
      minutes: inv.minutes,
      amountUsd: Number(inv.amountUsd ?? inv.amountUsdt),
      amountUsdt: Number(inv.amountUsdt),
      walletAddress: inv.walletAddress ?? "",
      txHash: inv.txHash,
      network: inv.walletNetwork ?? "TRC-20 (Tron)",
      createdAt: inv.createdAt,
      paidAt: inv.paidAt,
      username: dashboard.data?.user?.username,
      email: dashboard.data?.user?.email,
      type: (inv as any).type ?? "payment",
      note: (inv as any).note ?? null,
    });
  };

  const selectedUsd = selectedTier
    ? Number((selectedTier as any).priceUsd ?? selectedTier.priceUsdt).toFixed(2)
    : null;
  const selectedUsdt = selectedUsd ? parseFloat(selectedUsd).toFixed(4) : null;

  // All wallets from the pending invoice, falling back to admin-configured wallets
  const invoiceWallets: Array<{ address: string; network: string }> = (() => {
    if (!pendingInvoice) return [];
    // Prefer allWallets array from invoice response (populated by set-usage-time)
    if (Array.isArray(pendingInvoice.allWallets) && pendingInvoice.allWallets.length > 0) {
      const filtered = pendingInvoice.allWallets.filter((w: any) => w?.address);
      if (filtered.length > 0) return filtered;
    }
    // Fall back to single walletAddress + walletNetwork fields
    if (pendingInvoice.walletAddress) {
      return [{ address: pendingInvoice.walletAddress, network: pendingInvoice.walletNetwork ?? "USDT" }];
    }
    // Last resort: admin-configured fallback wallets fetched separately
    return fallbackWallets;
  })();

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-8" data-testid="billing-page">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Billing</h1>
            <p className="text-muted-foreground mt-1">Pay securely with USDT via bcon.global</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm" data-testid="rate-badge">
            <TrendingUp className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-muted-foreground">Powered by</span>
            <span className="font-semibold text-foreground">bcon.global</span>
            <span className="text-[10px] text-muted-foreground border-l border-border pl-2 ml-1">crypto gateway</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* ── Left column ── */}
          <div className="space-y-6">
            {/* Pricing tiers */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary" />
                Pricing Tiers
              </h2>
              {pricing.isLoading ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted rounded animate-pulse" />)}</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    {(pricing.data ?? []).map((tier) => {
                      const usdPrice = Number((tier as any).priceUsd ?? tier.priceUsdt);
                      const isSelected = selectedTier?.id === tier.id;
                      return (
                        <button
                          key={tier.id}
                          data-testid={`tier-${tier.id}`}
                          onClick={() => setSelectedTier(tier)}
                          className={`p-3 rounded-lg border text-left transition-all relative ${isSelected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                        >
                          {isSelected && (
                            <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                              <Check className="w-2.5 h-2.5 text-black" />
                            </span>
                          )}
                          <p className="text-xs text-muted-foreground font-medium mb-0.5">{tier.label}</p>
                          <p className="text-sm font-bold text-foreground">{tier.minutes} min</p>
                          <p className="text-xs text-primary font-mono font-semibold">${usdPrice.toFixed(2)}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">≈ {usdPrice.toFixed(2)} USDT</p>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                    Unused minutes <span className="text-green-400 font-medium">never expire</span>
                  </p>
                </>
              )}
            </div>

            {/* Purchase panel */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Purchase Streaming Time
              </h2>

              {!selectedTier ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3 rounded-xl border border-dashed border-border">
                  <CreditCard className="w-8 h-8 text-muted-foreground/40" />
                  <p className="text-sm font-medium text-muted-foreground">Select a package above to continue</p>
                  <p className="text-xs text-muted-foreground/60">Choose Starter, Basic, or Standard</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Selected package summary */}
                  <div className="p-4 bg-primary/10 border border-primary/20 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Selected Package</p>
                        <p className="text-base font-bold text-foreground">{selectedTier.label}</p>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold text-black"
                            style={{ background: "linear-gradient(135deg, hsl(187 100% 52%) 0%, hsl(210 100% 55%) 100%)" }}>
                        {selectedTier.minutes} min
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between border-t border-primary/20 pt-3">
                      <p className="text-2xl font-bold font-mono text-primary">
                        ${selectedUsd} <span className="text-sm font-normal text-muted-foreground">USD</span>
                      </p>
                      <div className="text-right">
                        <p className="text-sm font-mono font-semibold text-foreground">{selectedUsdt} USDT</p>
                        <p className="text-[10px] text-muted-foreground">exact amount</p>
                      </div>
                    </div>
                  </div>

                  <Button
                    data-testid="button-generate-invoice"
                    className="w-full gap-2 h-11"
                    disabled={setUsageTime.isPending}
                    onClick={() => setUsageTime.mutate({ data: { minutes: selectedTier.minutes } })}
                  >
                    {setUsageTime.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Creating invoice...</>
                    ) : (
                      <><FileText className="w-4 h-4" />MAKE PAYMENT</>
                    )}
                  </Button>
                </div>
              )}

              <div className="mt-4 flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border">
                <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
                <p className="text-[11px] text-muted-foreground">
                  Your invoice will appear on the right — send the exact USDT amount to any of the listed wallet addresses, then download your PDF receipt.
                </p>
              </div>
            </div>
          </div>

          {/* ── Right column ── */}
          <div className="space-y-6">

            {/* ── Payment details panel (shown immediately after invoice created) ── */}
            {pendingInvoice && pollStatus !== "paid" && (
              <div className="rounded-xl border border-primary/30 overflow-hidden shadow-lg">
                {/* Header */}
                <div className="px-5 py-3.5 flex items-center justify-between"
                     style={{ background: "hsl(187 100% 52% / 0.1)", borderBottom: "1px solid hsl(187 100% 52% / 0.2)" }}>
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-primary" />
                    <span className="text-primary font-bold text-sm tracking-wide uppercase">Payment Details</span>
                  </div>
                  <span className="text-primary/50 text-xs font-mono">#{pendingInvoice.id?.slice(0, 8).toUpperCase()}</span>
                </div>

                <div className="bg-card p-5 space-y-5">
                  {/* Amount summary */}
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-background">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Total to Send</p>
                      <p className="text-xl font-bold font-mono text-primary">
                        {Number(pendingInvoice.amountUsdt).toFixed(4)}
                        <span className="text-sm font-normal text-muted-foreground ml-1">USDT</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        ≈ ${Number(pendingInvoice.amountUsd ?? pendingInvoice.amountUsdt).toFixed(2)} USD · {pendingInvoice.minutes} min
                      </p>
                    </div>
                    <CopyButton value={Number(pendingInvoice.amountUsdt).toFixed(4)} />
                  </div>

                  {/* Wallet addresses */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5" />
                      {invoiceWallets.length === 1
                        ? "Send USDT to this wallet"
                        : invoiceWallets.length > 1
                          ? `Send USDT to any of these ${invoiceWallets.length} wallets`
                          : "Payment destination"}
                    </p>
                    {invoiceWallets.length > 0 ? (
                      invoiceWallets.map((w, i) => (
                        <WalletCard key={i} wallet={w} amount={Number(pendingInvoice.amountUsdt).toFixed(4)} />
                      ))
                    ) : walletFetchError ? (
                      <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/40 bg-red-500/8 text-red-400 text-xs">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{walletFetchError}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-background text-xs text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        Loading wallet address…
                      </div>
                    )}
                  </div>

                  {/* Awaiting payment note */}
                  <div
                    className="rounded-xl border p-4 space-y-2"
                    style={{ background: "hsl(222 44% 5%)", borderColor: "hsl(222 40% 16%)" }}
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                      <p className="text-sm font-semibold text-foreground">Your Invoice</p>
                      <span className="ml-auto text-[10px] font-mono text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
                        PENDING
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Invoice ID</p>
                        <p className="font-mono text-foreground font-medium">#{pendingInvoice.id.slice(0, 8).toUpperCase()}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Minutes</p>
                        <p className="font-semibold text-foreground">{pendingInvoice.minutes} min</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Amount USD</p>
                        <p className="font-mono font-semibold text-foreground">${Number(pendingInvoice.amountUsd ?? pendingInvoice.amountUsdt).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Amount USDT</p>
                        <p className="font-mono font-semibold text-primary">{Number(pendingInvoice.amountUsdt).toFixed(4)} USDT</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center pt-1">
                      PDF receipt will be available to download once payment is confirmed.
                    </p>
                  </div>

                  {/* Live polling indicator + countdown */}
                  <div className="rounded-lg border bg-blue-500/8 border-blue-500/25 p-3 space-y-2" data-testid="poll-status">
                    <div className="flex items-center gap-3">
                      <RefreshCw className="w-4 h-4 shrink-0 text-blue-400 animate-spin" />
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-blue-300">
                          Watching for confirmation every 5 seconds...
                        </p>
                        {pollMessage && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">{pollMessage}</p>
                        )}
                      </div>
                    </div>
                    {countdown !== null && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-blue-500/15">
                          <div
                            className="h-full rounded-full transition-all duration-1000"
                            style={{
                              width: `${(countdown / 300) * 100}%`,
                              background: countdown > 120 ? "hsl(187 100% 52%)" : countdown > 60 ? "hsl(38 92% 55%)" : "hsl(0 84% 60%)",
                            }}
                          />
                        </div>
                        <span className={`text-xs font-mono font-bold tabular-nums shrink-0 ${
                          countdown > 120 ? "text-primary" : countdown > 60 ? "text-amber-400" : "text-red-400"
                        }`}>
                          {String(Math.floor(countdown / 60)).padStart(2, "0")}:{String(countdown % 60).padStart(2, "0")}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => pendingInvoice && manualCancel(pendingInvoice.id)}
                      className="w-full mt-1 py-2 rounded-lg border border-red-500/40 text-red-400 text-xs font-semibold hover:bg-red-500/10 transition-colors"
                    >
                      Cancel Order
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Cancelled panel ── */}
            {pollStatus === "cancelled" && pendingInvoice && (
              <div className="rounded-xl border border-red-500/40 overflow-hidden shadow-lg">
                <div className="px-5 py-3.5 flex items-center gap-2"
                     style={{ background: "hsl(0 84% 60% / 0.08)", borderBottom: "1px solid hsl(0 84% 60% / 0.3)" }}>
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <span className="text-red-400 font-bold text-sm uppercase tracking-wide">Order Cancelled</span>
                </div>
                <div className="bg-card p-5 space-y-3 text-center" data-testid="poll-status">
                  <p className="text-sm text-muted-foreground">
                    No payment was received within <strong className="text-foreground">5 minutes</strong>. This order has been cancelled.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Invoice <span className="font-mono text-foreground">#{pendingInvoice.id.slice(0, 8).toUpperCase()}</span> is now marked as <span className="text-red-400 font-semibold">cancelled</span> on your account.
                  </p>
                  <button
                    onClick={() => { setPendingInvoice(null); setPollStatus("idle"); setPollMessage(""); }}
                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 text-sm font-semibold transition-colors"
                  >
                    Dismiss & Create New Order
                  </button>
                </div>
              </div>
            )}

            {/* ── Confirmed panel ── */}
            {pollStatus === "paid" && pendingInvoice && (
              <div className="rounded-xl border border-green-500/40 overflow-hidden shadow-lg">
                <div className="px-5 py-3.5 flex items-center gap-2"
                     style={{ background: "hsl(143 72% 42% / 0.1)", borderBottom: "1px solid hsl(143 72% 42% / 0.3)" }}>
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span className="text-green-400 font-bold text-sm uppercase tracking-wide">Payment Confirmed</span>
                </div>
                <div className="bg-card p-5 space-y-4 text-center" data-testid="poll-status">
                  <div className="space-y-1">
                    <p className="text-4xl font-bold text-green-400">+{pendingInvoice.minutes}</p>
                    <p className="text-sm text-muted-foreground font-medium">minutes added to your account</p>
                    {pollMessage && <p className="text-xs text-muted-foreground">{pollMessage}</p>}
                  </div>
                  <button
                    data-testid="button-download-receipt-pending"
                    onClick={() => downloadReceipt(pendingInvoice)}
                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download PDF Receipt
                  </button>
                </div>
              </div>
            )}

            {/* ── Invoice history ── */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="font-semibold text-foreground mb-4">Invoice History</h2>
              {invoices.isLoading ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}</div>
              ) : invoices.data && invoices.data.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {invoices.data.map((inv) => {
                    const usd = (inv as any).amountUsd ?? inv.amountUsdt;
                    const isCredit = (inv as any).type === "credit";
                    return (
                      <div key={inv.id} data-testid={`invoice-${inv.id}`}
                           className={`flex items-center justify-between p-3 bg-background rounded border ${isCredit ? "border-teal-500/30" : "border-border"}`}>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium text-foreground">{inv.minutes} min</p>
                            {isCredit && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-teal-500/15 text-teal-400 border border-teal-500/25">
                                CREDITED
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono">{inv.id.slice(0, 8)}...</p>
                          {isCredit && (inv as any).note && (
                            <p className="text-[10px] text-teal-400/70 mt-0.5 italic">"{(inv as any).note}"</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {!isCredit && (
                            <div className="text-right">
                              <p className="text-sm font-mono text-foreground">${Number(usd).toFixed(2)}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{Number(inv.amountUsdt).toFixed(4)} USDT</p>
                            </div>
                          )}
                          {inv.status === "paid" ? (
                            <div className="flex items-center gap-1.5">
                              {isCredit ? (
                                <span className="w-4 h-4 rounded-full bg-teal-500/20 flex items-center justify-center shrink-0">
                                  <Check className="w-2.5 h-2.5 text-teal-400" />
                                </span>
                              ) : (
                                <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                              )}
                              <button
                                data-testid={`button-download-receipt-${inv.id}`}
                                onClick={() => downloadReceipt(inv)}
                                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors border ${isCredit ? "border-teal-500/40 text-teal-400 hover:bg-teal-500/10" : "border-green-500/40 text-green-400 hover:bg-green-500/10"}`}
                                title="Download PDF receipt"
                              >
                                <Download className="w-3 h-3" />
                                PDF
                              </button>
                            </div>
                          ) : inv.status === "cancelled" ? (
                            <span className="flex items-center gap-1 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded">
                              <AlertCircle className="w-3 h-3" />
                              Cancelled
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-amber-400">
                              <AlertCircle className="w-4 h-4" />
                              Pending
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CreditCard className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                  <p className="text-sm text-muted-foreground">No invoices yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Purchase streaming time to get started</p>
                </div>
              )}
            </div>

            {/* ── How it works ── */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <Check className="w-4 h-4 text-primary" />
                How Payment Works
              </h2>
              <ol className="space-y-2.5">
                {[
                  "Select your streaming minutes and click MAKE PAYMENT",
                  "Copy one of the wallet addresses shown and send the exact USDT amount on the correct network",
                  "Wait for automatic payment confirmation — your minutes are added instantly",
                  "Download your PDF receipt once payment is confirmed — available in the invoice history below",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <p className="text-xs text-muted-foreground leading-relaxed">{step}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
