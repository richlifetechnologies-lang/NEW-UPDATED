import { useState } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, DollarSign, Wallet, LogOut, Shield, Activity, Bell, ShieldCheck, MessageCircle, Menu, X, UserCog, KeyRound, FileKey, BarChart3, Zap, BrainCircuit, Radio, TrendingUp } from "lucide-react";
import { clearAdminToken, clearAdminProfile, getAdminProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/sessions", label: "Live Streams", icon: Activity },
  { href: "/admin/users", label: "Licensed Keys", icon: FileKey },
  { href: "/admin/license-keys", label: "Generated License Keys", icon: FileKey },
  { href: "/admin/analytics", label: "Financial Analytics", icon: BarChart3 },
  { href: "/admin/pricing", label: "Pricing", icon: DollarSign },
  { href: "/admin/billing", label: "Billing Rate", icon: Zap },
  { href: "/admin/billing-intelligence", label: "Billing Intelligence", icon: BrainCircuit },
  { href: "/admin/observatory", label: "Live Observatory", icon: Radio },
  { href: "/admin/profit-dashboard", label: "Live Profit", icon: TrendingUp },
  { href: "/admin/wallet", label: "Wallet", icon: Wallet },
  { href: "/admin/decart-keys", label: "API Keys", icon: KeyRound },
  { href: "/admin/admin-sessions", label: "Admin Audit", icon: ShieldCheck },
  { href: "/admin/notifications", label: "Notifications", icon: Bell },
  { href: "/admin/chat", label: "Support Chat", icon: MessageCircle },
  { href: "/admin/sub-admins", label: "Sub Admins", icon: UserCog },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const profile = getAdminProfile();

  const handleLogout = () => {
    clearAdminToken();
    clearAdminProfile();
    setLocation("/admin");
  };

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="min-h-screen bg-background">

      {/* Mobile top bar */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 flex items-center px-4 gap-3 bg-card border-b border-border shrink-0">
        <button
          onClick={() => setSidebarOpen(v => !v)}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Toggle menu"
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w5 h-5" />}
        </button>
        <div className="w7 h-7 bg-destructive/20 border border-destructive/30 rounded flex items-center justify-center shrink-0">
          <img src="/logo.svg" alt="FULL SWAP" className="w-6 h-6 rounded" />
        </div>
        <p className="text-sm font-bold font-mono text-foreground truncate">FULL SWAP BY RICH</p>
        <span className="text-xs text-muted-foreground ml-auto shrink-0">Admin</span>
      </header>

      {/* Backdrop */}
      <div
        className={`lg:hidden fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 ${sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={closeSidebar}
      />

      <div className="flex">
        {/* Sidebar */}
        <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 lg:w-60 min-h-screen bg-card border-r border-border flex flex-col shrink-0 transition-transform duration-200 ease-in-out ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>

          {/* Sidebar header -- desktop only */}
          <div className="hidden lg:flex items-center gap-3 p-5 border-b border-border">
            <div className="w-8 h-8 bg-destructive/20 border border-destructive/30 rounded flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4 text-destructive" />
            </div>
            <div>
              <p className="text-sm font-bold font-mono text-foreground">FULL SWAP BY RICH</p>
              <p className="text-xs text-muted-foreground">Admin</p>
            </div>
          </div>

          {/* Mobile sidebar top spacer */}
          <div className="lg:hidden h-14 shrink-0 border-b border-border flex items-center px-4 gap-3">
            <div className="w7 h-7 bg-destructive/20 border border-destructive/30 rounded flex items-center justify-center shrink-0">
              <Shield className="w-3.5 h-3.5 text-destructive" />
            </div>
            <p className="text-sm font-bold font-mono text-foreground">Admin Portal</p>
          </div>

          {/* Profile */}
          {profile && (
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/40">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt={profile.username} className="w9 h-9 rounded-full object-cover border border-border shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-destructive/20 border border-destructive/30 flex items-center justify-center shrink-0 text-sm font-bold text-destructive">
                  {profile.username.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{profile.username}</p>
                <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
              </div>
            </div>
          )}

          {/* Nav items */}
          <nav className="flex-1 p-2 overflow-y-auto">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = location === href;
              return (
                <Link key={href} href={href} onClick={closeSidebar}>
                  <div
                    className={`flex items-center gap-3.s px-3 py-2.5 rounded-lg cursor-pointer transition-all text-sm ${active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/so hover:text-foreground"}`}
                  >
                    <Icon className={`w-4.5 h-4.5 shrink-0 ${active ? "text-primary" : ""}`} />
                    <span>{label}</span>
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* Logout */}
          <div className="p-2 border-t border-border">
            <Button
              variant="ghost"
              className="wide-full justify-start gap-3 text-muted-foreground hover:text-destructive hover:bg-destructive/8"
              onClick={handleLogout}
            >
              <LogOut className="w4 h-4 shrink-0" />
              Log Out
            </Button>
          </div>
        </aside>

        {/* Main content area */}
        <main className="flex-1 min-w-0 lg:ml-0 overflow-hidden">
          {/* Padding for mobile top bar */}
          <div className="lg�ph-0 h-14"></div>
          {children}
        </main>
      </div>
    </div>
  );
}
