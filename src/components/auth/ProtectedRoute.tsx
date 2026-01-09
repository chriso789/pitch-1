import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Building2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

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

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await refetch();
    } finally {
      setIsRetrying(false);
    }
  };

  const handleSignOut = async () => {
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

  // Show error state with retry/signout options
  if (profileError && !profileLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-6 max-w-md text-center p-6">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <div>
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Couldn't load your workspace
            </h2>
            <p className="text-muted-foreground">
              We had trouble loading your company data. Please try again or sign out and back in.
            </p>
          </div>
          <div className="flex gap-3">
            <Button onClick={handleRetry} disabled={isRetrying}>
              {isRetrying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Retrying...
                </>
              ) : (
                'Try Again'
              )}
            </Button>
            <Button variant="outline" onClick={handleSignOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Wait for minimum workspace identity (tenant + role). DB can hydrate in background.
  const hasWorkspaceIdentity = !!(profile?.tenant_id && profile?.role);

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

  return <>{children}</>;
};
