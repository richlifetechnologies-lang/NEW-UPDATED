import { useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { setAdminToken, setAdminProfile } from "@/lib/auth";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Shield } from "lucide-react";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export default function AdminLoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (localStorage.getItem("fullswap_admin_token")) {
      const isSubAdmin = localStorage.getItem("fullswap_sub_admin") === "1";
      setLocation(isSubAdmin ? "/subadmin/dashboard" : "/admin/dashboard");
    }
  }, [setLocation]);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  // NOTE: This intentionally uses a direct fetch to /api/admin/login instead
  // of the generated useAdminLogin() hook from @workspace/api-client-react.
  // The generated AuthResponse type omits isSubAdmin and avatarUrl, which are
  // both required for correct post-login routing (main admin vs sub-admin).
  // DO NOT replace with the generated hook without first updating the OpenAPI
  // User schema to include isSubAdmin (integer) and avatarUrl (string|null).
  const adminLogin = useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      if (!res.ok) {
        // FIX: Read the real server error message instead of throwing a generic one.
        // This allows admins to diagnose actual failures:
        //   - "Invalid admin credentials" (wrong password / account not found)
        //   - "Account suspended"
        //   - SESSION_SECRET mismatch (hash computed with wrong key)
        //   - Any 400/500 server-side errors
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Login failed — please check your credentials");
      }
      return res.json() as Promise<{ token: string; user: { id: number; email: string; username: string; avatarUrl?: string | null; isSubAdmin?: number } }>;
    },
    onSuccess: (data) => {
      setAdminToken(data.token);
      setAdminProfile({
        username: data.user.username,
        email: data.user.email,
        avatarUrl: data.user.avatarUrl ?? null,
      });
      const isSubAdmin = data.user.isSubAdmin === 1;
      if (isSubAdmin) {
        localStorage.setItem("fullswap_sub_admin", "1");
        setLocation("/subadmin/dashboard");
      } else {
        localStorage.removeItem("fullswap_sub_admin");
        setLocation("/admin/dashboard");
      }
    },
    onError: (error: Error) => {
      // FIX: Use error.message (the real server message) instead of a hardcoded string.
      toast({ title: "Access denied", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8" data-testid="admin-login-page">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-destructive/20 border border-destructive/30 rounded flex items-center justify-center">
            <Shield className="w-6 h-6 text-destructive" />
          </div>
          <div>
            <p className="font-bold text-foreground font-mono">FULL SWAP BY RICH</p>
            <p className="text-xs text-muted-foreground">Main Admin Portal</p>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-6">Main Admin Login</h1>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => adminLogin.mutate(d))} className="space-y-4">
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Admin Email</FormLabel>
                <FormControl>
                  <Input data-testid="input-admin-email" type="email" className="bg-card border-border" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input data-testid="input-admin-password" type="password" className="bg-card border-border" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button data-testid="button-admin-login" type="submit" variant="destructive" className="w-full" disabled={adminLogin.isPending}>
              {adminLogin.isPending ? "Authenticating..." : "Admin Sign In"}
            </Button>
          </form>
        </Form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Main Admin access only — Sub Admins use the <a href="/subadmin" style={{ color: "hsl(187 100% 52%)" }}>Sub Admin Login</a>
        </p>
      </div>
    </div>
  );
}
