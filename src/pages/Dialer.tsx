import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Dialer } from "@/features/communication/components/Dialer";

const DialerPage = () => {
  return (
    <GlobalLayout>
      <Dialer preloadedContact={null} />
    </GlobalLayout>
  );
};

export default DialerPage;
