import React from "react";
import { Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

const CompanyAdminPage = React.lazy(() => import("@/pages/admin/CompanyAdminPage"));
const MonitoringPage = React.lazy(() => import("@/pages/admin/MonitoringPage"));
const PhoneSettings = React.lazy(() => import("@/pages/admin/PhoneSettings"));
const ActivityDashboardPage = React.lazy(() => import("@/pages/admin/ActivityDashboardPage"));
const HomeownerPortalAdmin = React.lazy(() => import("@/pages/admin/HomeownerPortalAdmin"));
const AuditLogs = React.lazy(() => import("@/pages/AuditLogs"));
const AIAgentSettingsPage = React.lazy(() => import("@/pages/settings/AIAgentSettingsPage"));
const AIAdminPage = React.lazy(() => import("@/pages/settings/AIAdminPage"));

export const adminRoutes = (
  <>
    <Route path="/admin/companies" element={<ProtectedRoute><CompanyAdminPage /></ProtectedRoute>} />
    <Route path="/admin/monitoring" element={<ProtectedRoute><MonitoringPage /></ProtectedRoute>} />
    <Route path="/admin/phone-settings" element={<ProtectedRoute><PhoneSettings /></ProtectedRoute>} />
    <Route path="/admin/activity" element={<ProtectedRoute><ActivityDashboardPage /></ProtectedRoute>} />
    <Route path="/admin/portal-users" element={<ProtectedRoute><HomeownerPortalAdmin /></ProtectedRoute>} />
    <Route path="/admin/audit-logs" element={<ProtectedRoute><AuditLogs /></ProtectedRoute>} />
    <Route path="/settings/ai-agent" element={<ProtectedRoute><AIAgentSettingsPage /></ProtectedRoute>} />
    <Route path="/settings/ai-admin" element={<ProtectedRoute><AIAdminPage /></ProtectedRoute>} />
  </>
);
