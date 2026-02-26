import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, SkipForward, Camera, Loader2, Download, AlertTriangle } from 'lucide-react';
import { useInspectionConfig } from '@/hooks/useInspectionConfig';
import { useInspectionReportPDF } from './useInspectionReportPDF';

interface StepData {
  stepId: string;
  photoUrls: string[];
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
  const { activeSteps } = useInspectionConfig();
  const completedCount = stepsData.filter((s) => s.photoUrls.length > 0).length;
  const { downloadReport, generating } = useInspectionReportPDF();

  const missingRequired = activeSteps
    .map((step, i) => {
      if (!step.is_required) return null;
      const minRequired = step.min_photos > 0 ? step.min_photos : 1;
      const photoCount = stepsData[i]?.photoUrls?.length || 0;
      if (photoCount < minRequired) return { index: i, title: step.title, needed: minRequired, have: photoCount };
      return null;
    })
    .filter(Boolean);

  const canFinish = missingRequired.length === 0;

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
          {completedCount} of {activeSteps.length} steps completed. Tap any step to retake or edit.
        </p>
      </div>

      {missingRequired.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
          <div className="flex items-center gap-2 text-destructive text-sm font-medium mb-1">
            <AlertTriangle className="h-4 w-4" />
            Required steps incomplete
          </div>
          <ul className="text-xs text-destructive/80 space-y-0.5 ml-6">
            {missingRequired.map((m: any) => (
              <li key={m.index}>
                {m.title} — need {m.needed} photo{m.needed > 1 ? 's' : ''}, have {m.have}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {activeSteps.map((step, idx) => {
          const data = stepsData[idx];
          const firstPhoto = data?.photoUrls?.[0];
          const extraCount = (data?.photoUrls?.length || 0) - 1;
          const isIncomplete = step.is_required && (data?.photoUrls?.length || 0) < (step.min_photos > 0 ? step.min_photos : 1);
          return (
            <button
              key={step.id}
              className={`border rounded-lg p-2 text-left hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${isIncomplete ? 'border-destructive/50 bg-destructive/5' : ''}`}
              onClick={() => onStepClick(idx)}
            >
              {firstPhoto ? (
                <div className="relative">
                  <img src={firstPhoto} alt={step.title} className="w-full h-20 object-cover rounded-md mb-1" />
                  {extraCount > 0 && (
                    <span className="absolute top-1 right-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                      +{extraCount}
                    </span>
                  )}
                </div>
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
                {firstPhoto && <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />}
                <span className="text-xs font-medium truncate">{step.title}</span>
                {step.is_required && (
                  <Badge variant="destructive" className="text-[8px] h-4 px-1 ml-auto">Req</Badge>
                )}
              </div>
              {data?.notes && (
                <p className="text-[10px] text-muted-foreground truncate mt-0.5">{data.notes}</p>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 mt-2">
        {completedCount > 0 && (
          <Button variant="outline" onClick={handleDownload} disabled={generating} className="flex-1">
            {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Download Report
          </Button>
        )}
        <Button onClick={onFinish} disabled={finishing || !canFinish} className="flex-1">
          {finishing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
          Finish Inspection
        </Button>
      </div>
    </div>
  );
}
