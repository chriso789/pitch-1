import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import JobCalendar from "@/features/jobs/components/JobCalendar";

const CalendarPage = () => {
  return (
    <GlobalLayout>
      <JobCalendar />
    </GlobalLayout>
  );
};

export default CalendarPage;
