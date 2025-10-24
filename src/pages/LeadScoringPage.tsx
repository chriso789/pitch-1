import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { LeadScoreDashboard } from "@/features/leads";

const LeadScoringPage = () => {
  return (
    <GlobalLayout>
      <LeadScoreDashboard />
    </GlobalLayout>
  );
};

export default LeadScoringPage;
