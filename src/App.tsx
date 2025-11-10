import React, { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { ErrorTrackingProvider } from "@/hooks/useErrorTracking";
import { LocationSelectionDialog } from "@/components/auth/LocationSelectionDialog";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider } from "@/contexts/AuthContext";
import { initSessionPersistence } from "@/utils/sessionPersistence";
import Index from "./pages/Index";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import ConfirmEmail from "./pages/ConfirmEmail";
import ContactProfile from "./pages/ContactProfile";
import JobDetails from "./pages/JobDetails";
import JobAnalytics from "./pages/JobAnalytics";
import JobAnalyticsDrilldown from "./pages/JobAnalyticsDrilldown";
import LeadDetails from "./pages/LeadDetails";
import ProjectDetails from "./pages/ProjectDetails";
import EnhancedMeasurement from "./pages/EnhancedMeasurement";
import DemoRequest from "./pages/DemoRequest";
import NotFound from "./pages/NotFound";
import QuickBooksCallback from "./pages/QuickBooksCallback";
import GoogleCalendarCallback from "./pages/GoogleCalendarCallback";
import PipelineEntryReview from "./pages/PipelineEntryReview";
import Dashboard from "./pages/Dashboard";
import Pipeline from "./pages/Pipeline";
import Production from "./pages/Production";
import ClientList from "./pages/ClientList";
import Calendar from "./pages/Calendar";
import StormCanvass from "./pages/StormCanvass";
import Dialer from "./pages/Dialer";
import SmartDocs from "./pages/SmartDocs";
import Settings from "./pages/Settings";
import Help from "./pages/Help";
import AutomationDashboard from "./pages/AutomationDashboard";
import Jobs from "./pages/Jobs";
import Estimates from "./pages/Estimates";
import MaterialCalculations from "./pages/MaterialCalculations";
import PresentationsPage from "./pages/PresentationsPage";
import PresentationBuilderPage from "./pages/PresentationBuilderPage";
import PresentationModePage from "./pages/PresentationModePage";
import CustomerPresentationView from "./pages/CustomerPresentationView";
import Campaigns from "./pages/Campaigns";
import CustomerPortal from "./pages/CustomerPortal";
import Approvals from "./pages/Approvals";
import TasksPage from "./pages/TasksPage";
import LeadScoringPage from "./pages/LeadScoringPage";
import ReviewsPage from "./pages/ReviewsPage";
import IntegrationDashboard from "./pages/IntegrationDashboard";
import AIAgentsCommandCenter from "./pages/AIAgentsCommandCenter";
import PowerDialerAgent from "./pages/PowerDialerAgent";
import ContractReports from "./pages/ContractReports";
import MaterialOrders from "./pages/MaterialOrders";
import MaterialOrderDetail from "./pages/MaterialOrderDetail";
import ApprovalRules from "./pages/ApprovalRules";
import PendingApprovals from "./pages/PendingApprovals";
import ManagerApprovalQueue from "./pages/ManagerApprovalQueue";
import VendorManagement from "./pages/VendorManagement";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const AppContent = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id || null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUserId(session?.user?.id || null);
      
      // Redirect to login if signed out (except if already on public pages)
      if (event === 'SIGNED_OUT') {
        const publicPaths = ['/login', '/demo-request', '/reset-password', '/auth/confirm-email'];
        if (!publicPaths.includes(window.location.pathname)) {
          navigate('/login');
        }
      }
    });

    // Initialize session persistence
    const cleanup = initSessionPersistence();

    return () => {
      subscription.unsubscribe();
      cleanup();
    };
  }, [navigate]);

  return (
    <>
      <Toaster />
      <Sonner />
      {userId && (
        <LocationSelectionDialog 
          userId={userId} 
          onLocationSelected={setActiveLocationId}
        />
      )}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/auth/confirm-email" element={<ConfirmEmail />} />
        <Route path="/demo-request" element={<DemoRequest />} />
        <Route path="/quickbooks/callback" element={<QuickBooksCallback />} />
        <Route path="/google-calendar/callback" element={<GoogleCalendarCallback />} />
        
        {/* Main application routes */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/production" element={<Production />} />
        <Route path="/client-list" element={<ClientList />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/storm-canvass" element={<StormCanvass />} />
        <Route path="/dialer" element={<Dialer />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/smartdocs" element={<SmartDocs />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/estimates" element={<Estimates />} />
        <Route path="/automation" element={<AutomationDashboard />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/lead-scoring" element={<LeadScoringPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/presentations" element={<PresentationsPage />} />
        <Route path="/presentations/:id/edit" element={<PresentationBuilderPage />} />
        <Route path="/presentations/:id/present" element={<PresentationModePage />} />
        <Route path="/presentations/:id/view" element={<CustomerPresentationView />} />
        <Route path="/portal" element={<CustomerPortal />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/help" element={<Help />} />
        <Route path="/integration" element={<IntegrationDashboard />} />
        <Route path="/ai-agents" element={<AIAgentsCommandCenter />} />
        <Route path="/power-dialer-agent" element={<PowerDialerAgent />} />
        <Route path="/contract-reports" element={<ContractReports />} />
        <Route path="/material-calculations/:id" element={<MaterialCalculations />} />
          <Route path="/material-orders" element={<MaterialOrders />} />
          <Route path="/material-orders/:id" element={<MaterialOrderDetail />} />
          <Route path="/approval-rules" element={<ApprovalRules />} />
          <Route path="/pending-approvals" element={<PendingApprovals />} />
          <Route path="/manager-approval-queue" element={<ManagerApprovalQueue />} />
          <Route path="/vendor-management" element={<VendorManagement />} />
        
        {/* Detail pages */}
        <Route path="/contact/:id" element={<ContactProfile />} />
        <Route path="/lead/:id" element={<LeadDetails />} />
        <Route path="/job/:id" element={<JobDetails />} />
        <Route path="/job-analytics" element={<JobAnalytics />} />
        <Route path="/job-analytics/drilldown" element={<JobAnalyticsDrilldown />} />
        <Route path="/pipeline-entry/:id/review" element={<PipelineEntryReview />} />
        <Route path="/project/:id" element={<ProjectDetails />} />
        <Route path="/enhanced-measurement/:id" element={<EnhancedMeasurement />} />
        
        <Route path="/" element={<Index />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ErrorTrackingProvider>
          <TooltipProvider>
            <BrowserRouter>
              <AppContent />
            </BrowserRouter>
          </TooltipProvider>
        </ErrorTrackingProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
