import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import Dashboard from "@/features/dashboard/components/Dashboard";
import { SEO } from "@/components/seo/SEO";

const DashboardPage = () => {
  return (
    <GlobalLayout>
      <SEO
        title="Dashboard — Pitch CRM"
        description="Your Pitch CRM command center: pipeline health, revenue, activity, and team performance at a glance."
        path="/dashboard"
        noindex
      />
      <Dashboard />
    </GlobalLayout>
  );
};

export default DashboardPage;
