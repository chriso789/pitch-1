import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { EnhancedClientList } from "@/features/contacts/components/EnhancedClientList";

const ClientListPage = () => {
  return (
    <GlobalLayout>
      <EnhancedClientList />
    </GlobalLayout>
  );
};

export default ClientListPage;
