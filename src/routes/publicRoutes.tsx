import React from "react";
import { Route } from "react-router-dom";
import { HomeownerProtectedRoute } from "@/components/auth/HomeownerProtectedRoute";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

const Pricing = React.lazy(() => import("@/pages/Pricing"));
const Features = React.lazy(() => import("@/pages/Features"));
const DemoRequest = React.lazy(() => import("@/pages/DemoRequest"));
const RequestSetupLink = React.lazy(() => import("@/pages/auth/RequestSetupLink"));
const Privacy = React.lazy(() => import("@/pages/legal/Privacy"));
const Terms = React.lazy(() => import("@/pages/legal/Terms"));
const Security = React.lazy(() => import("@/pages/legal/Security"));
const QuickBooksCallback = React.lazy(() => import("@/pages/QuickBooksCallback"));
const GoogleCalendarCallback = React.lazy(() => import("@/pages/GoogleCalendarCallback"));
const PublicReportViewer = React.lazy(() => import("@/pages/PublicReportViewer"));
const OnboardingWalkthrough = React.lazy(() => import("@/pages/onboarding/OnboardingWalkthrough"));
const CustomerPortalPublic = React.lazy(() => import("@/pages/CustomerPortalPublic"));
const PublicSignatureCapture = React.lazy(() => import("@/pages/PublicSignatureCapture"));
const PortalLoginPage = React.lazy(() => import("@/pages/PortalLoginPage"));
const HomeownerSetupAccount = React.lazy(() => import("@/pages/HomeownerSetupAccount"));
const CrewPortalPage = React.lazy(() => import("@/pages/CrewPortalPage"));
const HomeownerPortalPage = React.lazy(() => import("@/pages/HomeownerPortalPage"));
const ViewQuote = React.lazy(() => import("@/pages/ViewQuote"));
const PublicProposalView = React.lazy(() => import("@/pages/PublicProposalView"));
const PublicPortalView = React.lazy(() => import("@/pages/PublicPortalView"));
const PublicDocumentView = React.lazy(() => import("@/pages/PublicDocumentView"));

export const publicRoutes = (
  <>
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
  </>
);
