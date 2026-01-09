import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { Loader2, Building2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, loading, validateSession } = useAuth();
  const { profile, loading: profileLoading } = useUserProfile();
  const location = useLocation();
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      if (!loading) {
        if (user) {
          // Validate the session is real
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

  // CRITICAL: Wait for profile to fully load with tenant_id and role
  // This prevents the "shell" dashboard with "User" role
  if (profileLoading || !profile?.profileLoaded || !profile?.tenant_id || !profile?.role) {
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
