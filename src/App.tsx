import React, { useState, useEffect, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
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
import { GlobalLocationHandler } from "@/components/layout/GlobalLocationHandler";
import GlobalErrorBoundary from "@/components/error/GlobalErrorBoundary";
import { initializeMonitoring } from "@/lib/MonitoringSelfHealing";
import { installFetchInterceptor } from "@/lib/apiInterceptor";
import { queryClient } from "@/lib/queryClient";
import { cleanupAllChannels } from "@/lib/realtimeManager";
import { RealTimeNotificationProvider } from "@/components/notifications/RealTimeNotificationProvider";
import { AIFixProvider } from "@/components/error/AIFixProvider";
import { HomeownerProtectedRoute } from "./components/auth/HomeownerProtectedRoute";

// ──────────────────────────────────────────────
// Eager imports – landing / auth / lightweight public pages
// ──────────────────────────────────────────────
import LandingPage from "./pages/LandingPage";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import SetupAccount from "./pages/SetupAccount";
import ConfirmEmail from "./pages/ConfirmEmail";
import NotFound from "./pages/NotFound";

// ──────────────────────────────────────────────
// Lazy-loaded pages – only fetched when navigated to
// ──────────────────────────────────────────────
const Pricing = React.lazy(() => import("./pages/Pricing"));
const Features = React.lazy(() => import("./pages/Features"));
const DemoRequest = React.lazy(() => import("./pages/DemoRequest"));
const RequestSetupLink = React.lazy(() => import("./pages/auth/RequestSetupLink"));
const Privacy = React.lazy(() => import("./pages/legal/Privacy"));
const Terms = React.lazy(() => import("./pages/legal/Terms"));
const Security = React.lazy(() => import("./pages/legal/Security"));
const QuickBooksCallback = React.lazy(() => import("./pages/QuickBooksCallback"));
const GoogleCalendarCallback = React.lazy(() => import("./pages/GoogleCalendarCallback"));
const PublicReportViewer = React.lazy(() => import("./pages/PublicReportViewer"));
const OnboardingWalkthrough = React.lazy(() => import("./pages/onboarding/OnboardingWalkthrough"));
const CustomerPortalPublic = React.lazy(() => import("./pages/CustomerPortalPublic"));
const PublicSignatureCapture = React.lazy(() => import("./pages/PublicSignatureCapture"));
const PortalLoginPage = React.lazy(() => import("./pages/PortalLoginPage"));
const HomeownerSetupAccount = React.lazy(() => import("./pages/HomeownerSetupAccount"));
const CrewPortalPage = React.lazy(() => import("./pages/CrewPortalPage"));
const HomeownerPortalPage = React.lazy(() => import("./pages/HomeownerPortalPage"));
const ViewQuote = React.lazy(() => import("./pages/ViewQuote"));
const PublicProposalView = React.lazy(() => import("./pages/PublicProposalView"));
const PublicPortalView = React.lazy(() => import("./pages/PublicPortalView"));
const PublicDocumentView = React.lazy(() => import("./pages/PublicDocumentView"));
const MobileEntry = React.lazy(() => import("./pages/MobileEntry"));
const DeepLinkResolver = React.lazy(() => import("./pages/DeepLinkResolver"));
const MobileFieldMode = React.lazy(() => import("./pages/MobileFieldMode"));
const MobileAlerts = React.lazy(() => import("./pages/MobileAlerts"));
const MobileJobPhotos = React.lazy(() => import("./pages/MobileJobPhotos"));
const MobileSettings = React.lazy(() => import("./pages/MobileSettings"));

// Protected pages
const AuditLogs = React.lazy(() => import("./pages/AuditLogs"));
const ContactProfile = React.lazy(() => import("./pages/ContactProfile"));
const JobDetails = React.lazy(() => import("./pages/JobDetails"));
const JobAnalytics = React.lazy(() => import("./pages/JobAnalytics"));
const JobAnalyticsDrilldown = React.lazy(() => import("./pages/JobAnalyticsDrilldown"));
const LeadDetails = React.lazy(() => import("./pages/LeadDetails"));
const ProjectDetails = React.lazy(() => import("./pages/ProjectDetails"));
const EnhancedMeasurement = React.lazy(() => import("./pages/EnhancedMeasurement"));
const PipelineEntryReview = React.lazy(() => import("./pages/PipelineEntryReview"));
const Dashboard = React.lazy(() => import("./pages/Dashboard"));
const Pipeline = React.lazy(() => import("./pages/Pipeline"));
const Production = React.lazy(() => import("./pages/Production"));
const ClientList = React.lazy(() => import("./pages/ClientList"));
const Calendar = React.lazy(() => import("./pages/Calendar"));
const StormCanvass = React.lazy(() => import("./pages/StormCanvass"));
const CommunicationsHub = React.lazy(() => import("./pages/CommunicationsHub"));
const SmartDocs = React.lazy(() => import("./pages/SmartDocs"));
const Settings = React.lazy(() => import("./pages/Settings"));
const Help = React.lazy(() => import("./pages/Help"));
const AutomationDashboard = React.lazy(() => import("./pages/AutomationDashboard"));
const Jobs = React.lazy(() => import("./pages/Jobs"));
const Estimates = React.lazy(() => import("./pages/Estimates"));
const MaterialCalculations = React.lazy(() => import("./pages/MaterialCalculations"));
const PresentationsPage = React.lazy(() => import("./pages/PresentationsPage"));
const PresentationBuilderPage = React.lazy(() => import("./pages/PresentationBuilderPage"));
const PresentationModePage = React.lazy(() => import("./pages/PresentationModePage"));
const CustomerPresentationView = React.lazy(() => import("./pages/CustomerPresentationView"));
const Campaigns = React.lazy(() => import("./pages/Campaigns"));
const CustomerPortal = React.lazy(() => import("./pages/CustomerPortal"));
const Approvals = React.lazy(() => import("./pages/Approvals"));
const TasksPage = React.lazy(() => import("./pages/TasksPage"));
const LeadScoringPage = React.lazy(() => import("./pages/LeadScoringPage"));
const ReviewsPage = React.lazy(() => import("./pages/ReviewsPage"));
const IntegrationDashboard = React.lazy(() => import("./pages/IntegrationDashboard"));
const AIAgentsCommandCenter = React.lazy(() => import("./pages/AIAgentsCommandCenter"));
const PowerDialerAgent = React.lazy(() => import("./pages/PowerDialerAgent"));
const ContractReports = React.lazy(() => import("./pages/ContractReports"));
const MaterialOrders = React.lazy(() => import("./pages/MaterialOrders"));
const MaterialOrderDetail = React.lazy(() => import("./pages/MaterialOrderDetail"));
const ApprovalRules = React.lazy(() => import("./pages/ApprovalRules"));
const PendingApprovals = React.lazy(() => import("./pages/PendingApprovals"));
const ManagerApprovalQueue = React.lazy(() => import("./pages/ManagerApprovalQueue"));
const VendorManagement = React.lazy(() => import("./pages/VendorManagement"));
const PriceManagement = React.lazy(() => import("./pages/PriceManagement"));
const ProfessionalMeasurement = React.lazy(() => import("./pages/ProfessionalMeasurement"));
const MeasurementWorkflowDemo = React.lazy(() => import("./pages/MeasurementWorkflowDemo"));
const RoofMeasure = React.lazy(() => import("./pages/RoofMeasure"));
const LiveCanvassingPage = React.lazy(() => import("./pages/storm-canvass/LiveCanvassingPage"));
const TerritoryMapPage = React.lazy(() => import("./pages/storm-canvass/TerritoryMapPage"));
const PropertyInteractionPage = React.lazy(() => import("./pages/storm-canvass/PropertyInteractionPage"));
const CanvasserDashboard = React.lazy(() => import("./pages/storm-canvass/CanvasserDashboard"));
const LeaderboardPage = React.lazy(() => import("./pages/storm-canvass/LeaderboardPage"));
const ImportContacts = React.lazy(() => import("./pages/storm-canvass/ImportContacts"));
const MeasurementCorrectionPage = React.lazy(() => import("./pages/MeasurementCorrectionPage"));
const MeasurementAnalyticsPage = React.lazy(() => import("./pages/MeasurementAnalyticsPage"));
const SmartTemplateEditorPage = React.lazy(() => import("./pages/SmartTemplateEditorPage"));
const CalcTemplateEditorPage = React.lazy(() => import("./pages/CalcTemplateEditorPage"));
const ProposalEditorPage = React.lazy(() => import("./pages/ProposalEditorPage"));
const ProposalAnalyticsPage = React.lazy(() => import("./pages/ProposalAnalyticsPage"));
const CompanyAdminPage = React.lazy(() => import("./pages/admin/CompanyAdminPage"));
const TestRoofMeasurement = React.lazy(() => import("./pages/TestRoofMeasurement"));
const MonitoringPage = React.lazy(() => import("./pages/admin/MonitoringPage"));
const HomeownerPortalAdmin = React.lazy(() => import("./pages/admin/HomeownerPortalAdmin"));
const CommissionReport = React.lazy(() => import("./pages/CommissionReport"));
const RoofMeasurementTrainer = React.lazy(() => import("./pages/RoofMeasurementTrainer"));
const ReportImportDashboard = React.lazy(() => import("./pages/ReportImportDashboard"));
const PhoneSettings = React.lazy(() => import("./pages/admin/PhoneSettings"));
const ActivityDashboardPage = React.lazy(() => import("./pages/admin/ActivityDashboardPage"));
const CanvasserLeaderboardPage = React.lazy(() => import("./pages/CanvasserLeaderboardPage"));
const NotificationsPage = React.lazy(() => import("./pages/NotificationsPage"));
const AIAgentSettingsPage = React.lazy(() => import("./pages/settings/AIAgentSettingsPage"));
const AIAdminPage = React.lazy(() => import("./pages/settings/AIAdminPage"));
const AIAgentDashboardPage = React.lazy(() => import("./pages/AIAgentDashboardPage"));
const PropertyPhotoGallery = React.lazy(() => import("./components/storm-canvass/PropertyPhotoGallery"));
const SchedulingDashboard = React.lazy(() => import("./pages/SchedulingDashboard"));
const InsuranceClaimsDashboard = React.lazy(() => import("./pages/InsuranceClaimsDashboard"));
const ScopeIntelligence = React.lazy(() => import("./pages/ScopeIntelligence"));
const DispatchDashboard = React.lazy(() => import("./pages/DispatchDashboard"));
const StormCanvassConfig = React.lazy(() => import("./pages/StormCanvassConfig"));
const StormCanvassPhotos = React.lazy(() => import("./pages/StormCanvassPhotos"));
const UnmatchedInboxPage = React.lazy(() => import("./pages/UnmatchedInboxPage"));
const AIFollowupQueuePage = React.lazy(() => import("./pages/AIFollowupQueuePage"));
const CallCenterPage = React.lazy(() => import("./pages/CallCenterPage"));
const PermitExpediter = React.lazy(() => import("./pages/PermitExpediter"));
const SurveyDashboard = React.lazy(() => import("./pages/SurveyDashboard"));
const ReferralDashboard = React.lazy(() => import("./pages/ReferralDashboard"));
const FacebookMarketingDashboard = React.lazy(() => import("./pages/FacebookMarketingDashboard"));
const GoodBetterBestBuilderPage = React.lazy(() => import("./pages/GoodBetterBestBuilderPage"));
const AutomatedReviewCollectionPage = React.lazy(() => import("./pages/AutomatedReviewCollectionPage"));
const LoyaltyPointsPage = React.lazy(() => import("./pages/LoyaltyPointsPage"));
const MarketingAssetsPage = React.lazy(() => import("./pages/MarketingAssetsPage"));
const AccountsReceivable = React.lazy(() => import("./pages/AccountsReceivable"));

// ──────────────────────────────────────────────
// Route-level loading fallback
// ──────────────────────────────────────────────
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  </div>
);

