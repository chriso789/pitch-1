import React, { Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

const MobileEntry = React.lazy(() => import("@/pages/MobileEntry"));
const DeepLinkResolver = React.lazy(() => import("@/pages/DeepLinkResolver"));
const MobileFieldMode = React.lazy(() => import("@/pages/MobileFieldMode"));
const MobileAlerts = React.lazy(() => import("@/pages/MobileAlerts"));
const MobileJobPhotos = React.lazy(() => import("@/pages/MobileJobPhotos"));
const MobileSettings = React.lazy(() => import("@/pages/MobileSettings"));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

export default function MobileRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route index element={<DeepLinkResolver />} />
        <Route path="mobile" element={<MobileEntry />} />
        <Route path="mobile/field" element={<ProtectedRoute><MobileFieldMode /></ProtectedRoute>} />
        <Route path="mobile/alerts" element={<ProtectedRoute><MobileAlerts /></ProtectedRoute>} />
        <Route path="mobile/jobs/:id/photos" element={<ProtectedRoute><MobileJobPhotos /></ProtectedRoute>} />
        <Route path="mobile/settings" element={<ProtectedRoute><MobileSettings /></ProtectedRoute>} />
      </Routes>
    </Suspense>
  );
}
