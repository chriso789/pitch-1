import React from 'react';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { InsuranceClaimManager } from '@/components/insurance/InsuranceClaimManager';
import { useUserProfile } from '@/contexts/UserProfileContext';

const InsuranceClaimsDashboard = () => {
  const { profile } = useUserProfile();

  return (
    <GlobalLayout>
      <div className="space-y-6">
        <InsuranceClaimManager tenantId={profile?.tenant_id} />
      </div>
    </GlobalLayout>
  );
};

export default InsuranceClaimsDashboard;
