import React from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, SkipForward, Camera, Loader2, Download } from 'lucide-react';
import { INSPECTION_STEPS } from './inspectionSteps';
import { useInspectionReportPDF } from './useInspectionReportPDF';

interface StepData {
  stepId: string;
  photoUrl: string | null;
  notes: string;
  completedAt: string | null;
  skipped?: boolean;
}

interface InspectionSummaryProps {
  stepsData: StepData[];
  onStepClick: (index: number) => void;
  onFinish: () => void;
  finishing: boolean;
  propertyAddress?: string;
  inspectorName?: string;
}

export function InspectionSummary({
  stepsData,
  onStepClick,
  onFinish,
  finishing,
  propertyAddress,
  inspectorName,
}: InspectionSummaryProps) {
  const completedCount = stepsData.filter((s) => s.photoUrl).length;
  const { downloadReport, generating } = useInspectionReportPDF();

  const handleDownload = () => {
    downloadReport({
      stepsData,
      propertyAddress,
      inspectorName,
      inspectionDate: new Date().toLocaleDateString(),
      status: 'Completed',
    });
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h3 className="text-lg font-semibold">Inspection Summary</h3>
        <p className="text-sm text-muted-foreground">
          {completedCount} of {INSPECTION_STEPS.length} steps completed. Tap any step to retake or edit.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {INSPECTION_STEPS.map((step, idx) => {
          const data = stepsData[idx];
          return (
            <button
              key={step.id}
              className="border rounded-lg p-2 text-left hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
              onClick={() => onStepClick(idx)}
            >
              {data?.photoUrl ? (
                <img
                  src={data.photoUrl}
                  alt={step.title}
                  className="w-full h-20 object-cover rounded-md mb-1"
                />
              ) : (
                <div className="w-full h-20 bg-muted rounded-md mb-1 flex items-center justify-center">
                  {data?.skipped ? (
                    <SkipForward className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <Camera className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              )}
              <div className="flex items-center gap-1">
                {data?.photoUrl && (
                  <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                )}
                <span className="text-xs font-medium truncate">{step.title}</span>
              </div>
              {data?.notes && (
                <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                  {data.notes}
                </p>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 mt-2">
        {completedCount > 0 && (
          <Button variant="outline" onClick={handleDownload} disabled={generating} className="flex-1">
            {generating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download Report
          </Button>
        )}
        <Button onClick={onFinish} disabled={finishing} className="flex-1">
          {finishing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <CheckCircle className="h-4 w-4 mr-2" />
          )}
          Finish Inspection
        </Button>
      </div>
    </div>
  );
}
