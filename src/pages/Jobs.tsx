import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import Jobs from "@/features/jobs";
import { SEO } from "@/components/seo/SEO";

const JobsPage = () => {
  return (
    <GlobalLayout>
      <SEO
        title="Jobs — Pitch CRM"
        description="Track active construction jobs, production stages, documents, and financials across your entire book of work."
        path="/jobs"
        noindex
      />
      <Jobs />
    </GlobalLayout>
  );
};

export default JobsPage;
