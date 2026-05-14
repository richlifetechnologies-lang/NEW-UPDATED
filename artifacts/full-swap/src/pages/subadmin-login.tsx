import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { setAdminToken, setAdminProfile, getAdminToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { UserCog, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SubAdminLoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const tok = getAdminToken();
    if (tok && localStorage.getItem("fullswap_sub_admin") === "1") {
      setLocation("/subadmin/dashboard");
    }
  }, [setLocation]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Login failed", description: data.error ?? "Invalid credentials", variant: "destructive" });
        setLoading(false);
        return;
      }
      // Only allow sub admin accounts here
      if (!data.user?.isSubAdmin) {
        toast({
          title: "Access denied",
          description: "These credentials belong to a main admin. Please use the main admin login portal.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }
      setAdminToken(data.token);
      setAdminProfile({ username: data.user.username, email: data.user.email, avatarUrl: data.user.avatarUrl ?? null });
      localStorage.setItem("fullswap_sub_admin", "1");
      setLocation("/subadmin/dashboard");
    } catch {
      toast({ title: "Network error", description: "Please try again", variant: "destructive" });
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-8"
      style={{ background: "hsl(222 47% 4%)" }}
    >
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
               style={{ background: "hsl(187 100% 52% / 0.1)", border: "1px solid hsl(187 100% 52% / 0.3)" }}>
            <UserCog className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-bold text-foreground font-mono tracking-wide">FULL SWAP BY RICH</p>
            <p className="text-xs font-bold tracking-widest uppercase" style={{ color: "hsl(187 100% 52% / 0.7)" }}>
              Sub Admin Portal
            </p>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-foreground mb-1">Sub Admin Login</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Sign in to your Sub Admin account to manage users and monitor streaming activity.
        </p>

        {/* Notice */}
        <div className="mb-6 px-3 py-2.5 rounded-lg text-xs font-semibold"
             style={{ background: "hsl(187 100% 52% / 0.07)", border: "1px solid hsl(187 100% 52% / 0.2)", color: "hsl(187 100% 52% / 0.8)" }}>
          This page is exclusively for Sub Admin accounts.
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-white font-bold text-sm block mb-1.5">Sub Admin Email</label>
            <input
              type="email"
              autoComplete="email"
              placeholder="subadmin@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full h-11 rounded-lg border px-3 text-sm font-bold text-white placeholder:text-white/30 focus:outline-none focus:ring-1"
              style={{ background: "hsl(222 44% 7%)", borderColor: "hsl(222 40% 18%)" }}
            />
          </div>
          <div>
            <label className="text-white font-bold text-sm block mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full h-11 rounded-lg border px-3 pr-10 text-sm font-bold text-white placeholder:text-white/30 focus:outline-none focus:ring-1"
                style={{ background: "hsl(222 44% 7%)", borderColor: "hsl(222 40% 18%)" }}
              />
              <button type="button" onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground transition-colors">
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="w-full h-11 text-base font-bold gap-2 mt-2"
                  disabled={loading}
                  style={{ boxShadow: "0 0 20px hsl(187 100% 52% / 0.25)" }}>
            {loading ? "Signing in..." : "Sign In as Sub Admin"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-8">
          Not a Sub Admin?{" "}
          <a href="/" className="text-white/60 hover:text-white font-semibold transition-colors">
            Return to main login
          </a>
        </p>
      </div>
    </div>
  );
}
