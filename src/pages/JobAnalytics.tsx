import React from 'react';
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { JobAnalyticsDashboard } from "@/components/JobAnalyticsDashboard";

const JobAnalytics = () => {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = React.useState('jobs');

  return (
    <GlobalLayout activeSection={activeSection} onSectionChange={setActiveSection}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/pipeline')}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Pipeline
          </Button>
        </div>

        <JobAnalyticsDashboard />
      </div>
    </GlobalLayout>
  );
};

export default JobAnalytics;
