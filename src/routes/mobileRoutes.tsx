import React from "react";
import { Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

const MobileEntry = React.lazy(() => import("@/pages/MobileEntry"));
const DeepLinkResolver = React.lazy(() => import("@/pages/DeepLinkResolver"));
const MobileFieldMode = React.lazy(() => import("@/pages/MobileFieldMode"));
const MobileAlerts = React.lazy(() => import("@/pages/MobileAlerts"));
const MobileJobPhotos = React.lazy(() => import("@/pages/MobileJobPhotos"));
const MobileSettings = React.lazy(() => import("@/pages/MobileSettings"));

export const mobileRoutes = (
  <>
    <Route path="/app/mobile" element={<MobileEntry />} />
    <Route path="/deeplink" element={<DeepLinkResolver />} />
    <Route path="/app/mobile/field" element={<ProtectedRoute><MobileFieldMode /></ProtectedRoute>} />
    <Route path="/app/mobile/alerts" element={<ProtectedRoute><MobileAlerts /></ProtectedRoute>} />
    <Route path="/app/mobile/jobs/:id/photos" element={<ProtectedRoute><MobileJobPhotos /></ProtectedRoute>} />
    <Route path="/app/mobile/settings" element={<ProtectedRoute><MobileSettings /></ProtectedRoute>} />
  </>
);
