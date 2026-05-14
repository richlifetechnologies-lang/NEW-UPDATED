import { useState, useEffect } from "react";
import { Key, ShoppingCart, Loader2, CheckCircle, AlertCircle, MessageCircle, Mail, X, DollarSign, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  onActivate: (key: string) => Promise<{ success: boolean; error?: string }>;
  onBuyKey: () => void;
  error: string | null;
  mode?: "no-license" | "exhausted";
};

type PricingTier = { id: number; minutes: number; priceUsd: number; priceUsdt: number; priceGhs: number; label: string; planType: string };

async function fetchLiveGhsRate(): Promise<number> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error("rate fetch failed");
    const data = await res.json();
    return typeof data.rates?.GHS === "number" ? data.rates.GHS : 15.5;
  } catch {
    return 15.5;
  }
}

function PricingPopup({ onClose }: { onClose: () => void }) {
  const [tiers, setTiers] = useState<PricingTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [ghsRate, setGhsRate] = useState<number>(15.5);

  useEffect(() => {
    Promise.all([
      fetch("/api/pricing").then(r => r.json()),
      fetchLiveGhsRate(),
    ]).then(([data, rate]) => {
      setTiers(Array.isArray(data) ? data : []);
      setGhsRate(rate);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const getGhsPrice = (tier: PricingTier) => {
    if (tier.priceGhs > 0) return tier.priceGhs;
    if (ghsRate && tier.priceUsd > 0) return +(tier.priceUsd * ghsRate).toFixed(2);
    return 0;
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0" style={{ background: "hsl(222 47% 4% / 0.80)" }} onClick={onClose} />
      <div className="relative z-10 max-w-sm w-full mx-4" style={{
        background: "hsl(222 44% 6%)",
        border: "1px solid hsl(187 100% 52% / 0.3)",
        borderRadius: "1.25rem",
        padding: "1.75rem 1.5rem",
        boxShadow: "0 0 60px hsl(187 100% 52% / 0.15)",
        maxHeight: "80vh", overflowY: "auto",
      }}>
        <button onClick={onClose} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground cursor-pointer">
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="w-5 h-5 text-primary" />
          <h3 className="text-base font-bold text-foreground font-mono">Software License Prices</h3>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : tiers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No pricing packages available. Contact support.</p>
        ) : (
          <div className="space-y-2">
            {tiers.map(tier => (
              <div key={tier.id} className="flex items-center justify-between px-4 py-3 rounded-lg"
                style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-foreground font-mono">{tier.label}</p>
                    <p className="text-[10px] text-muted-foreground">{tier.minutes} minutes streaming</p>
                  </div>
                </div>
                <div className="text-right space-y-0.5">
                  <p className="text-sm font-bold text-primary font-mono">${tier.priceUsd.toFixed(2)} USD</p>
                  <p className="text-xs text-muted-foreground font-mono">GHS {getGhsPrice(tier).toFixed(2)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-border space-y-2">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-left" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
            <MessageCircle className="w-4 h-4 text-sky-400 shrink-0" />
            <div><p className="text-[10px] text-muted-foreground">Buy via Telegram</p><p className="text-xs font-bold text-foreground font-mono">@rich_life2k15</p></div>
          </div>
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-left" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
            <Mail className="w-4 h-4 text-amber-400 shrink-0" />
            <div><p className="text-[10px] text-muted-foreground">Buy via Email</p><p className="text-xs font-bold text-foreground font-mono">loveoflots06@gmail.com</p></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LicenseActivationModal({ onActivate, error, mode = "no-license" }: Props) {
  const [showInput, setShowInput] = useState(false);
  const [showBuyPopup, setShowBuyPopup] = useState(false);
  const [showPricingPopup, setShowPricingPopup] = useState(false);
  const [keyValue, setKeyValue] = useState("");
  const [isActivating, setIsActivating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleActivate = async () => {
    if (!keyValue.trim()) { setLocalError("Please enter a license key to continue."); return; }
    setIsActivating(true);
    setLocalError(null);
    const result = await onActivate(keyValue);
    if (!result.success) {
      setLocalError("Invalid license key. Please check your key and enter a valid license key to continue.");
    }
    setIsActivating(false);
  };

  const displayError = localError ?? error;
  const headingText = mode === "exhausted" ? "License Time Exhausted" : "License Required to Continue";
  const subText = mode === "exhausted"
    ? "Your streaming time has run out. Enter a new license key to top up and continue streaming."
    : "Purchase a License Key to activate your software.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "hsl(222 47% 4% / 0.40)" }} />

      {showPricingPopup && <PricingPopup onClose={() => setShowPricingPopup(false)} />}

      {showBuyPopup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0" style={{ background: "hsl(222 47% 4% / 0.70)" }} onClick={() => setShowBuyPopup(false)} />
          <div className="relative z-10 max-w-sm w-full mx-4 text-center" style={{
            background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.3)",
            borderRadius: "1.25rem", padding: "2rem 1.5rem", boxShadow: "0 0 60px hsl(187 100% 52% / 0.15)",
          }}>
            <button onClick={() => setShowBuyPopup(false)} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground cursor-pointer">
              <X className="w-4 h-4" />
            </button>
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: "hsl(187 100% 52% / 0.08)", border: "2px solid hsl(187 100% 52% / 0.25)" }}>
              <ShoppingCart className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-lg font-bold text-foreground mb-2 font-mono">Purchase a License Key</h3>
            <p className="text-muted-foreground text-sm mb-6">Contact the administrator directly to purchase your license key.</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg text-left" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
                <MessageCircle className="w-5 h-5 text-sky-400 shrink-0" />
                <div><p className="text-xs text-muted-foreground">Telegram</p><p className="text-sm font-bold text-foreground font-mono">@rich_life2k15</p></div>
              </div>
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg text-left" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
                <Mail className="w-5 h-5 text-amber-400 shrink-0" />
                <div><p className="text-xs text-muted-foreground">Email</p><p className="text-sm font-bold text-foreground font-mono">loveoflots06@gmail.com</p></div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-5">Once you receive your key, close this and click "Enter License Key" to activate.</p>
          </div>
        </div>
      )}

      <div className="relative z-10 max-w-md w-full mx-4 text-center" style={{
        background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.25)",
        borderRadius: "1.25rem", padding: "2.5rem 2rem",
        boxShadow: "0 0 80px hsl(187 100% 52% / 0.12), 0 0 0 1px hsl(187 100% 52% / 0.08)",
      }}>
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{ background: "hsl(187 100% 52% / 0.08)", border: "2px solid hsl(187 100% 52% / 0.25)" }}>
          <Key className="w-9 h-9 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-3 font-mono tracking-wide">{headingText}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed mb-2">{subText}</p>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          For assistance, contact us via Telegram: <span className="text-primary">@rich_life2k15</span> or Email: <span className="text-primary">loveoflots06@gmail.com</span>
        </p>

        {displayError && (
          <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-lg text-sm text-left"
            style={{ background: "hsl(0 84% 60% / 0.08)", border: "1px solid hsl(0 84% 60% / 0.25)", color: "hsl(0 84% 60%)" }}>
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{displayError}</span>
          </div>
        )}

        {showInput && (
          <div className="mb-4">
            <Input value={keyValue}
              onChange={(e) => { setKeyValue(e.target.value.toUpperCase()); setLocalError(null); }}
              onKeyDown={(e) => e.key === "Enter" && !isActivating && handleActivate()}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              className="text-center font-mono tracking-widest mb-3 h-12"
              style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(187 100% 52% / 0.35)", color: "hsl(187 100% 52%)" }}
              autoFocus disabled={isActivating} spellCheck={false} autoComplete="off" />
            <Button className="w-full gap-2 h-12 text-base font-bold tracking-wide"
              onClick={handleActivate} disabled={isActivating || !keyValue.trim()}
              style={{ boxShadow: "0 0 24px hsl(187 100% 52% / 0.3)" }}>
              {isActivating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {isActivating ? "Activating..." : "Activate License"}
            </Button>
          </div>
        )}

        {!showInput && (
          <div className="flex flex-col gap-3">
            <Button className="w-full gap-2 h-12 text-base font-bold tracking-wide"
              onClick={() => setShowBuyPopup(true)}
              style={{ boxShadow: "0 0 24px hsl(187 100% 52% / 0.3)" }}>
              <ShoppingCart className="w-5 h-5" />
              Buy License Key
            </Button>
            <Button variant="outline" className="w-full gap-2 h-12 text-base font-bold tracking-wide"
              onClick={() => { setShowInput(true); setLocalError(null); }}
              style={{ background: "transparent", border: "1px solid hsl(187 100% 52% / 0.25)", color: "hsl(187 100% 52%)" }}>
              <Key className="w-5 h-5" />
              Enter License Key
            </Button>
            <Button variant="ghost" className="w-full gap-2 h-10 text-sm font-semibold tracking-wide"
              onClick={() => setShowPricingPopup(true)}
              style={{ color: "hsl(187 100% 65%)", border: "1px solid hsl(187 100% 52% / 0.15)" }}>
              <DollarSign className="w-4 h-4" />
              Software License Key Prices
            </Button>
          </div>
        )}

        {showInput && (
          <button type="button"
            className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={() => { setShowInput(false); setLocalError(null); setKeyValue(""); }}>
            Back
          </button>
        )}

        <p className="text-xs text-muted-foreground mt-6">License is bound to this device &middot; 1 license per machine</p>
      </div>
    </div>
  );
}
