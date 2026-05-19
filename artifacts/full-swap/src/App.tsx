import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/error-boundary";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import StreamPage from "@/pages/stream";
import AdminLoginPage from "@/pages/admin-login";
import AdminDashboardPage from "@/pages/admin-dashboard";
import AdminUsersPage from "@/pages/admin-users";
import AdminPricingPage from "@/pages/admin-pricing";
import AdminWalletPage from "@/pages/admin-wallet";
import AdminSessionsPage from "@/pages/admin-sessions";
import AdminNotificationsPage from "@/pages/admin-notifications";
import AdminAdminSessionsPage from "@/pages/admin-admin-sessions";
import AdminChatPage from "@/pages/admin-chat";
import AdminDecartKeysPage from "@/pages/admin-decart-keys";
import AdminApiMonitoringPage from "@/pages/admin-api-monitoring";
import AdminLicenseKeysPage from "@/pages/admin-license-keys";
import DashboardPage from "@/pages/dashboard";
import PopoutPage from "@/pages/popout";
import AdminSubAdminsPage from "@/pages/admin-sub-admins";
import AdminAnalyticsPage from "@/pages/admin-analytics";
import AdminBillingPage from "@/pages/admin-billing";
import AdminBillingIntelligencePage from "@/pages/admin-billing-intelligence";
import AdminBillingObservatoryPage from "@/pages/admin-billing-observatory";
import AdminProfitDashboardPage from "@/pages/admin-profit-dashboard";
import AdminBillingIntegrityPage from "@/pages/admin-billing-integrity";
import SubAdminDashboardPage from "@/pages/subadmin-dashboard";
import SubAdminLoginPage from "@/pages/subadmin-login";
import SubAdminStreamPage from "@/pages/subadmin-stream";
import AdminBillingRatePerKeyPage from "@/pages/admin-billing-rate-per-key";

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

const isDesktopApp = Boolean((window as any).electronAPI?.isElectron);

function Router() {
  return (
    <Switch>
      <Route path="/" component={isDesktopApp ? StreamPage : LoginPage} />
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
      <Route path="/subadmin" component={SubAdminLoginPage} />
      <Route path="/subadmin/dashboard" component={SubAdminDashboardPage} />
      <Route path="/subadmin/stream" component={SubAdminStreamPage} />
      <Route component={NotFound} />
    </Switch>
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
