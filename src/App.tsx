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

// Eager imports – landing / auth / lightweight public pages
import LandingPage from "./pages/LandingPage";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import SetupAccount from "./pages/SetupAccount";
import ConfirmEmail from "./pages/ConfirmEmail";
import NotFound from "./pages/NotFound";

// Grouped route modules
import { publicRoutes } from "./routes/publicRoutes";
import { mobileRoutes } from "./routes/mobileRoutes";
import { protectedRoutes } from "./routes/protectedRoutes";
import { adminRoutes } from "./routes/adminRoutes";

// Route-level loading fallback
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  </div>
);

// Service-worker helper: only register in production,
// proactively unregister in dev / preview / iframe
function manageServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;

  const isInIframe = (() => {
    try { return window.self !== window.top; } catch { return true; }
  })();
  const isPreviewHost =
    window.location.hostname.includes("id-preview--") ||
    window.location.hostname.includes("lovableproject.com");

  if (!import.meta.env.PROD || isPreviewHost || isInIframe) {
    navigator.serviceWorker.getRegistrations().then((regs) =>
      regs.forEach((r) => r.unregister())
    );
    caches.keys().then((names) => names.forEach((n) => caches.delete(n)));
    return;
  }

  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

const AppContent = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const navigate = useNavigate();

  useGlobalActivityTracking();

  useEffect(() => {
    if (import.meta.env.PROD) {
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
          {/* Eager public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Login initialTab="signup" />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/setup-account" element={<SetupAccount />} />
          <Route path="/auth/confirm-email" element={<ConfirmEmail />} />

          {/* Grouped route modules */}
          {publicRoutes}
          {mobileRoutes}
          {protectedRoutes}
          {adminRoutes}

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
