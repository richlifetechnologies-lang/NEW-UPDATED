import { useState } from "react";
import { Key, Loader2, CheckCircle, AlertCircle, MessageCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  onActivate: (key: string) => Promise<{ success: boolean; error?: string }>;
  error: string | null;
  mode?: "no-license" | "exhausted";
};

export function LicenseActivationModal({ onActivate, error, mode = "no-license" }: Props) {
  const [keyValue, setKeyValue] = useState("");
  const [isActivating, setIsActivating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleActivate = async () => {
    if (!keyValue.trim()) { setLocalError("Please enter a license key to continue."); return; }
    setIsActivating(true);
    setLocalError(null);
    const result = await onActivate(keyValue);
    if (!result.success) {
      setLocalError("Invalid license key. Please check your key and try again.");
    }
    setIsActivating(false);
  };

  const displayError = localError ?? error;
  const headingText = mode === "exhausted" ? "Streaming Time Exhausted" : "License Key Required";
  const subText = mode === "exhausted"
    ? "Your streaming time has run out. Contact your admin to top up your license key."
    : "Enter your license key to access the streaming studio.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "hsl(222 47% 4% / 0.40)" }} />

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
        <p className="text-muted-foreground text-sm leading-relaxed mb-6">{subText}</p>

        <div className="space-y-2 mb-6">
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg text-left" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
            <MessageCircle className="w-5 h-5 text-sky-400 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Telegram</p><p className="text-sm font-bold text-foreground font-mono">@rich_life2k15</p></div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg text-left" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
            <Mail className="w-5 h-5 text-amber-400 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Email</p><p className="text-sm font-bold text-foreground font-mono">loveoflots06@gmail.com</p></div>
          </div>
        </div>

        {displayError && (
          <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-lg text-sm text-left"
            style={{ background: "hsl(0 84% 60% / 0.08)", border: "1px solid hsl(0 84% 60% / 0.25)", color: "hsl(0 84% 60%)" }}>
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{displayError}</span>
          </div>
        )}

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

        <p className="text-xs text-muted-foreground mt-6">License is bound to this device &middot; 1 license per machine</p>
      </div>
    </div>
  );
}
