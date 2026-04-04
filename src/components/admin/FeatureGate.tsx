import React from 'react';
import { useFeatureAccess, FeatureKey } from '@/hooks/useFeatureAccess';
import { Card, CardContent } from '@/components/ui/card';
import { Lock } from 'lucide-react';

interface FeatureGateProps {
  feature: FeatureKey;
  children: React.ReactNode;
  /** Show a "not available" message instead of hiding completely */
  showMessage?: boolean;
  /** Custom fallback component */
  fallback?: React.ReactNode;
}

/**
 * Wrapper component that only renders children if the tenant
 * has the given feature enabled.
 */
export const FeatureGate: React.FC<FeatureGateProps> = ({
  feature,
  children,
  showMessage = false,
  fallback,
}) => {
  const { hasFeature, isLoading } = useFeatureAccess();

  if (isLoading) return <>{children}</>;

  if (!hasFeature(feature)) {
    if (fallback) return <>{fallback}</>;
    if (showMessage) {
      return (
        <Card className="max-w-md mx-auto mt-20">
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Lock className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Feature Not Available</h3>
            <p className="text-muted-foreground text-sm">
              This feature is not enabled for your account. Contact your administrator to request access.
            </p>
          </CardContent>
        </Card>
      );
    }
    return null;
  }

  return <>{children}</>;
};
