import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Key, CheckCircle2, AlertCircle, Loader2, Clock, Zap, Monitor, Shield } from "lucide-react";
import { setLicenseKey, getLicenseKey, getDeviceId } from "@/lib/auth";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

type ContactSettings = { message: string; telegram: string; email: string; whatsapp: string };

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
            { icon: Clock,   text: "License key only — contact admin for access" },
            { icon: Zap,     text: "Real-time live video transformation" },
            { icon: Monitor, text: "OBS Studio virtual camera integration" },
            { icon: Shield,  text: "License key gated — admin controlled access" },
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

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const [licenseKey, setLicenseKeyState] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contact, setContact] = useState<ContactSettings>({
    message:  "Need a license key? Contact us via:",
    telegram: "@rich_life2k15",
    email:    "loveoflots06@gmail.com",
    whatsapp: "",
  });

  useEffect(() => {
    if (getLicenseKey()) setLocation("/stream");
  }, [setLocation]);

  useEffect(() => {
    fetch("/api/admin/contact-settings/public")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setContact(d); })
      .catch(() => {});
  }, []);

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
        body: JSON.stringify({ key, deviceId: getDeviceId() }),
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
          </div>

          <div className="mt-6 space-y-1.5 text-center">
            <p className="text-xs text-muted-foreground">{contact.message}</p>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              {contact.telegram && (
                <span className="flex items-center gap-1 text-xs">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0" style={{ color: "#2AABEE" }} aria-hidden="true">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.782-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                  </svg>
                  <span className="text-primary font-mono">{contact.telegram}</span>
                </span>
              )}
              {contact.email && (
                <span className="flex items-center gap-1 text-xs">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden="true">
                    <rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                  </svg>
                  <span className="text-primary font-mono">{contact.email}</span>
                </span>
              )}
              {contact.whatsapp && (
                <span className="flex items-center gap-1 text-xs">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0" style={{ color: "#25D366" }} aria-hidden="true">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  <span className="text-primary font-mono">{contact.whatsapp}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
