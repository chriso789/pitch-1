import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { ReviewsDashboard } from "@/features/reviews";

const ReviewsPage = () => {
  return (
    <GlobalLayout>
      <ReviewsDashboard />
    </GlobalLayout>
  );
};

export default ReviewsPage;
