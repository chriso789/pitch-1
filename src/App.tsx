import React, { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { ErrorTrackingProvider } from "@/hooks/useErrorTracking";
import { LocationSelectionDialog } from "@/components/auth/LocationSelectionDialog";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider } from "@/contexts/AuthContext";
import { UserProfileProvider } from "@/contexts/UserProfileContext";
import { ImageCacheProvider } from "@/contexts/ImageCacheContext";
import { LocationProvider } from "@/contexts/LocationContext";
import { useGlobalActivityTracking } from "@/hooks/useGlobalActivityTracking";
import { SessionExpiryHandler } from "@/components/auth/SessionExpiryHandler";
import { GlobalLoadingHandler } from "@/components/layout/GlobalLoadingHandler";
import GlobalErrorBoundary from "@/components/error/GlobalErrorBoundary";
import { initializeMonitoring } from "@/lib/MonitoringSelfHealing";
import { installFetchInterceptor } from "@/lib/apiInterceptor";
import LandingPage from "./pages/LandingPage";
import Pricing from "./pages/Pricing";
import Features from "./pages/Features";
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
import CommunicationsHub from "./pages/CommunicationsHub";
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
import PriceManagement from "./pages/PriceManagement";
import ProfessionalMeasurement from "./pages/ProfessionalMeasurement";
import MeasurementWorkflowDemo from "./pages/MeasurementWorkflowDemo";
import RoofMeasure from "./pages/RoofMeasure";
import LiveCanvassingPage from "./pages/storm-canvass/LiveCanvassingPage";
import TerritoryMapPage from "./pages/storm-canvass/TerritoryMapPage";
import CanvasserDashboard from "./pages/storm-canvass/CanvasserDashboard";
import LeaderboardPage from "./pages/storm-canvass/LeaderboardPage";
import ImportContacts from "./pages/storm-canvass/ImportContacts";
import PublicReportViewer from "./pages/PublicReportViewer";
import ViewQuote from "./pages/ViewQuote";
import MeasurementCorrectionPage from "./pages/MeasurementCorrectionPage";
import MeasurementAnalyticsPage from "./pages/MeasurementAnalyticsPage";
import SmartTemplateEditorPage from "./pages/SmartTemplateEditorPage";
import ProposalEditorPage from "./pages/ProposalEditorPage";
import PublicProposalView from "./pages/PublicProposalView";
import ProposalAnalyticsPage from "./pages/ProposalAnalyticsPage";
import CompanyAdminPage from "./pages/admin/CompanyAdminPage";
import TestRoofMeasurement from "./pages/TestRoofMeasurement";
import OnboardingWalkthrough from "./pages/onboarding/OnboardingWalkthrough";
import RequestSetupLink from "./pages/auth/RequestSetupLink";
import CustomerPortalPublic from "./pages/CustomerPortalPublic";
import PublicSignatureCapture from "./pages/PublicSignatureCapture";
import CrewPortalPage from "./pages/CrewPortalPage";
import HomeownerPortalPage from "./pages/HomeownerPortalPage";
import PortalLoginPage from "./pages/PortalLoginPage";
import { HomeownerProtectedRoute } from "./components/auth/HomeownerProtectedRoute";
import MonitoringPage from "./pages/admin/MonitoringPage";
import HomeownerSetupAccount from "./pages/HomeownerSetupAccount";
import CommissionReport from "./pages/CommissionReport";
import RoofMeasurementTrainer from "./pages/RoofMeasurementTrainer";
import PhoneSettings from "./pages/admin/PhoneSettings";
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

  // Enable global activity tracking (keystrokes, page views, clicks)
  useGlobalActivityTracking();

  // Initialize monitoring on app start
  useEffect(() => {
    initializeMonitoring();
    installFetchInterceptor();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id || null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUserId(session?.user?.id || null);
      
      // Redirect to landing if signed out (except if already on public pages)
      if (event === 'SIGNED_OUT') {
        const publicPaths = ['/', '/login', '/signup', '/demo-request', '/reset-password', '/auth/confirm-email', '/reports'];
        const isPublicPath = publicPaths.some(p => window.location.pathname === p || window.location.pathname.startsWith('/reports/'));
        if (!isPublicPath) {
          navigate('/');
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <>
      <GlobalLoadingHandler />
      <Toaster />
      <Sonner />
      <SessionExpiryHandler />
      {userId && (
        <LocationSelectionDialog 
          userId={userId} 
          onLocationSelected={setActiveLocationId}
        />
      )}
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Login initialTab="signup" />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/auth/confirm-email" element={<ConfirmEmail />} />
        <Route path="/demo-request" element={<DemoRequest />} />
        <Route path="/request-setup-link" element={<RequestSetupLink />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/features" element={<Features />} />
        <Route path="/quickbooks/callback" element={<QuickBooksCallback />} />
        <Route path="/google-calendar/callback" element={<GoogleCalendarCallback />} />
        <Route path="/reports/:token" element={<PublicReportViewer />} />
        <Route path="/onboarding/:token" element={<OnboardingWalkthrough />} />
        <Route path="/customer/:token" element={<CustomerPortalPublic />} />
        <Route path="/sign/:token" element={<PublicSignatureCapture />} />
        <Route path="/portal/login" element={<PortalLoginPage />} />
        <Route path="/portal/setup" element={<HomeownerSetupAccount />} />
        <Route path="/crew" element={<CrewPortalPage />} />
        <Route path="/homeowner" element={<HomeownerProtectedRoute><HomeownerPortalPage /></HomeownerProtectedRoute>} />
        <Route path="/view-quote/:token" element={<ViewQuote />} />
        <Route path="/proposal/:token" element={<PublicProposalView />} />
        
        {/* Protected application routes */}
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/pipeline" element={<ProtectedRoute><Pipeline /></ProtectedRoute>} />
        <Route path="/production" element={<ProtectedRoute><Production /></ProtectedRoute>} />
        <Route path="/client-list" element={<ProtectedRoute><ClientList /></ProtectedRoute>} />
        <Route path="/calendar" element={<ProtectedRoute><Calendar /></ProtectedRoute>} />
        <Route path="/storm-canvass" element={<ProtectedRoute><StormCanvass /></ProtectedRoute>} />
        <Route path="/storm-canvass/live" element={<ProtectedRoute><LiveCanvassingPage /></ProtectedRoute>} />
        <Route path="/storm-canvass/map" element={<ProtectedRoute><TerritoryMapPage /></ProtectedRoute>} />
        <Route path="/storm-canvass/dashboard" element={<ProtectedRoute><CanvasserDashboard /></ProtectedRoute>} />
        <Route path="/storm-canvass/leaderboard" element={<ProtectedRoute><LeaderboardPage /></ProtectedRoute>} />
        <Route path="/storm-canvass/import" element={<ProtectedRoute><ImportContacts /></ProtectedRoute>} />
        <Route path="/communications" element={<ProtectedRoute><CommunicationsHub /></ProtectedRoute>} />
        <Route path="/dialer" element={<ProtectedRoute><CommunicationsHub /></ProtectedRoute>} />
        <Route path="/campaigns" element={<ProtectedRoute><Campaigns /></ProtectedRoute>} />
        <Route path="/smartdocs" element={<ProtectedRoute><SmartDocs /></ProtectedRoute>} />
        <Route path="/jobs" element={<ProtectedRoute><Jobs /></ProtectedRoute>} />
        <Route path="/estimates" element={<ProtectedRoute><Estimates /></ProtectedRoute>} />
        <Route path="/automation" element={<ProtectedRoute><AutomationDashboard /></ProtectedRoute>} />
        <Route path="/tasks" element={<ProtectedRoute><TasksPage /></ProtectedRoute>} />
        <Route path="/lead-scoring" element={<ProtectedRoute><LeadScoringPage /></ProtectedRoute>} />
        <Route path="/reviews" element={<ProtectedRoute><ReviewsPage /></ProtectedRoute>} />
        <Route path="/presentations" element={<ProtectedRoute><PresentationsPage /></ProtectedRoute>} />
        <Route path="/presentations/:id/edit" element={<ProtectedRoute><PresentationBuilderPage /></ProtectedRoute>} />
        <Route path="/presentations/:id/present" element={<ProtectedRoute><PresentationModePage /></ProtectedRoute>} />
        <Route path="/presentations/:id/view" element={<ProtectedRoute><CustomerPresentationView /></ProtectedRoute>} />
        <Route path="/portal" element={<ProtectedRoute><CustomerPortal /></ProtectedRoute>} />
        <Route path="/approvals" element={<ProtectedRoute><Approvals /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/help" element={<ProtectedRoute><Help /></ProtectedRoute>} />
        <Route path="/integration" element={<ProtectedRoute><IntegrationDashboard /></ProtectedRoute>} />
        <Route path="/ai-agents" element={<ProtectedRoute><AIAgentsCommandCenter /></ProtectedRoute>} />
        <Route path="/power-dialer-agent" element={<ProtectedRoute><PowerDialerAgent /></ProtectedRoute>} />
        <Route path="/contract-reports" element={<ProtectedRoute><ContractReports /></ProtectedRoute>} />
        <Route path="/material-calculations/:id" element={<ProtectedRoute><MaterialCalculations /></ProtectedRoute>} />
        <Route path="/material-orders" element={<ProtectedRoute><MaterialOrders /></ProtectedRoute>} />
        <Route path="/material-orders/:id" element={<ProtectedRoute><MaterialOrderDetail /></ProtectedRoute>} />
        <Route path="/approval-rules" element={<ProtectedRoute><ApprovalRules /></ProtectedRoute>} />
        <Route path="/pending-approvals" element={<ProtectedRoute><PendingApprovals /></ProtectedRoute>} />
        <Route path="/manager-approval-queue" element={<ProtectedRoute><ManagerApprovalQueue /></ProtectedRoute>} />
        <Route path="/vendor-management" element={<ProtectedRoute><VendorManagement /></ProtectedRoute>} />
        <Route path="/price-management" element={<ProtectedRoute><PriceManagement /></ProtectedRoute>} />
        
        {/* Protected detail pages */}
        <Route path="/contact/:id" element={<ProtectedRoute><ContactProfile /></ProtectedRoute>} />
        <Route path="/lead/:id" element={<ProtectedRoute><LeadDetails /></ProtectedRoute>} />
        <Route path="/job/:id" element={<ProtectedRoute><JobDetails /></ProtectedRoute>} />
        <Route path="/job-analytics" element={<ProtectedRoute><JobAnalytics /></ProtectedRoute>} />
        <Route path="/job-analytics/drilldown" element={<ProtectedRoute><JobAnalyticsDrilldown /></ProtectedRoute>} />
        <Route path="/pipeline-entry/:id/review" element={<ProtectedRoute><PipelineEntryReview /></ProtectedRoute>} />
        <Route path="/project/:id" element={<ProtectedRoute><ProjectDetails /></ProtectedRoute>} />
        <Route path="/enhanced-measurement/:id" element={<ProtectedRoute><EnhancedMeasurement /></ProtectedRoute>} />
        <Route path="/professional-measurement/:id" element={<ProtectedRoute><ProfessionalMeasurement /></ProtectedRoute>} />
        <Route path="/measurement-workflow" element={<ProtectedRoute><MeasurementWorkflowDemo /></ProtectedRoute>} />
        <Route path="/roof-measure/:id" element={<ProtectedRoute><RoofMeasure /></ProtectedRoute>} />
        <Route path="/roof-measure" element={<ProtectedRoute><RoofMeasure /></ProtectedRoute>} />
        <Route path="/measurements/:id/corrections" element={<ProtectedRoute><MeasurementCorrectionPage /></ProtectedRoute>} />
        <Route path="/measurement-analytics" element={<ProtectedRoute><MeasurementAnalyticsPage /></ProtectedRoute>} />
        <Route path="/test-roof-measurement" element={<ProtectedRoute><TestRoofMeasurement /></ProtectedRoute>} />
        <Route path="/templates/smart-editor" element={<ProtectedRoute><SmartTemplateEditorPage /></ProtectedRoute>} />
        <Route path="/templates/smart-editor/:templateId" element={<ProtectedRoute><SmartTemplateEditorPage /></ProtectedRoute>} />
        <Route path="/proposals/create/:projectId" element={<ProtectedRoute><ProposalEditorPage /></ProtectedRoute>} />
        <Route path="/proposal-analytics" element={<ProtectedRoute><ProposalAnalyticsPage /></ProtectedRoute>} />
        
        {/* Protected admin routes */}
        <Route path="/admin/companies" element={<ProtectedRoute><CompanyAdminPage /></ProtectedRoute>} />
        <Route path="/admin/monitoring" element={<ProtectedRoute><MonitoringPage /></ProtectedRoute>} />
        <Route path="/admin/phone-settings" element={<ProtectedRoute><PhoneSettings /></ProtectedRoute>} />
        <Route path="/commission-report" element={<ProtectedRoute><CommissionReport /></ProtectedRoute>} />
        
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => {
  return (
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <UserProfileProvider>
            <LocationProvider>
              <ErrorTrackingProvider>
                <TooltipProvider>
                  <ImageCacheProvider>
                    <BrowserRouter>
                      <AppContent />
                    </BrowserRouter>
                  </ImageCacheProvider>
                </TooltipProvider>
              </ErrorTrackingProvider>
            </LocationProvider>
          </UserProfileProvider>
        </AuthProvider>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  );
};

export default App;
