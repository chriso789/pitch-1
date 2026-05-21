import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getPublicCrmReferralPage } from "@/lib/companyReferrals/companyReferralApi";
import { storeCompanyReferralAttribution } from "@/lib/companyReferrals/companyReferralTracking";
import { useCompanyReferralTracking } from "@/hooks/companyReferrals/useCompanyReferralTracking";
import { PublicCompanySignupReferralHero } from "@/components/company-referrals/PublicCompanySignupReferralHero";
import { PublicCompanySignupReferralForm } from "@/components/company-referrals/PublicCompanySignupReferralForm";

export default function PublicCompanySignupReferralPage() {
  const { partnerCode } = useParams<{ partnerCode: string }>();
  const [page, setPage] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const track = useCompanyReferralTracking(partnerCode);

  useEffect(() => {
    if (!partnerCode) return;
    storeCompanyReferralAttribution(partnerCode);
    (async () => {
      try {
        const data = await getPublicCrmReferralPage(partnerCode);
        setPage(data);
        if (data?.signup_enabled) track("page_view");
      } catch {
        setPage({ success: false, signup_enabled: false });
      } finally {
        setLoading(false);
      }
    })();
  }, [partnerCode, track]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </main>
    );
  }

  if (!page?.signup_enabled) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-2xl font-semibold">Referral link unavailable</h1>
          <p className="text-muted-foreground">
            This signup referral link is not active. Please contact the contractor who referred you.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <PublicCompanySignupReferralHero
        headline={page.public_headline}
        subheadline={page.public_subheadline}
        partnerName={page.referring_partner_name}
      />
      <section className="px-4 pb-16">
        <PublicCompanySignupReferralForm
          partnerCode={partnerCode!}
          onFirstFocus={() => track("click_start_signup")}
          onSubmitted={() => track("signup_submitted")}
        />
        <div className="mx-auto max-w-xl mt-6 text-center">
          <Button variant="outline" asChild>
            <a href="/demo-request">Request Demo</a>
          </Button>
        </div>
      </section>
    </main>
  );
}
