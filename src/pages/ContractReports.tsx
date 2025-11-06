import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import ContractReportsDashboard from "@/features/reports/components/ContractReportsDashboard";

const ContractReportsPage = () => {
  return (
    <GlobalLayout>
      <ContractReportsDashboard />
    </GlobalLayout>
  );
};

export default ContractReportsPage;
