import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { ManagerApprovalQueue } from "@/features/approvals";

const ApprovalsPage = () => {
  return (
    <GlobalLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Manager Approvals</h1>
          <p className="text-muted-foreground">
            Review and approve lead-to-project conversion requests
          </p>
        </div>
        <ManagerApprovalQueue />
      </div>
    </GlobalLayout>
  );
};

export default ApprovalsPage;
