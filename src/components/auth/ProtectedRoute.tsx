import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Building2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clearAllAppLocalStorage, getCachedWorkspaceIdentity } from '@/components/layout/GlobalLoadingHandler';
import { saveReturnTo } from '@/lib/returnTo';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, loading } = useAuth();
  const { profile, loading: profileLoading, error: profileError, refetch } = useUserProfile();
  const location = useLocation();
  const [isRetrying, setIsRetrying] = useState(false);
  const [loadingTooLong, setLoadingTooLong] = useState(false);
  const [autoRetries, setAutoRetries] = useState(0);
  const [passwordCheckDone, setPasswordCheckDone] = useState(false);
  const [passwordIsSet, setPasswordIsSet] = useState<boolean | null>(null);

  // Timeout: if loading takes more than 15 seconds, show error state
  useEffect(() => {
    const hasWorkspaceIdentity = !!(profile?.tenant_id && profile?.role);
    
    if (!hasWorkspaceIdentity && !profileError) {
      const timer = setTimeout(() => {
        console.warn('[ProtectedRoute] Loading workspace took too long (15s), showing error state');
        setLoadingTooLong(true);
      }, 15000);
      
      return () => clearTimeout(timer);
    } else {
      setLoadingTooLong(false);
    }
  }, [profile?.tenant_id, profile?.role, profileError]);

  // Auto-retry transient workspace load failures (Supabase/network blips) before showing an error
  useEffect(() => {
    if (!user) return;
    const hasWorkspaceIdentity = !!(profile?.tenant_id && profile?.role);
    if (hasWorkspaceIdentity) {
      if (autoRetries !== 0) setAutoRetries(0);
      return;
    }
    if (!profileError || profileLoading) return;
    if (autoRetries >= 3) return;

    const delay = 800 * Math.pow(2, autoRetries);
    const timer = setTimeout(() => {
      console.warn(`[ProtectedRoute] Workspace load failed, auto-retry ${autoRetries + 1}/3`);
      setAutoRetries((n) => n + 1);
      refetch();
    }, delay);

    return () => clearTimeout(timer);
  }, [user, profile?.tenant_id, profile?.role, profileError, profileLoading, autoRetries, refetch]);


  // Password status comes from the same workspace bootstrap response. Do not
  // add another profile request to every login; that made the dashboard wait
  // behind a second database round trip during service slowdowns.
  useEffect(() => {
    if (!user) return;

    const cachedIdentity = getCachedWorkspaceIdentity(user.id);
    const workspaceReady = !!(
      (profile?.tenant_id && profile?.role) ||
      (cachedIdentity?.tenant_id && cachedIdentity?.role)
    );
    if (!workspaceReady) return;

    const passwordSetupInProgress = localStorage.getItem('pitch_password_setup_in_progress') === 'true';
    if (passwordSetupInProgress || profile?.password_set_at === undefined) {
      // An absent field means the instant cached profile is being used. Never
      // block or redirect an established session while bootstrap refreshes it.
      setPasswordIsSet(true);
    } else {
      setPasswordIsSet(Boolean(profile.password_set_at));
      if (profile.password_set_at) localStorage.removeItem('pitch_password_setup_in_progress');
    }
    setPasswordCheckDone(true);
  }, [user, profile?.tenant_id, profile?.role, profile?.password_set_at]);

  const handleRetry = async () => {
    setIsRetrying(true);
    setLoadingTooLong(false);
    try {
      await refetch();
    } finally {
      setIsRetrying(false);
    }
  };

  const forceSignOut = async () => {
    clearAllAppLocalStorage();
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: 'local' }),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch (e) {
      console.warn('[ProtectedRoute] signOut failed, clearing locally:', e);
    }
    window.location.replace('/login');
  };

  const handleResetAndRetry = forceSignOut;

  const handleSignOut = forceSignOut;


  // Show loading while checking auth
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verifying authentication...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!user) {
    console.log('[ProtectedRoute] No valid session, redirecting to login');
    // Remember where they were so a refresh returns them to the same page.
    saveReturnTo(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Show error state with retry/signout options (including timeout case)
  if ((profileError && !profileLoading && autoRetries >= 3) || loadingTooLong) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-6 max-w-md text-center p-6">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <div>
            <h2 className="text-xl font-semibold text-foreground mb-2">
              {loadingTooLong ? 'Taking too long to load' : "Couldn't load your workspace"}
            </h2>
            <p className="text-muted-foreground">
              {loadingTooLong 
                ? 'Your workspace is taking longer than expected. This might be due to a slow connection or browser extensions blocking requests.'
                : 'We had trouble loading your company data. Please try again or sign out and back in.'
              }
            </p>
          </div>
          <div className="flex flex-col gap-3 w-full">
            <Button onClick={handleRetry} disabled={isRetrying} className="w-full">
              {isRetrying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Retrying...
                </>
              ) : (
                'Try Again'
              )}
            </Button>
            <Button variant="outline" onClick={handleResetAndRetry} className="w-full">
              <RefreshCw className="h-4 w-4 mr-2" />
              Reset & Sign In Again
            </Button>
            <Button variant="ghost" onClick={handleSignOut} className="w-full">
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Check for cached workspace identity first (instant entry)
  const cachedIdentity = getCachedWorkspaceIdentity(user.id);
  const hasWorkspaceIdentity = !!(
    (profile?.tenant_id && profile?.role) || 
    (cachedIdentity?.tenant_id && cachedIdentity?.role)
  );

  // IMPORTANT: don't block on profileLoading if we already have tenant+role (prevents being stuck forever)
  if (!hasWorkspaceIdentity) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Building2 className="h-10 w-10 text-primary animate-pulse" />
          <div className="text-center">
            <p className="text-lg font-medium text-foreground">Loading your workspace...</p>
            <p className="text-sm text-muted-foreground mt-1">Setting up your company dashboard</p>
          </div>
        </div>
      </div>
    );
  }

  // Wait for password check before rendering (only after workspace identity confirmed)
  if (hasWorkspaceIdentity && !passwordCheckDone) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verifying account...</p>
        </div>
      </div>
    );
  }

  // Redirect if password not set (based on fresh database check)
  if (hasWorkspaceIdentity && passwordIsSet === false) {
    console.log('[ProtectedRoute] User has not set password, redirecting to request-setup-link');
    return <Navigate to="/request-setup-link" state={{ needsPasswordSetup: true }} replace />;
  }

  return <>{children}</>;
};
