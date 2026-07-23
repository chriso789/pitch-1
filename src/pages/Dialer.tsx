import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Dialer } from "@/features/communication/components/Dialer";
import { SEO } from "@/components/seo/SEO";

const DialerPage = () => {
  return (
    <GlobalLayout>
      <SEO
        title="Power Dialer — Pitch CRM"
        description="High-volume outbound calling with AI call summaries, voicemail drops, and automatic CRM logging."
        path="/dialer"
        noindex
      />
      <Dialer preloadedContact={null} />
    </GlobalLayout>
  );
};

export default DialerPage;
