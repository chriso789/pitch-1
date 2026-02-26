import React, { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Camera, X, CheckCircle, Plus, Mic, MicOff, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { InspectionStep } from './inspectionSteps';

interface StepData {
  stepId: string;
  photoUrls: string[];
  notes: string;
  completedAt: string | null;
  skipped?: boolean;
}

interface InspectionStepCardProps {
  step: InspectionStep & { is_required?: boolean; min_photos?: number };
  stepIndex: number;
  totalSteps: number;
  data: StepData;
  onTakePhoto: () => void;
  onRemovePhoto: (index: number) => void;
  onNotesChange: (notes: string) => void;
  capturing: boolean;
  isListening?: boolean;
  onToggleVoice?: () => void;
  interimTranscript?: string;
  voiceSupported?: boolean;
}

export function InspectionStepCard({
  step,
  stepIndex,
  totalSteps,
  data,
  onTakePhoto,
  onRemovePhoto,
  onNotesChange,
  capturing,
  isListening = false,
  onToggleVoice,
  interimTranscript = '',
  voiceSupported = false,
}: InspectionStepCardProps) {
  const hasPhotos = data.photoUrls.length > 0;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll textarea when voice input adds text
  useEffect(() => {
    if (textareaRef.current && isListening) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [data.notes, interimTranscript, isListening]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Step header */}
      <div>
        <p className="text-xs text-muted-foreground font-medium mb-1">
          Step {stepIndex + 1} of {totalSteps}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-semibold">{step.title}</h3>
          {step.is_required && (
            <Badge variant="destructive" className="text-[10px] h-5 gap-1">
              <Shield className="h-3 w-3" />
              Required
            </Badge>
          )}
          {hasPhotos && (
            <Badge variant="secondary" className="text-[10px] h-5">
              {data.photoUrls.length} photo{data.photoUrls.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
        {step.is_required && step.min_photos && step.min_photos > 0 && (
          <p className="text-xs text-destructive mt-0.5">
            Minimum {step.min_photos} photo{step.min_photos > 1 ? 's' : ''} required
          </p>
        )}
      </div>

      {/* Guidance */}
      <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground bg-muted/40 rounded-md p-3">
        {step.guidance.map((g, i) => (
          <li key={i}>{g}</li>
        ))}
      </ul>

      {/* Photo thumbnails - horizontal scroll */}
      {hasPhotos && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {data.photoUrls.map((url, i) => (
            <div key={i} className="relative flex-shrink-0 w-20 h-20 rounded-md overflow-hidden border group">
              <img src={url} alt={`${step.title} ${i + 1}`} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onRemovePhoto(i)}
                className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity sm:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
              {i === 0 && (
                <CheckCircle className="absolute bottom-0.5 left-0.5 h-3.5 w-3.5 text-green-500 drop-shadow" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add photo button - always visible */}
      <Button
        variant="outline"
        className={hasPhotos ? "h-10 border-dashed gap-2" : "h-32 border-dashed flex-col gap-2"}
        onClick={onTakePhoto}
        disabled={capturing}
      >
        {hasPhotos ? (
          <>
            <Plus className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Add Another Photo</span>
          </>
        ) : (
          <>
            <Camera className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm">Take Photo</span>
          </>
        )}
      </Button>

      {/* Notes with voice toggle */}
      <div className="relative">
        <Textarea
          ref={textareaRef}
          placeholder="Add notes about what you see..."
          value={isListening && interimTranscript ? data.notes + interimTranscript : data.notes}
          onChange={(e) => onNotesChange(e.target.value)}
          className="min-h-[60px] text-sm pr-10"
          readOnly={isListening}
        />
        {voiceSupported && onToggleVoice && (
          <button
            type="button"
            onClick={onToggleVoice}
            className={`absolute top-2 right-2 h-7 w-7 rounded-full flex items-center justify-center transition-colors ${
              isListening
                ? 'bg-destructive text-destructive-foreground animate-pulse'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
            title={isListening ? 'Stop dictation' : 'Start voice dictation'}
          >
            {isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </button>
        )}
        {isListening && (
          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-destructive">
            <div className="w-1.5 h-1.5 bg-destructive rounded-full animate-pulse" />
            Listening... speak your observations
          </div>
        )}
      </div>
    </div>
  );
}
