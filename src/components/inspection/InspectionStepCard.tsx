import React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Camera, RotateCcw, CheckCircle } from 'lucide-react';
import type { InspectionStep } from './inspectionSteps';

interface StepData {
  stepId: string;
  photoUrl: string | null;
  notes: string;
  completedAt: string | null;
  skipped?: boolean;
}

interface InspectionStepCardProps {
  step: InspectionStep;
  stepIndex: number;
  totalSteps: number;
  data: StepData;
  onTakePhoto: () => void;
  onNotesChange: (notes: string) => void;
  capturing: boolean;
}

export function InspectionStepCard({
  step,
  stepIndex,
  totalSteps,
  data,
  onTakePhoto,
  onNotesChange,
  capturing,
}: InspectionStepCardProps) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Step header */}
      <div>
        <p className="text-xs text-muted-foreground font-medium mb-1">
          Step {stepIndex + 1} of {totalSteps}
        </p>
        <h3 className="text-lg font-semibold">{step.title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
      </div>

      {/* Guidance */}
      <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground bg-muted/40 rounded-md p-3">
        {step.guidance.map((g, i) => (
          <li key={i}>{g}</li>
        ))}
      </ul>

      {/* Photo area */}
      {data.photoUrl ? (
        <div className="relative rounded-md overflow-hidden border">
          <img
            src={data.photoUrl}
            alt={step.title}
            className="w-full max-h-52 object-cover"
          />
          <div className="absolute top-2 right-2 flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              className="h-8 text-xs"
              onClick={onTakePhoto}
              disabled={capturing}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Retake
            </Button>
          </div>
          <div className="absolute top-2 left-2">
            <CheckCircle className="h-5 w-5 text-green-500 drop-shadow" />
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          className="h-32 border-dashed flex-col gap-2"
          onClick={onTakePhoto}
          disabled={capturing}
        >
          <Camera className="h-8 w-8 text-muted-foreground" />
          <span className="text-sm">Take Photo</span>
        </Button>
      )}

      {/* Notes */}
      <Textarea
        placeholder="Describe what you see (optional)..."
        value={data.notes}
        onChange={(e) => onNotesChange(e.target.value)}
        className="min-h-[60px] text-sm"
      />
    </div>
  );
}
