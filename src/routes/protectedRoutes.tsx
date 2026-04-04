import React, { Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

const Dashboard = React.lazy(() => import("@/pages/Dashboard"));
const Pipeline = React.lazy(() => import("@/pages/Pipeline"));
const Production = React.lazy(() => import("@/pages/Production"));
const ClientList = React.lazy(() => import("@/pages/ClientList"));
const Calendar = React.lazy(() => import("@/pages/Calendar"));
const StormCanvass = React.lazy(() => import("@/pages/StormCanvass"));
const LiveCanvassingPage = React.lazy(() => import("@/pages/storm-canvass/LiveCanvassingPage"));
const TerritoryMapPage = React.lazy(() => import("@/pages/storm-canvass/TerritoryMapPage"));
const CanvasserDashboard = React.lazy(() => import("@/pages/storm-canvass/CanvasserDashboard"));
const LeaderboardPage = React.lazy(() => import("@/pages/storm-canvass/LeaderboardPage"));
const ImportContacts = React.lazy(() => import("@/pages/storm-canvass/ImportContacts"));
const PropertyInteractionPage = React.lazy(() => import("@/pages/storm-canvass/PropertyInteractionPage"));
const CommunicationsHub = React.lazy(() => import("@/pages/CommunicationsHub"));
const UnmatchedInboxPage = React.lazy(() => import("@/pages/UnmatchedInboxPage"));
const AIFollowupQueuePage = React.lazy(() => import("@/pages/AIFollowupQueuePage"));
const CallCenterPage = React.lazy(() => import("@/pages/CallCenterPage"));
const Campaigns = React.lazy(() => import("@/pages/Campaigns"));
const SmartDocs = React.lazy(() => import("@/pages/SmartDocs"));
const Jobs = React.lazy(() => import("@/pages/Jobs"));
const Estimates = React.lazy(() => import("@/pages/Estimates"));
const AutomationDashboard = React.lazy(() => import("@/pages/AutomationDashboard"));
const TasksPage = React.lazy(() => import("@/pages/TasksPage"));
const LeadScoringPage = React.lazy(() => import("@/pages/LeadScoringPage"));
const ReviewsPage = React.lazy(() => import("@/pages/ReviewsPage"));
const PresentationsPage = React.lazy(() => import("@/pages/PresentationsPage"));
const PresentationBuilderPage = React.lazy(() => import("@/pages/PresentationBuilderPage"));
const PresentationModePage = React.lazy(() => import("@/pages/PresentationModePage"));
const CustomerPresentationView = React.lazy(() => import("@/pages/CustomerPresentationView"));
const CustomerPortal = React.lazy(() => import("@/pages/CustomerPortal"));
const Approvals = React.lazy(() => import("@/pages/Approvals"));
const Settings = React.lazy(() => import("@/pages/Settings"));
const Help = React.lazy(() => import("@/pages/Help"));
const IntegrationDashboard = React.lazy(() => import("@/pages/IntegrationDashboard"));
const AIAgentsCommandCenter = React.lazy(() => import("@/pages/AIAgentsCommandCenter"));
const PowerDialerAgent = React.lazy(() => import("@/pages/PowerDialerAgent"));
const ContractReports = React.lazy(() => import("@/pages/ContractReports"));
const MaterialCalculations = React.lazy(() => import("@/pages/MaterialCalculations"));
const MaterialOrders = React.lazy(() => import("@/pages/MaterialOrders"));
const MaterialOrderDetail = React.lazy(() => import("@/pages/MaterialOrderDetail"));
const ApprovalRules = React.lazy(() => import("@/pages/ApprovalRules"));
const PendingApprovals = React.lazy(() => import("@/pages/PendingApprovals"));
const ManagerApprovalQueue = React.lazy(() => import("@/pages/ManagerApprovalQueue"));
const VendorManagement = React.lazy(() => import("@/pages/VendorManagement"));
const PriceManagement = React.lazy(() => import("@/pages/PriceManagement"));
const ContactProfile = React.lazy(() => import("@/pages/ContactProfile"));
const LeadDetails = React.lazy(() => import("@/pages/LeadDetails"));
const JobDetails = React.lazy(() => import("@/pages/JobDetails"));
const JobAnalytics = React.lazy(() => import("@/pages/JobAnalytics"));
const JobAnalyticsDrilldown = React.lazy(() => import("@/pages/JobAnalyticsDrilldown"));
const PipelineEntryReview = React.lazy(() => import("@/pages/PipelineEntryReview"));
const ProjectDetails = React.lazy(() => import("@/pages/ProjectDetails"));
const EnhancedMeasurement = React.lazy(() => import("@/pages/EnhancedMeasurement"));
const ProfessionalMeasurement = React.lazy(() => import("@/pages/ProfessionalMeasurement"));
const MeasurementWorkflowDemo = React.lazy(() => import("@/pages/MeasurementWorkflowDemo"));
const RoofMeasure = React.lazy(() => import("@/pages/RoofMeasure"));
const MeasurementCorrectionPage = React.lazy(() => import("@/pages/MeasurementCorrectionPage"));
const MeasurementAnalyticsPage = React.lazy(() => import("@/pages/MeasurementAnalyticsPage"));
const TestRoofMeasurement = React.lazy(() => import("@/pages/TestRoofMeasurement"));
const CanvasserLeaderboardPage = React.lazy(() => import("@/pages/CanvasserLeaderboardPage"));
const SmartTemplateEditorPage = React.lazy(() => import("@/pages/SmartTemplateEditorPage"));
const CalcTemplateEditorPage = React.lazy(() => import("@/pages/CalcTemplateEditorPage"));
const ProposalEditorPage = React.lazy(() => import("@/pages/ProposalEditorPage"));
const ProposalAnalyticsPage = React.lazy(() => import("@/pages/ProposalAnalyticsPage"));
const PermitExpediter = React.lazy(() => import("@/pages/PermitExpediter"));
const SchedulingDashboard = React.lazy(() => import("@/pages/SchedulingDashboard"));
const InsuranceClaimsDashboard = React.lazy(() => import("@/pages/InsuranceClaimsDashboard"));
const ScopeIntelligence = React.lazy(() => import("@/pages/ScopeIntelligence"));
const DispatchDashboard = React.lazy(() => import("@/pages/DispatchDashboard"));
const StormCanvassConfig = React.lazy(() => import("@/pages/StormCanvassConfig"));
const StormCanvassPhotos = React.lazy(() => import("@/pages/StormCanvassPhotos"));
const PropertyPhotoGallery = React.lazy(() => import("@/components/storm-canvass/PropertyPhotoGallery"));
const SurveyDashboard = React.lazy(() => import("@/pages/SurveyDashboard"));
const ReferralDashboard = React.lazy(() => import("@/pages/ReferralDashboard"));
const FacebookMarketingDashboard = React.lazy(() => import("@/pages/FacebookMarketingDashboard"));
const MarketingAssetsPage = React.lazy(() => import("@/pages/MarketingAssetsPage"));
const GoodBetterBestBuilderPage = React.lazy(() => import("@/pages/GoodBetterBestBuilderPage"));
const AutomatedReviewCollectionPage = React.lazy(() => import("@/pages/AutomatedReviewCollectionPage"));
const LoyaltyPointsPage = React.lazy(() => import("@/pages/LoyaltyPointsPage"));
const AccountsReceivable = React.lazy(() => import("@/pages/AccountsReceivable"));
const RoofMeasurementTrainer = React.lazy(() => import("@/pages/RoofMeasurementTrainer"));
const ReportImportDashboard = React.lazy(() => import("@/pages/ReportImportDashboard"));
const NotificationsPage = React.lazy(() => import("@/pages/NotificationsPage"));
const CommissionReport = React.lazy(() => import("@/pages/CommissionReport"));
const AIAgentDashboardPage = React.lazy(() => import("@/pages/AIAgentDashboardPage"));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

export default function ProtectedRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
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
        <Route path="/scheduling" element={<ProtectedRoute><SchedulingDashboard /></ProtectedRoute>} />
        <Route path="/insurance" element={<ProtectedRoute><InsuranceClaimsDashboard /></ProtectedRoute>} />
        <Route path="/scope-intelligence" element={<ProtectedRoute><ScopeIntelligence /></ProtectedRoute>} />
        <Route path="/dispatch" element={<ProtectedRoute><DispatchDashboard /></ProtectedRoute>} />
        <Route path="/storm-canvass/config" element={<ProtectedRoute><StormCanvassConfig /></ProtectedRoute>} />
        <Route path="/storm-canvass/photos" element={<ProtectedRoute><StormCanvassPhotos /></ProtectedRoute>} />
        <Route path="/canvass/property/:propertyId/photos" element={<ProtectedRoute><PropertyPhotoGallery /></ProtectedRoute>} />
        <Route path="/surveys" element={<ProtectedRoute><SurveyDashboard /></ProtectedRoute>} />
        <Route path="/referrals" element={<ProtectedRoute><ReferralDashboard /></ProtectedRoute>} />
        <Route path="/marketing/facebook" element={<ProtectedRoute><FacebookMarketingDashboard /></ProtectedRoute>} />
        <Route path="/marketing-assets" element={<ProtectedRoute><MarketingAssetsPage /></ProtectedRoute>} />
        <Route path="/proposals/good-better-best" element={<ProtectedRoute><GoodBetterBestBuilderPage /></ProtectedRoute>} />
        <Route path="/reviews/automated" element={<ProtectedRoute><AutomatedReviewCollectionPage /></ProtectedRoute>} />
        <Route path="/loyalty" element={<ProtectedRoute><LoyaltyPointsPage /></ProtectedRoute>} />
        <Route path="/accounts-receivable" element={<ProtectedRoute><AccountsReceivable /></ProtectedRoute>} />
        <Route path="/report-import" element={<ProtectedRoute><ReportImportDashboard /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
        <Route path="/commission-report" element={<ProtectedRoute><CommissionReport /></ProtectedRoute>} />
        <Route path="/ai-agent-dashboard" element={<ProtectedRoute><AIAgentDashboardPage /></ProtectedRoute>} />
      </Routes>
    </Suspense>
  );
}
