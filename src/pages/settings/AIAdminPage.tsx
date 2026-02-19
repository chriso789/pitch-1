import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { AIAdminChat } from "@/components/ai-admin/AIAdminChat";

const AIAdminPage = () => {
  return (
    <GlobalLayout>
      <div className="container mx-auto max-w-4xl py-6 px-4">
        <AIAdminChat />
      </div>
    </GlobalLayout>
  );
};

export default AIAdminPage;
