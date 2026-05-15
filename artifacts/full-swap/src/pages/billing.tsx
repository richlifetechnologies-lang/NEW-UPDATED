import { AppLayout } from "@/components/layout";
import { MessageCircle, Mail, Key } from "lucide-react";

export default function BillingPage() {
  return (
    <AppLayout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="max-w-md w-full text-center" style={{
          background: "hsl(222 44% 6%)",
          border: "1px solid hsl(187 100% 52% / 0.2)",
          borderRadius: "1.25rem",
          padding: "2.5rem 2rem",
          boxShadow: "0 0 60px hsl(187 100% 52% / 0.08)",
        }}>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{ background: "hsl(187 100% 52% / 0.08)", border: "2px solid hsl(187 100% 52% / 0.25)" }}>
            <Key className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-3 font-mono tracking-wide">Get More Streaming Time</h1>
          <p className="text-muted-foreground text-sm leading-relaxed mb-6">
            Streaming time is managed directly by the admin. Contact us to add minutes to your license key.
          </p>
          <div className="space-y-3">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg text-left"
              style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
              <MessageCircle className="w-5 h-5 text-sky-400 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Contact via Telegram</p>
                <p className="text-sm font-bold text-foreground font-mono">@rich_life2k15</p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg text-left"
              style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 14%)" }}>
              <Mail className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Contact via Email</p>
                <p className="text-sm font-bold text-foreground font-mono">loveoflots06@gmail.com</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
