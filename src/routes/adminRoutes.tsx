import React, { Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AdminRoute } from "@/components/auth/AdminRoute";

const CompanyAdminPage = React.lazy(() => import("@/pages/admin/CompanyAdminPage"));
const MonitoringPage = React.lazy(() => import("@/pages/admin/MonitoringPage"));
const PhoneSettings = React.lazy(() => import("@/pages/admin/PhoneSettings"));
const ActivityDashboardPage = React.lazy(() => import("@/pages/admin/ActivityDashboardPage"));
const HomeownerPortalAdmin = React.lazy(() => import("@/pages/admin/HomeownerPortalAdmin"));
const AuditLogs = React.lazy(() => import("@/pages/AuditLogs"));
const AIAgentSettingsPage = React.lazy(() => import("@/pages/settings/AIAgentSettingsPage"));
const AIAdminPage = React.lazy(() => import("@/pages/settings/AIAdminPage"));
const MeasurementSkillsPage = React.lazy(() => import("@/pages/admin/MeasurementSkillsPage"));
const MeasurementJobPipelinePage = React.lazy(() => import("@/pages/admin/MeasurementJobPipelinePage"));
const ProviderSourceInventoryPage = React.lazy(() => import("@/pages/admin/ProviderSourceInventoryPage"));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

export default function AdminRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="companies" element={<AdminRoute><CompanyAdminPage /></AdminRoute>} />
        <Route path="monitoring" element={<AdminRoute><MonitoringPage /></AdminRoute>} />
        <Route path="phone-settings" element={<AdminRoute><PhoneSettings /></AdminRoute>} />
        <Route path="activity" element={<AdminRoute><ActivityDashboardPage /></AdminRoute>} />
        <Route path="portal-users" element={<AdminRoute><HomeownerPortalAdmin /></AdminRoute>} />
        <Route path="audit-logs" element={<AdminRoute><AuditLogs /></AdminRoute>} />
        <Route path="measurement-skills" element={<AdminRoute><MeasurementSkillsPage /></AdminRoute>} />
        <Route path="measurement-skills/:jobId" element={<AdminRoute><MeasurementJobPipelinePage /></AdminRoute>} />
        <Route path="providers/inventory" element={<AdminRoute><ProviderSourceInventoryPage /></AdminRoute>} />
      </Routes>
    </Suspense>
  );
}
