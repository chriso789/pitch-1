import React from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useFeatureAccess, type FeatureKey } from '@/hooks/useFeatureAccess';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface FeatureProtectedRouteProps {
  feature: FeatureKey | string;
  children: React.ReactNode;
}

/**
 * Combines auth (ProtectedRoute) with a tenant feature gate. Direct URL
 * access to a disabled feature renders an in-app "not available" notice
 * instead of the page contents.
 */
export const FeatureProtectedRoute: React.FC<FeatureProtectedRouteProps> = ({
  feature,
  children,
}) => {
  return (
    <ProtectedRoute>
      <FeatureGuard feature={feature}>{children}</FeatureGuard>
    </ProtectedRoute>
  );
};

const FeatureGuard: React.FC<FeatureProtectedRouteProps> = ({ feature, children }) => {
  const { hasFeature, isLoading, isPlatformDisabled, platformReason } = useFeatureAccess();
  const navigate = useNavigate();

  if (isLoading) return <>{children}</>;
  if (hasFeature(feature)) return <>{children}</>;

  const platformOffline = isPlatformDisabled(feature);
  const reason = platformReason(feature);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-4">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-1">
              {platformOffline ? 'Temporarily offline' : 'Feature not enabled'}
            </h3>
            <p className="text-muted-foreground text-sm">
              {platformOffline
                ? reason ??
                  'This feature is temporarily disabled for maintenance. Please check back soon.'
                : 'This feature is not enabled for your account. Contact your administrator to request access.'}
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate('/dashboard')}>
            Back to dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
