import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Save, Webhook, Mail, FlaskConical, CheckCircle, Send } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function adminFetch(path: string, opts?: RequestInit) {
  const token = localStorage.getItem("fullswap_admin_token") || "";
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function AdminNotificationsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<"webhook" | "email" | "user-email" | null>(null);

  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEnabled, setWebhookEnabled] = useState(false);

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpTo, setSmtpTo] = useState("");
  const [smtpEnabled, setSmtpEnabled] = useState(false);
  const [smtpPassSet, setSmtpPassSet] = useState(false);
  const [userEmailEnabled, setUserEmailEnabled] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("fullswap_admin_token")) {
      setLocation("/admin");
      return;
    }
    adminFetch("/api/admin/notifications")
      .then((d) => {
        setWebhookUrl(d.webhookUrl || "");
        setWebhookEnabled(d.webhookEnabled || false);
        setSmtpHost(d.smtpHost || "");
        setSmtpPort(d.smtpPort || "587");
        setSmtpUser(d.smtpUser || "");
        setSmtpFrom(d.smtpFrom || "");
        setSmtpTo(d.smtpTo || "");
        setSmtpEnabled(d.smtpEnabled || false);
        setSmtpPassSet(d.smtpPassSet || false);
        setUserEmailEnabled(d.userEmailEnabled || false);
      })
      .catch(() => toast({ title: "Failed to load notification settings", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await adminFetch("/api/admin/notifications", {
        method: "PUT",
        body: JSON.stringify({
          webhookUrl, webhookEnabled,
          smtpHost, smtpPort, smtpUser,
          ...(smtpPass ? { smtpPass } : {}),
          smtpFrom, smtpTo, smtpEnabled,
          userEmailEnabled,
        }),
      });
      toast({ title: "Notification settings saved" });
      if (smtpPass) { setSmtpPass(""); setSmtpPassSet(true); }
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const test = async (type: "webhook" | "email" | "user-email") => {
    setTesting(type);
    try {
      const res = await adminFetch("/api/admin/notifications/test", { method: "POST", body: JSON.stringify({ type }) });
      toast({ title: res.message || `Test ${type} sent` });
    } catch {
      toast({ title: `Test ${type} failed — check SMTP settings`, variant: "destructive" });
    } finally {
      setTesting(null);
    }
  };

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 space-y-8" data-testid="admin-notifications-page">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          <p className="text-muted-foreground mt-1">Configure alerts and automated emails for payment events</p>
        </div>

        {loading ? (
          <div className="space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}</div>
        ) : (
          <div className="space-y-6">

            {/* SMTP shared config — always shown at top */}
            <div className="bg-card border border-border rounded-lg p-6 space-y-5">
              <div>
                <h2 className="font-semibold text-foreground flex items-center gap-2">
                  <Mail className="w-4 h-4 text-primary" />
                  SMTP Configuration
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Shared credentials used by both admin notifications and user confirmation emails. Works with Gmail, Mailgun, SendGrid, Postmark, etc.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-sm font-medium text-foreground block mb-1.5">SMTP Host</label>
                  <Input data-testid="input-smtp-host" value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" className="bg-background border-border" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Port</label>
                  <Input data-testid="input-smtp-port" value={smtpPort} onChange={e => setSmtpPort(e.target.value)} placeholder="587" className="bg-background border-border" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Username</label>
                  <Input data-testid="input-smtp-user" value={smtpUser} onChange={e => setSmtpUser(e.target.value)} placeholder="you@gmail.com" className="bg-background border-border" />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-foreground block mb-1.5">
                    Password {smtpPassSet && !smtpPass && <span className="text-green-400 text-xs inline-flex items-center gap-1 ml-1"><CheckCircle className="w-3 h-3" />saved</span>}
                  </label>
                  <Input data-testid="input-smtp-pass" type="password" value={smtpPass} onChange={e => setSmtpPass(e.target.value)} placeholder={smtpPassSet ? "••••••••" : "App password or API key"} className="bg-background border-border" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">From Address</label>
                  <Input data-testid="input-smtp-from" value={smtpFrom} onChange={e => setSmtpFrom(e.target.value)} placeholder="noreply@fullswap.app" className="bg-background border-border" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Admin Notify-To</label>
                  <Input data-testid="input-smtp-to" value={smtpTo} onChange={e => setSmtpTo(e.target.value)} placeholder="admin@example.com" className="bg-background border-border" />
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-6 items-start">

              {/* Admin email notification */}
              <div className="bg-card border border-border rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-primary" />
                    <h2 className="font-semibold text-foreground text-sm">Admin Email</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{smtpEnabled ? "On" : "Off"}</span>
                    <Switch checked={smtpEnabled} onCheckedChange={setSmtpEnabled} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sends a brief summary to your <strong>Admin Notify-To</strong> address every time a payment clears.
                </p>
                <Button
                  data-testid="button-test-email"
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 text-xs"
                  disabled={!smtpHost || !smtpTo || testing === "email"}
                  onClick={() => test("email")}
                >
                  {testing === "email" ? <><FlaskConical className="w-3.5 h-3.5 animate-pulse" />Sending...</> : <><FlaskConical className="w-3.5 h-3.5" />Send Test</>}
                </Button>
              </div>

              {/* User confirmation email */}
              <div className="bg-card border border-border rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Send className="w-4 h-4 text-teal-500" />
                    <h2 className="font-semibold text-foreground text-sm">User Receipt Email</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{userEmailEnabled ? "On" : "Off"}</span>
                    <Switch checked={userEmailEnabled} onCheckedChange={setUserEmailEnabled} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sends a branded payment receipt to the <strong>customer's email</strong> the moment their USDT is confirmed on-chain.
                </p>
                <Button
                  data-testid="button-test-user-email"
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 text-xs border-teal-500/30 text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950"
                  disabled={!smtpHost || testing === "user-email"}
                  onClick={() => test("user-email")}
                >
                  {testing === "user-email" ? <><FlaskConical className="w-3.5 h-3.5 animate-pulse" />Sending...</> : <><FlaskConical className="w-3.5 h-3.5" />Send Test</>}
                </Button>
                <p className="text-xs text-muted-foreground/60">Test sends to Admin Notify-To address</p>
              </div>

              {/* Webhook */}
              <div className="bg-card border border-border rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Webhook className="w-4 h-4 text-primary" />
                    <h2 className="font-semibold text-foreground text-sm">Webhook</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{webhookEnabled ? "On" : "Off"}</span>
                    <Switch checked={webhookEnabled} onCheckedChange={setWebhookEnabled} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  HTTP <code className="bg-muted px-1 rounded">POST</code> to your URL on every confirmed payment. Works with Zapier, Make, Discord, etc.
                </p>
                <div>
                  <Input
                    data-testid="input-webhook-url"
                    value={webhookUrl}
                    onChange={e => setWebhookUrl(e.target.value)}
                    placeholder="https://hooks.example.com/..."
                    className="bg-background border-border font-mono text-xs"
                  />
                </div>
                <Button
                  data-testid="button-test-webhook"
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 text-xs"
                  disabled={!webhookUrl || testing === "webhook"}
                  onClick={() => test("webhook")}
                >
                  {testing === "webhook" ? <><FlaskConical className="w-3.5 h-3.5 animate-pulse" />Sending...</> : <><FlaskConical className="w-3.5 h-3.5" />Send Test</>}
                </Button>
              </div>

            </div>

            {/* Webhook payload preview */}
            {webhookEnabled && (
              <div className="bg-muted/40 rounded-lg border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-2">Webhook payload preview</p>
                <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">{`{
  "event": "payment.confirmed",
  "invoiceId": "uuid",
  "userEmail": "user@example.com",
  "minutes": 60,
  "amountUsdt": 12,
  "txHash": "0x...",
  "paidAt": "ISO8601"
}`}</pre>
              </div>
            )}

          </div>
        )}

        <div className="flex justify-end">
          <Button data-testid="button-save-notifications" onClick={save} disabled={saving} className="gap-2 min-w-32">
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
