import { Link, useLocation } from "wouter";
import { LayoutDashboard, Play, Menu, X } from "lucide-react";
import { useState } from "react";
import { clearLicenseKey } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ChatWidget } from "@/components/chat-widget";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/stream",    label: "Stream",    icon: Play },
];

export function AppLayout({ children }: { children: React.ReactNode }) {

  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => { clearLicenseKey(); setLocation("/"); };

  return (
    <div className="min-h-screen flex" style={{ background: "hsl(222 47% 4%)" }}>
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/70 z-20 lg:hidden backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-30 w-64 flex flex-col transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
             style={{ background: "hsl(222 50% 5%)", borderRight: "1px solid hsl(222 40% 10%)" }}>

        {/* Logo */}
        <div className="flex items-center gap-3 p-6" style={{ borderBottom: "1px solid hsl(222 40% 10%)" }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
               style={{ background: "linear-gradient(135deg, hsl(187 100% 52%) 0%, hsl(210 100% 55%) 100%)", boxShadow: "0 0 16px hsl(187 100% 52% / 0.4)" }}>
            <img src="/logo.svg" alt="FULL SWAP" className="w-8 h-8 rounded-lg" />
          </div>
          <div>
            <span className="text-base font-bold tracking-widest text-foreground font-mono">FULL SWAP BY RICH</span>
            <p className="text-[10px] text-muted-foreground tracking-widest uppercase">Live Streaming Studio</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = location === href;
            return (
              <Link key={href} href={href}>
                <div
                  data-testid={`nav-${label.toLowerCase()}`}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all ${active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  style={active ? {
                    background: "linear-gradient(135deg, hsl(187 100% 52%) 0%, hsl(200 100% 45%) 100%)",
                    boxShadow: "0 0 20px hsl(187 100% 52% / 0.25)",
                  } : {
                    background: "transparent",
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "hsl(222 40% 9%)"; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className="font-medium text-sm tracking-wide">{label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-4" style={{ borderTop: "1px solid hsl(222 40% 10%)" }}>
          <button
            onClick={handleLogout}
            className="wide-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-muted-foreground hover:text-red hover:text-red-400 transition-colors text-sm"
            style={{ background: "transparent", border: "none", width: "100%", cursor: "pointer" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "hsl(0 84% 60% / 0.08)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
          >
            <X className="w-4 h-4 shrink-0" />
            <span className="font-medium tracking-wide">Log Out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center gap-3 p-4 sticky top-0 z-10"
                style={{ background: "hsl(222 50% 5%)", borderBottom: "1px solid hsl(222 40% 10%)" }}>
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(v => !v)}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
          <span className="text-sm font-bold tracking-widest font-mono text-foreground">FULL SWAP BY RICH</span>
        </header>
        {children}
      </main>
      <ChatWidget />
    </div>
  );
}
