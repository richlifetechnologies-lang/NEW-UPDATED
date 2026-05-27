import { lazy, Suspense } from "react";
  import { Switch, Route, Router as WouterRouter } from "wouter";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import { Toaster } from "@/components/ui/toaster";
  import { TooltipProvider } from "@/components/ui/tooltip";
  import { ErrorBoundary } from "@/components/error-boundary";
  import NotFound from "@/pages/not-found";

  // LoginPage is the only eager page — stream is lazy to avoid TDZ from @decartai/sdk
  import LoginPage from "@/pages/login";

  // All other pages: lazy-loaded so they never affect the initial bundle
  // StreamPage MUST be lazy — it imports @decartai/sdk + @workspace/api-client-react which cause TDZ crashes
  const StreamPage = lazy(() => import("@/pages/stream"));
  const DashboardPage = lazy(() => import("@/pages/dashboard"));
  const PopoutPage = lazy(() => import("@/pages/popout"));
  const AdminLoginPage = lazy(() => import("@/pages/admin-login"));
  const AdminDashboardPage = lazy(() => import("@/pages/admin-dashboard"));
  const AdminUsersPage = lazy(() => import("@/pages/admin-users"));
  const AdminPricingPage = lazy(() => import("@/pages/admin-pricing"));
  const AdminWalletPage = lazy(() => import("@/pages/admin-wallet"));
  const AdminSessionsPage = lazy(() => import("@/pages/admin-sessions"));
  const AdminNotificationsPage = lazy(() => import("@/pages/admin-notifications"));
  const AdminAdminSessionsPage = lazy(() => import("@/pages/admin-admin-sessions"));
  const AdminChatPage = lazy(() => import("@/pages/admin-chat"));
  const AdminDecartKeysPage = lazy(() => import("@/pages/admin-decart-keys"));
  const AdminApiMonitoringPage = lazy(() => import("@/pages/admin-api-monitoring"));
  const AdminLicenseKeysPage = lazy(() => import("@/pages/admin-license-keys"));
  const AdminSubAdminsPage = lazy(() => import("@/pages/admin-sub-admins"));
  const AdminAnalyticsPage = lazy(() => import("@/pages/admin-analytics"));
  const AdminBillingPage = lazy(() => import("@/pages/admin-billing"));
  const AdminBillingIntelligencePage = lazy(() => import("@/pages/admin-billing-intelligence"));
  const AdminBillingObservatoryPage = lazy(() => import("@/pages/admin-billing-observatory"));
  const AdminProfitDashboardPage = lazy(() => import("@/pages/admin-profit-dashboard"));
  const AdminBillingIntegrityPage = lazy(() => import("@/pages/admin-billing-integrity"));
  const AdminBillingRatePerKeyPage = lazy(() => import("@/pages/admin-billing-rate-per-key"));
  const AdminControlCenterPage = lazy(() => import("@/pages/admin-control-center"));
  const AdminUnifiedDashboardPage = lazy(() => import("@/pages/admin-unified-dashboard"));
  const AdminStreamHealthPage = lazy(() => import("@/pages/admin-stream-health"));
  const AdminSessionIntelligencePage = lazy(() => import("@/pages/admin-session-intelligence"));
  const AdminKeyUsagePage = lazy(() => import("@/pages/admin-key-usage"));
  const AdminBillingAuditPage = lazy(() => import("@/pages/admin-billing-audit"));
  const AdminLiveSessionsPage = lazy(() => import("@/pages/admin-live-sessions"));
  const AdminLicenseUsagePage = lazy(() => import("@/pages/admin-license-usage"));
  const SubAdminLoginPage = lazy(() => import("@/pages/subadmin-login"));
  const SubAdminDashboardPage = lazy(() => import("@/pages/subadmin-dashboard"));
  const SubAdminStreamPage = lazy(() => import("@/pages/subadmin-stream"));

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });


  function Router() {
    return (
      <Suspense fallback={null}>
        <Switch>
          <Route path="/" component={LoginPage} />
          <Route path="/stream" component={StreamPage} />
          <Route path="/dashboard" component={DashboardPage} />
          <Route path="/admin" component={AdminLoginPage} />
          <Route path="/admin/dashboard" component={AdminDashboardPage} />
          <Route path="/admin/users" component={AdminUsersPage} />
          <Route path="/admin/pricing" component={AdminPricingPage} />
          <Route path="/admin/wallet" component={AdminWalletPage} />
          <Route path="/admin/sessions" component={AdminSessionsPage} />
          <Route path="/admin/notifications" component={AdminNotificationsPage} />
          <Route path="/admin/admin-sessions" component={AdminAdminSessionsPage} />
          <Route path="/admin/chat" component={AdminChatPage} />
          <Route path="/admin/decart-keys" component={AdminDecartKeysPage} />
          <Route path="/admin/api-monitoring" component={AdminApiMonitoringPage} />
          <Route path="/admin/license-keys" component={AdminLicenseKeysPage} />
          <Route path="/admin/analytics" component={AdminAnalyticsPage} />
          <Route path="/popout" component={PopoutPage} />
          <Route path="/admin/sub-admins" component={AdminSubAdminsPage} />
          <Route path="/admin/billing" component={AdminBillingPage} />
          <Route path="/admin/billing-intelligence" component={AdminBillingIntelligencePage} />
          <Route path="/admin/observatory" component={AdminBillingObservatoryPage} />
          <Route path="/admin/profit-dashboard" component={AdminProfitDashboardPage} />
          <Route path="/admin/billing-integrity" component={AdminBillingIntegrityPage} />
          <Route path="/admin/billing-rate-per-key" component={AdminBillingRatePerKeyPage} />
          <Route path="/admin/control-center" component={AdminControlCenterPage} />
          <Route path="/admin/unified" component={AdminUnifiedDashboardPage} />
          <Route path="/admin/stream-health" component={AdminStreamHealthPage} />
          <Route path="/admin/session-intelligence" component={AdminSessionIntelligencePage} />
          <Route path="/admin/billing-audit" component={AdminBillingAuditPage} />
          <Route path="/admin/key-usage" component={AdminKeyUsagePage} />
          <Route path="/admin/live-sessions" component={AdminLiveSessionsPage} />
          <Route path="/admin/license-usage" component={AdminLicenseUsagePage} />
          <Route path="/subadmin" component={SubAdminLoginPage} />
          <Route path="/subadmin/dashboard" component={SubAdminDashboardPage} />
          <Route path="/subadmin/stream" component={SubAdminStreamPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    );
  }

  function App() {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ErrorBoundary>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
          </ErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  export default App;
  