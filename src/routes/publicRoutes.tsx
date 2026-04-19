import React, { Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { HomeownerProtectedRoute } from "@/components/auth/HomeownerProtectedRoute";

const Pricing = React.lazy(() => import("@/pages/Pricing"));
const Features = React.lazy(() => import("@/pages/Features"));
const DemoRequest = React.lazy(() => import("@/pages/DemoRequest"));
const BookDemo = React.lazy(() => import("@/pages/BookDemo"));
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
const ZellePaymentPage = React.lazy(() => import("@/pages/ZellePaymentPage"));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

export default function PublicRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/demo-request" element={<DemoRequest />} />
        <Route path="/book-demo/:token" element={<BookDemo />} />
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
        <Route path="/pay/:token" element={<ZellePaymentPage />} />
      </Routes>
    </Suspense>
  );
}
