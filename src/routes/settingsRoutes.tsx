import React, { Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

const SettingsPage = React.lazy(() => import("@/pages/Settings"));
const AIAgentSettingsPage = React.lazy(() => import("@/pages/settings/AIAgentSettingsPage"));
const AIAdminPage = React.lazy(() => import("@/pages/settings/AIAdminPage"));
const CompanyReferralSettingsPage = React.lazy(() => import("@/pages/app/settings/CompanyReferralSettingsPage"));
const QuickBooksMappingsPage = React.lazy(() => import("@/pages/settings/QuickBooksMappingsPage"));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

export default function SettingsRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route index element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="ai-agent" element={<ProtectedRoute><AIAgentSettingsPage /></ProtectedRoute>} />
        <Route path="ai-admin" element={<ProtectedRoute><AIAdminPage /></ProtectedRoute>} />
        <Route path="company-referrals" element={<ProtectedRoute><CompanyReferralSettingsPage /></ProtectedRoute>} />
        <Route path="quickbooks/mappings" element={<ProtectedRoute><QuickBooksMappingsPage /></ProtectedRoute>} />
        <Route path="integrations/quickbooks/mappings" element={<ProtectedRoute><QuickBooksMappingsPage /></ProtectedRoute>} />
      </Routes>
    </Suspense>
  );
}
