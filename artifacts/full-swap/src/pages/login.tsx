import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Key, CheckCircle2, AlertCircle, Loader2, DollarSign, Clock, MessageCircle, Mail, X, Zap, Monitor, Shield } from "lucide-react";
import { setLicenseKey, getLicenseKey } from "@/lib/auth";

function LeftPanel() {
  return (
    <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 relative overflow-hidden"
         style={{ background: "hsl(222 50% 5%)", borderRight: "1px solid hsl(222 40% 10%)" }}>
      <div className="absolute top-0 left-0 w-96 h-96 rounded-full pointer-events-none"
           style={{ background: "radial-gradient(ellipse, hsl(187 100% 52% / 0.07) 0%, transparent 70%)", transform: "translate(-30%, -30%)" }} />
      <div className="absolute bottom-0 right-0 w-80 h-80 rounded-full pointer-events-none"
           style={{ background: "radial-gradient(ellipse, hsl(210 100% 55% / 0.05) 0%, transparent 70%)", transform: "translate(20%, 20%)" }} />
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-14">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
               style={{ background: "linear-gradient(135deg, hsl(187 100% 52%) 0%, hsl(210 100% 55%) 100%)", boxShadow: "0 0 24px hsl(187 100% 52% / 0.45)" }}>
            <img src="/logo.svg" alt="FULL SWAP" className="w-12 h-12 rounded-xl" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-widest text-white font-mono">FULL SWAP BY RICH</span>
            <p className="text-[10px] font-bold text-white tracking-widest uppercase">Live Streaming Studio</p>
          </div>
        </div>
        <h2 className="text-4xl font-bold leading-tight mb-5"
            style={{ background: "linear-gradient(135deg, #ffffff 0%, hsl(187 100% 75%) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Your Stream.<br />Reinvented Live.
        </h2>
        <p className="text-white font-bold text-base leading-relaxed mb-4">
          Real-time live video transformation. Transform your camera feed live for streaming, video calls, and content creation.
        </p>

        {/* ── Before / After Face Swap Preview ── */}
        <div className="relative rounded-2xl overflow-hidden mb-5"
             style={{ border: "1px solid hsl(187 100% 52% / 0.2)", background: "hsl(222 47% 3%)", height: "170px" }}>

          {/* BEFORE side */}
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "calc(50% - 1px)",
                        background: "hsl(222 44% 6%)", display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center", gap: "8px" }}>
            {/* Neutral face silhouette */}
            <svg width="64" height="74" viewBox="0 0 64 74" fill="none" xmlns="http://www.w3.org/2000/svg">
              <ellipse cx="32" cy="30" rx="22" ry="24" fill="hsl(222 40% 14%)" stroke="hsl(222 40% 30%)" strokeWidth="1.5"/>
              <circle cx="24" cy="25" r="3" fill="hsl(222 40% 35%)"/>
              <circle cx="40" cy="25" r="3" fill="hsl(222 40% 35%)"/>
              <path d="M26 34 L29 39 L35 39 L38 34" fill="none" stroke="hsl(222 40% 30%)" strokeWidth="1.2"/>
              <path d="M23 45 Q32 51 41 45" fill="none" stroke="hsl(222 40% 32%)" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M26 54 L26 60 Q32 64 38 60 L38 54" fill="none" stroke="hsl(222 40% 25%)" strokeWidth="1.2"/>
            </svg>
            <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.18em",
                           color: "hsl(222 40% 50%)", fontFamily: "monospace" }}>BEFORE</span>
          </div>

          {/* Divider line */}
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "1px",
                        background: "hsl(187 100% 52% / 0.15)" }} />

          {/* AFTER side */}
          <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "calc(50% - 1px)",
                        background: "linear-gradient(135deg, hsl(187 100% 52% / 0.06), hsl(210 100% 55% / 0.04))",
                        display: "flex", flexDirection: "column", alignItems: "center",
                        justifyContent: "center", gap: "8px" }}>
            {/* Transformed face with glow */}
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", inset: "-8px", borderRadius: "50%",
                            background: "radial-gradient(ellipse, hsl(187 100% 52% / 0.18) 0%, transparent 70%)" }} />
              <svg width="64" height="74" viewBox="0 0 64 74" fill="none" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="32" cy="30" rx="22" ry="24" fill="hsl(187 100% 52% / 0.08)"
                         stroke="hsl(187 100% 52% / 0.6)" strokeWidth="1.5"/>
                <circle cx="24" cy="25" r="3.5" fill="hsl(187 100% 52% / 0.7)"/>
                <circle cx="40" cy="25" r="3.5" fill="hsl(187 100% 52% / 0.7)"/>
                <path d="M26 34 L29 39 L35 39 L38 34" fill="none" stroke="hsl(187 100% 52% / 0.5)" strokeWidth="1.2"/>
                <path d="M23 45 Q32 52 41 45" fill="none" stroke="hsl(187 100% 52% / 0.7)"
                      strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M26 54 L26 60 Q32 64 38 60 L38 54" fill="none"
                      stroke="hsl(187 100% 52% / 0.4)" strokeWidth="1.2"/>
                {/* Glow dots */}
                <circle cx="32" cy="6" r="1.5" fill="hsl(187 100% 52% / 0.4)"/>
                <circle cx="56" cy="24" r="1" fill="hsl(210 100% 55% / 0.5)"/>
                <circle cx="8" cy="40" r="1" fill="hsl(187 100% 52% / 0.3)"/>
              </svg>
            </div>
            <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.18em",
                           color: "hsl(187 100% 52% / 0.9)", fontFamily: "monospace" }}>AFTER</span>
          </div>

          {/* Center swap badge */}
          <div style={{ position: "absolute", left: "50%", top: "50%",
                        transform: "translate(-50%, -50%)", width: "30px", height: "30px",
                        borderRadius: "50%", zIndex: 10,
                        background: "linear-gradient(135deg, hsl(187 100% 52%), hsl(210 100% 55%))",
                        boxShadow: "0 0 16px hsl(187 100% 52% / 0.55)",
                        display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 5H10M10 5L7 2M10 5L7 8" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 9H4M4 9L7 6M4 9L7 12" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          {/* LIVE AI label top-right */}
          <div style={{ position: "absolute", top: "8px", right: "10px", zIndex: 5,
                        fontSize: "8px", fontWeight: 700, letterSpacing: "0.15em",
                        color: "hsl(187 100% 52%)", fontFamily: "monospace",
                        display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "5px", height: "5px", borderRadius: "50%",
                           background: "hsl(187 100% 52%)", display: "inline-block",
                           boxShadow: "0 0 6px hsl(187 100% 52%)",
                           animation: "pulse 2s infinite" }} />
            AI LIVE
          </div>
        </div>

        <div className="space-y-3">
          {[
            { icon: Clock,   text: "50 sec free trial — no card needed" },
            { icon: Zap,     text: "Real-time live video transformation" },
            { icon: Monitor, text: "OBS Studio virtual camera integration" },
            { icon: Shield,  text: "Pay with USDT — private & secure" },
          ].map(({ icon: Icon, text }, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl"
                 style={{ background: "hsl(222 44% 7%)", border: "1px solid hsl(222 40% 12%)" }}>
              <Icon className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm text-white font-bold">{text}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="relative z-10 p-4 rounded-xl"
           style={{ background: "linear-gradient(135deg, hsl(187 100% 52% / 0.08) 0%, hsl(210 100% 55% / 0.08) 100%)", border: "1px solid hsl(187 100% 52% / 0.18)" }}>
        <p className="text-xs text-white font-bold mb-1">Works with</p>
        <p className="text-sm font-bold text-white">OBS Studio · Zoom · Teams · Discord · Google Meet</p>
      </div>
    </div>
  );
}

interface DownloadAvailability { windows: boolean; macosArm64: boolean; macosX64: boolean }


type PricingTier = { id: number; minutes: number; priceUsdt: number; label: string };

function PricingPopup({ onClose }: { onClose: () => void }) {
  const [tiers, setTiers] = useState<PricingTier[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pricing").then(r => r.json())
      .then(data => { setTiers(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0" style={{ background: "hsl(222 47% 4% / 0.85)" }} onClick={onClose} />
      <div className="relative z-10 max-w-sm w-full mx-4" style={{
        background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.3)",
        borderRadius: "1.25rem", padding: "1.75rem 1.5rem",
        boxShadow: "0 0 60px hsl(187 100% 52% / 0.15)", maxHeight: "80vh", overflowY: "auto",
      }}>
        <button onClick={onClose} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground cursor-pointer">
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="w-5 h-5 text-primary" />
          <h3 className="text-base font-bold text-foreground font-mono">Software License Prices</h3>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : tiers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No pricing available. Contact support.</p>
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
                <p className="text-sm font-bold text-primary font-mono">${tier.priceUsdt} USDT</p>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-border space-y-2">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
            <MessageCircle className="w-4 h-4 text-sky-400 shrink-0" />
            <div><p className="text-[10px] text-muted-foreground">Buy via Telegram</p><p className="text-xs font-bold text-foreground font-mono">@rich_life2k15</p></div>
          </div>
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
            <Mail className="w-4 h-4 text-amber-400 shrink-0" />
            <div><p className="text-[10px] text-muted-foreground">Buy via Email</p><p className="text-xs font-bold text-foreground font-mono">loveoflots06@gmail.com</p></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const [licenseKey, setLicenseKeyState] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPricing, setShowPricing] = useState(false);

  // If already activated, go to stream
  useEffect(() => {
    if (getLicenseKey()) setLocation("/stream");
  }, [setLocation]);

  const handleActivate = async () => {
    const key = licenseKey.trim().toUpperCase();
    if (!key) { setError("Please enter your license key."); return; }
    if (!key.match(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/)) {
      setError("Invalid format. License keys follow the format: XXXXX-XXXXX-XXXXX-XXXXX");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/license/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, deviceId: "web-browser" }),
      });
      const data = await res.json();
      if (data.valid) {
        setLicenseKey(key);
        setLocation("/stream");
      } else {
        setError("Invalid license key. " + (data.error ? "(" + data.error + ") " : "") + "Please check your key and try again.");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ background: "hsl(222 47% 4%)" }}>
      {showPricing && <PricingPopup onClose={() => setShowPricing(false)} />}
      <LeftPanel />

      {/* Right panel - License key entry */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">

          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, hsl(187 100% 52%) 0%, hsl(210 100% 55%) 100%)" }}>
              <img src="/logo.svg" alt="FULL SWAP" className="w-10 h-10 rounded-xl" />
            </div>
            <span className="text-lg font-bold tracking-widest text-white font-mono">FULL SWAP BY RICH</span>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2 tracking-wide">Activate Your License</h1>
            <p className="text-muted-foreground text-sm">
              Enter your license key to access the live streaming studio.
            </p>
          </div>

          {/* License key input */}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2 block">
                License Key
              </label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={licenseKey}
                  onChange={e => { setLicenseKeyState(e.target.value.toUpperCase()); setError(null); }}
                  onKeyDown={e => e.key === "Enter" && !loading && handleActivate()}
                  placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                  className="w-full pl-10 pr-4 py-3 rounded-lg text-sm font-mono tracking-widest placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 transition-all"
                  style={{
                    background: "hsl(222 47% 4%)",
                    border: error ? "1px solid hsl(0 84% 60% / 0.6)" : "1px solid hsl(187 100% 52% / 0.3)",
                    color: "hsl(187 100% 90%)",
                  }}
                  disabled={loading}
                  spellCheck={false}
                  autoComplete="off"
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm"
                style={{ background: "hsl(0 84% 60% / 0.08)", border: "1px solid hsl(0 84% 60% / 0.3)", color: "hsl(0 84% 60%)" }}>
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              onClick={handleActivate}
              disabled={loading || !licenseKey.trim()}
              className="w-full h-12 text-base font-bold tracking-wide gap-2"
              style={{ boxShadow: "0 0 24px hsl(187 100% 52% / 0.3)" }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {loading ? "Validating..." : "Activate & Enter Studio"}
            </Button>

            <Button
              variant="ghost"
              onClick={() => setShowPricing(true)}
              className="w-full h-10 text-sm font-semibold gap-2"
              style={{ color: "hsl(187 100% 65%)", border: "1px solid hsl(187 100% 52% / 0.15)" }}
            >
              <DollarSign className="w-4 h-4" />
              Software License Key Prices
            </Button>
          </div>

          <p className="text-xs text-muted-foreground mt-6 text-center">
            Need a license key? Contact{" "}
            <span className="text-primary font-mono">@rich_life2k15</span> on Telegram or{" "}
            <span className="text-primary font-mono">loveoflots06@gmail.com</span>
          </p>
        </div>
      </div>
    </div>
  );
}
