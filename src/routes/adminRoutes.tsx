import React, { Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

const CompanyAdminPage = React.lazy(() => import("@/pages/admin/CompanyAdminPage"));
const MonitoringPage = React.lazy(() => import("@/pages/admin/MonitoringPage"));
const PhoneSettings = React.lazy(() => import("@/pages/admin/PhoneSettings"));
const ActivityDashboardPage = React.lazy(() => import("@/pages/admin/ActivityDashboardPage"));
const HomeownerPortalAdmin = React.lazy(() => import("@/pages/admin/HomeownerPortalAdmin"));
const AuditLogs = React.lazy(() => import("@/pages/AuditLogs"));
const AIAgentSettingsPage = React.lazy(() => import("@/pages/settings/AIAgentSettingsPage"));
const AIAdminPage = React.lazy(() => import("@/pages/settings/AIAdminPage"));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

export default function AdminRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="companies" element={<ProtectedRoute><CompanyAdminPage /></ProtectedRoute>} />
        <Route path="monitoring" element={<ProtectedRoute><MonitoringPage /></ProtectedRoute>} />
        <Route path="phone-settings" element={<ProtectedRoute><PhoneSettings /></ProtectedRoute>} />
        <Route path="activity" element={<ProtectedRoute><ActivityDashboardPage /></ProtectedRoute>} />
        <Route path="portal-users" element={<ProtectedRoute><HomeownerPortalAdmin /></ProtectedRoute>} />
        <Route path="audit-logs" element={<ProtectedRoute><AuditLogs /></ProtectedRoute>} />
      </Routes>
    </Suspense>
  );
}