// ──────────────────────────────────────────────
// Service-worker helper: only register in production,
// proactively unregister in dev / preview / iframe
// ──────────────────────────────────────────────
function manageServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;

  const isInIframe = (() => {
    try { return window.self !== window.top; } catch { return true; }
  })();
  const isPreviewHost =
    window.location.hostname.includes("id-preview--") ||
    window.location.hostname.includes("lovableproject.com");

  if (!import.meta.env.PROD || isPreviewHost || isInIframe) {
    // Unregister all service workers & clear caches in non-production contexts
    navigator.serviceWorker.getRegistrations().then((regs) =>
      regs.forEach((r) => r.unregister())
    );
    caches.keys().then((names) => names.forEach((n) => caches.delete(n)));
    return;
  }

  // Production only – register static-asset cache worker
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

const AppContent = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const navigate = useNavigate();

  // Only enable activity tracking and monitoring in production
  const isProd = import.meta.env.PROD;
  if (isProd) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useGlobalActivityTracking();
  }

  useEffect(() => {
    if (isProd) {
      initializeMonitoring();
      installFetchInterceptor();
    }
    manageServiceWorkers();
    return () => { cleanupAllChannels(); };
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id || null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUserId(session?.user?.id || null);

      const passwordSetupPaths = ['/reset-password', '/setup-account'];
      const isOnPasswordSetupPage = passwordSetupPaths.some(p => window.location.pathname === p);
      if (isOnPasswordSetupPage) return;

      if (event === 'SIGNED_OUT') {
        const publicPaths = ['/', '/login', '/signup', '/demo-request', '/reset-password', '/setup-account', '/auth/confirm-email', '/reports'];
        const isPublicPath = publicPaths.some(p => window.location.pathname === p || window.location.pathname.startsWith('/reports/'));
        if (!isPublicPath) navigate('/');
      }
    });

    return () => { subscription.unsubscribe(); };
  }, [navigate]);

  return (
    <>
      <GlobalLoadingHandler />
      <GlobalLocationHandler />
      <Toaster />
      <Sonner />
      <SessionExpiryHandler />
      {userId && (
        <LocationSelectionDialog userId={userId} onLocationSelected={setActiveLocationId} />
      )}
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public routes – eager */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Login initialTab="signup" />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/setup-account" element={<SetupAccount />} />
          <Route path="/auth/confirm-email" element={<ConfirmEmail />} />

          {/* Public routes – lazy */}
          <Route path="/demo-request" element={<DemoRequest />} />
          <Route path="/request-setup-link" element={<RequestSetupLink />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/features" element={<Features />} />
          <Route path="/legal/privacy" element={<Privacy />} />
          <Route path="/legal/terms" element={<Terms />} />
          <Route path="/legal/security" element={<Security />} />
          <Route path="/quickbooks/callback" element={<QuickBooksCallback />} />
          <Route path="/google-calendar/callback" element={<GoogleCalendarCallback />} />
          <Route path="/reports/:token" element={<PublicReportViewer />} />
          <Route path="/r/:token" element={<PublicReportViewer />} />
          <Route path="/onboarding/:token" element={<OnboardingWalkthrough />} />
          <Route path="/customer/:token" element={<CustomerPortalPublic />} />
          <Route path="/sign/:token" element={<PublicSignatureCapture />} />
          <Route path="/portal/login" element={<PortalLoginPage />} />
          <Route path="/portal/setup" element={<HomeownerSetupAccount />} />
          <Route path="/crew" element={<CrewPortalPage />} />
          <Route path="/homeowner" element={<HomeownerProtectedRoute><HomeownerPortalPage /></HomeownerProtectedRoute>} />
          <Route path="/view-quote/:token" element={<ViewQuote />} />
          <Route path="/proposal/:token" element={<PublicProposalView />} />
          <Route path="/portal/:shareToken" element={<PublicPortalView />} />
          <Route path="/v/:token" element={<PublicDocumentView />} />
          <Route path="/app/mobile" element={<MobileEntry />} />
          <Route path="/deeplink" element={<DeepLinkResolver />} />
          <Route path="/app/mobile/field" element={<ProtectedRoute><MobileFieldMode /></ProtectedRoute>} />
          <Route path="/app/mobile/alerts" element={<ProtectedRoute><MobileAlerts /></ProtectedRoute>} />
          <Route path="/app/mobile/jobs/:id/photos" element={<ProtectedRoute><MobileJobPhotos /></ProtectedRoute>} />
          <Route path="/app/mobile/settings" element={<ProtectedRoute><MobileSettings /></ProtectedRoute>} />

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
          <Route path="/storm-canvass/property/:propertyId" element={<ProtectedRoute><PropertyInteractionPage /></ProtectedRoute>} />
          <Route path="/communications" element={<ProtectedRoute><CommunicationsHub /></ProtectedRoute>} />
          <Route path="/communications/unmatched" element={<ProtectedRoute><UnmatchedInboxPage /></ProtectedRoute>} />
          <Route path="/communications/ai-queue" element={<ProtectedRoute><AIFollowupQueuePage /></ProtectedRoute>} />
          <Route path="/communications/calls" element={<ProtectedRoute><CallCenterPage /></ProtectedRoute>} />
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

          {/* Detail pages */}
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
          <Route path="/canvasser-leaderboard" element={<ProtectedRoute><CanvasserLeaderboardPage /></ProtectedRoute>} />
          <Route path="/templates/smart-editor" element={<ProtectedRoute><SmartTemplateEditorPage /></ProtectedRoute>} />
          <Route path="/templates/smart-editor/:templateId" element={<ProtectedRoute><SmartTemplateEditorPage /></ProtectedRoute>} />
          <Route path="/templates/calc-editor/:templateId" element={<ProtectedRoute><CalcTemplateEditorPage /></ProtectedRoute>} />
          <Route path="/proposals/create/:projectId" element={<ProtectedRoute><ProposalEditorPage /></ProtectedRoute>} />
          <Route path="/proposal-analytics" element={<ProtectedRoute><ProposalAnalyticsPage /></ProtectedRoute>} />
          <Route path="/permits/expediter" element={<ProtectedRoute><PermitExpediter /></ProtectedRoute>} />

          {/* Admin routes */}
          <Route path="/admin/companies" element={<ProtectedRoute><CompanyAdminPage /></ProtectedRoute>} />
          <Route path="/admin/monitoring" element={<ProtectedRoute><MonitoringPage /></ProtectedRoute>} />
          <Route path="/admin/phone-settings" element={<ProtectedRoute><PhoneSettings /></ProtectedRoute>} />
          <Route path="/admin/activity" element={<ProtectedRoute><ActivityDashboardPage /></ProtectedRoute>} />
          <Route path="/admin/portal-users" element={<ProtectedRoute><HomeownerPortalAdmin /></ProtectedRoute>} />
          <Route path="/admin/audit-logs" element={<ProtectedRoute><AuditLogs /></ProtectedRoute>} />
          <Route path="/commission-report" element={<ProtectedRoute><CommissionReport /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
          <Route path="/settings/ai-agent" element={<ProtectedRoute><AIAgentSettingsPage /></ProtectedRoute>} />
          <Route path="/settings/ai-admin" element={<ProtectedRoute><AIAdminPage /></ProtectedRoute>} />
          <Route path="/ai-agent-dashboard" element={<ProtectedRoute><AIAgentDashboardPage /></ProtectedRoute>} />
          <Route path="/canvass/property/:propertyId/photos" element={<ProtectedRoute><PropertyPhotoGallery /></ProtectedRoute>} />
          <Route path="/scheduling" element={<ProtectedRoute><SchedulingDashboard /></ProtectedRoute>} />
          <Route path="/insurance" element={<ProtectedRoute><InsuranceClaimsDashboard /></ProtectedRoute>} />
          <Route path="/scope-intelligence" element={<ProtectedRoute><ScopeIntelligence /></ProtectedRoute>} />
          <Route path="/dispatch" element={<ProtectedRoute><DispatchDashboard /></ProtectedRoute>} />
          <Route path="/storm-canvass/config" element={<ProtectedRoute><StormCanvassConfig /></ProtectedRoute>} />
          <Route path="/storm-canvass/photos" element={<ProtectedRoute><StormCanvassPhotos /></ProtectedRoute>} />
          <Route path="/report-import" element={<ProtectedRoute><ReportImportDashboard /></ProtectedRoute>} />
          <Route path="/surveys" element={<ProtectedRoute><SurveyDashboard /></ProtectedRoute>} />
          <Route path="/referrals" element={<ProtectedRoute><ReferralDashboard /></ProtectedRoute>} />
          <Route path="/marketing/facebook" element={<ProtectedRoute><FacebookMarketingDashboard /></ProtectedRoute>} />
          <Route path="/marketing-assets" element={<ProtectedRoute><MarketingAssetsPage /></ProtectedRoute>} />
          <Route path="/proposals/good-better-best" element={<ProtectedRoute><GoodBetterBestBuilderPage /></ProtectedRoute>} />
          <Route path="/reviews/automated" element={<ProtectedRoute><AutomatedReviewCollectionPage /></ProtectedRoute>} />
          <Route path="/loyalty" element={<ProtectedRoute><LoyaltyPointsPage /></ProtectedRoute>} />
          <Route path="/accounts-receivable" element={<ProtectedRoute><AccountsReceivable /></ProtectedRoute>} />

          {/* Catch-all */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
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
                      <RealTimeNotificationProvider>
                        <AIFixProvider>
                          <BrowserRouter>
                            <AppContent />
                          </BrowserRouter>
                        </AIFixProvider>
                      </RealTimeNotificationProvider>
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
