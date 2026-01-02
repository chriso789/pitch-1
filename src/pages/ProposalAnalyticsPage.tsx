import React from 'react';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { ProposalAnalyticsDashboard } from '@/components/analytics/ProposalAnalyticsDashboard';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { Loader2 } from 'lucide-react';

export default function ProposalAnalyticsPage() {
  const { profile, loading } = useUserProfile();

  if (loading) {
    return (
      <GlobalLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </GlobalLayout>
    );
  }

  if (!profile?.tenant_id) {
    return (
      <GlobalLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <p className="text-muted-foreground">No tenant found</p>
        </div>
      </GlobalLayout>
    );
  }

  return (
    <GlobalLayout>
      <ProposalAnalyticsDashboard tenantId={profile.tenant_id} />
    </GlobalLayout>
  );
}
