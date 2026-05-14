import { useState } from "react";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { getRoleLevel } from "@/lib/roleUtils";
import { ReferralOverview } from "@/components/referrals/admin/ReferralOverview";
import { ReferralLinksTable } from "@/components/referrals/admin/ReferralLinksTable";
import { ReferredLeadsTable } from "@/components/referrals/admin/ReferredLeadsTable";
import { ReferralPayoutsTable } from "@/components/referrals/admin/ReferralPayoutsTable";
import { ReferralCreditsTable } from "@/components/referrals/admin/ReferralCreditsTable";
import { ReferralFlagsTable } from "@/components/referrals/admin/ReferralFlagsTable";
import { ReferralSettingsPanel } from "@/components/referrals/admin/ReferralSettingsPanel";
import { ReferralDetailDrawer } from "@/components/referrals/admin/ReferralDetailDrawer";

export default function ReferralDashboard() {
  const { profile } = useUserProfile();
  // owner/admin/manager-tier (level <= 6) can perform mutating actions
  const canManage = getRoleLevel(profile?.role || "") <= 6;
  const canEditSettings = getRoleLevel(profile?.role || "") <= 4;
  const [drawerLinkId, setDrawerLinkId] = useState<string | null>(null);

  return (
    <GlobalLayout>
      <div className="p-4 md:p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Referrals</h1>
          <p className="text-sm text-muted-foreground">Manage referral links, leads, payouts, and stored credits.</p>
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="links">Referral Links</TabsTrigger>
            <TabsTrigger value="leads">Referred Leads</TabsTrigger>
            <TabsTrigger value="payouts">Payouts</TabsTrigger>
            <TabsTrigger value="credits">Stored Credits</TabsTrigger>
            <TabsTrigger value="flags">Flags / Review</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4"><ReferralOverview /></TabsContent>
          <TabsContent value="links" className="mt-4">
            <ReferralLinksTable canManage={canManage} onView={(id) => setDrawerLinkId(id)} />
          </TabsContent>
          <TabsContent value="leads" className="mt-4"><ReferredLeadsTable canManage={canManage} /></TabsContent>
          <TabsContent value="payouts" className="mt-4"><ReferralPayoutsTable canManage={canManage} /></TabsContent>
          <TabsContent value="credits" className="mt-4"><ReferralCreditsTable canManage={canManage} /></TabsContent>
          <TabsContent value="flags" className="mt-4"><ReferralFlagsTable canManage={canManage} /></TabsContent>
          <TabsContent value="settings" className="mt-4"><ReferralSettingsPanel canManage={canEditSettings} /></TabsContent>
        </Tabs>

        <ReferralDetailDrawer linkId={drawerLinkId} onClose={() => setDrawerLinkId(null)} />
      </div>
    </GlobalLayout>
  );
}
