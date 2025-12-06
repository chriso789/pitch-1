import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { MonitoringDashboard } from "@/components/admin/MonitoringDashboard";

const MonitoringPage = () => {
  return (
    <GlobalLayout>
      <MonitoringDashboard />
    </GlobalLayout>
  );
};

export default MonitoringPage;
