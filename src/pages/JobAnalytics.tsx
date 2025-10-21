import React from 'react';
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { JobAnalyticsDashboard } from "@/components/JobAnalyticsDashboard";

const JobAnalytics = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isPrintMode = searchParams.get('print') === '1';

  return (
    <GlobalLayout>
      <div className="space-y-6">
        {!isPrintMode && (
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
        )}

        <JobAnalyticsDashboard printMode={isPrintMode} />
      </div>
    </GlobalLayout>
  );
};

export default JobAnalytics;
