import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Building2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clearAllAppLocalStorage, getCachedWorkspaceIdentity } from '@/components/layout/GlobalLoadingHandler';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, loading, validateSession } = useAuth();
  const { profile, loading: profileLoading, error: profileError, refetch } = useUserProfile();
  const location = useLocation();
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [loadingTooLong, setLoadingTooLong] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      if (!loading) {
        if (user) {
          const valid = await validateSession();
          setIsValid(valid);
        } else {
          setIsValid(false);
        }
        setIsValidating(false);
      }
    };

    checkAuth();
  }, [user, loading, validateSession]);

  // Timeout: if loading takes more than 8 seconds, show error state
  useEffect(() => {
    const hasWorkspaceIdentity = !!(profile?.tenant_id && profile?.role);
    
    if (!hasWorkspaceIdentity && !profileError) {
      const timer = setTimeout(() => {
        console.warn('[ProtectedRoute] Loading workspace took too long (8s), showing error state');
        setLoadingTooLong(true);
      }, 8000);
      
      return () => clearTimeout(timer);
    } else {
      setLoadingTooLong(false);
    }
  }, [profile?.tenant_id, profile?.role, profileError]);

  const handleRetry = async () => {
    setIsRetrying(true);
    setLoadingTooLong(false);
    try {
      await refetch();
    } finally {
      setIsRetrying(false);
    }
  };

  const handleResetAndRetry = async () => {
    // Clear all app state and reload
    clearAllAppLocalStorage();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const handleSignOut = async () => {
    clearAllAppLocalStorage();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  // Show loading while checking auth
  if (loading || isValidating) {
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
  if (!user || !isValid) {
    console.log('[ProtectedRoute] No valid session, redirecting to login');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Show error state with retry/signout options (including timeout case)
  if ((profileError && !profileLoading) || loadingTooLong) {
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

  // CRITICAL: Check if user needs to complete password setup
  // Skip this check if password setup is actively in progress (user on setup-account page)
  const passwordSetupInProgress = localStorage.getItem('pitch_password_setup_in_progress') === 'true';
  
  if (profile && !profile.password_set_at && !passwordSetupInProgress) {
    console.log('[ProtectedRoute] User has not set password, redirecting to request-setup-link');
    return <Navigate to="/request-setup-link" state={{ needsPasswordSetup: true }} replace />;
  }

  return <>{children}</>;
};
