import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { CompanyReferralSettingsPanel } from "@/components/company-referrals/settings/CompanyReferralSettingsPanel";
import { CompanyReferralPartnersTable } from "@/components/company-referrals/settings/CompanyReferralPartnersTable";
import { CreateCompanyReferralPartnerDialog } from "@/components/company-referrals/settings/CreateCompanyReferralPartnerDialog";
import { CompanyReferralSignupsTable } from "@/components/company-referrals/settings/CompanyReferralSignupsTable";
import { CompanyReferralPayoutsTable } from "@/components/company-referrals/settings/CompanyReferralPayoutsTable";
import { CompanyReferralCreditsTable } from "@/components/company-referrals/settings/CompanyReferralCreditsTable";
import { CompanyReferralFlagsTable } from "@/components/company-referrals/settings/CompanyReferralFlagsTable";
import { CompanyReferralAnalytics } from "@/components/company-referrals/settings/CompanyReferralAnalytics";

export default function CompanyReferralSettingsPage() {
  const { effectiveTenantId } = useEffectiveTenantId();

  if (!effectiveTenantId) {
    return <div className="p-6 text-muted-foreground">Select a company to manage referrals.</div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Company Referrals</h1>
          <p className="text-sm text-muted-foreground">Manage the contractor-to-CRM referral program.</p>
        </div>
        <CreateCompanyReferralPartnerDialog tenantId={effectiveTenantId} />
      </header>

      <Tabs defaultValue="settings">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="settings">Program Settings</TabsTrigger>
          <TabsTrigger value="partners">Partners</TabsTrigger>
          <TabsTrigger value="signups">Company Signups</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="credits">Account Credits</TabsTrigger>
          <TabsTrigger value="flags">Flags / Review</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="settings"><CompanyReferralSettingsPanel tenantId={effectiveTenantId} /></TabsContent>
        <TabsContent value="partners"><CompanyReferralPartnersTable tenantId={effectiveTenantId} /></TabsContent>
        <TabsContent value="signups"><CompanyReferralSignupsTable tenantId={effectiveTenantId} /></TabsContent>
        <TabsContent value="payouts"><CompanyReferralPayoutsTable tenantId={effectiveTenantId} /></TabsContent>
        <TabsContent value="credits"><CompanyReferralCreditsTable tenantId={effectiveTenantId} /></TabsContent>
        <TabsContent value="flags"><CompanyReferralFlagsTable tenantId={effectiveTenantId} /></TabsContent>
        <TabsContent value="analytics"><CompanyReferralAnalytics tenantId={effectiveTenantId} /></TabsContent>
      </Tabs>
    </div>
  );
}
