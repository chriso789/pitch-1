import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { PriceManagementDashboard } from "@/components/pricing/PriceManagementDashboard";

const PriceManagementPage = () => {
  return (
    <GlobalLayout>
      <PriceManagementDashboard />
    </GlobalLayout>
  );
};

export default PriceManagementPage;
