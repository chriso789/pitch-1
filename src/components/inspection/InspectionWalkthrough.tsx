import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, ArrowRight, SkipForward, X, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { toast } from 'sonner';
import { INSPECTION_STEPS } from './inspectionSteps';
import { InspectionStepCard } from './InspectionStepCard';
import { InspectionSummary } from './InspectionSummary';

interface StepData {
  stepId: string;
  photoUrls: string[];
  notes: string;
  completedAt: string | null;
  skipped?: boolean;
}

interface InspectionWalkthroughProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId?: string;
  contactId?: string;
  canvassPropertyId?: string;
  propertyAddress?: string;
  userLocation?: { lat: number; lng: number };
}

function initStepsData(): StepData[] {
  return INSPECTION_STEPS.map((s) => ({
    stepId: s.id,
    photoUrls: [],
    notes: '',
    completedAt: null,
    skipped: false,
  }));
}

export function InspectionWalkthrough({
  open,
  onOpenChange,
  leadId,
  contactId,
  canvassPropertyId,
  propertyAddress,
  userLocation,
}: InspectionWalkthroughProps) {
  const { user } = useAuth();
  const tenantId = useEffectiveTenantId();
  const [currentStep, setCurrentStep] = useState(0);
  const [stepsData, setStepsData] = useState<StepData[]>(initStepsData);
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setCurrentStep(0);
      setStepsData(initStepsData());
      setInspectionId(null);
      setShowSummary(false);
      setShowCamera(false);
    } else {
      stopCamera();
    }
  }, [open]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = mediaStream;
      setShowCamera(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch {
      handleFilePicker();
    }
  }, []);

  const handleFilePicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) await uploadFile(file);
    };
    input.click();
  }, [tenantId, leadId, canvassPropertyId, currentStep, inspectionId]);

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setCapturing(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const now = new Date().toLocaleString();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, canvas.height - 30, canvas.width, 30);
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText(now, 8, canvas.height - 10);

    canvas.toBlob(
      async (blob) => {
        if (blob) {
          const file = new File([blob], `inspection_${Date.now()}.jpg`, { type: 'image/jpeg' });
          await uploadFile(file);
        }
        setCapturing(false);
        stopCamera();
      },
      'image/jpeg',
      0.85
    );
  }, [stopCamera]);

  const uploadFile = async (file: File) => {
    if (!tenantId || !user) {
      toast.error('Missing tenant or user info');
      return;
    }
    setCapturing(true);
    try {
      const timestamp = Date.now();
      let bucket: string;
      let path: string;

      if (leadId) {
        bucket = 'customer-photos';
        path = `${tenantId}/leads/${leadId}/${timestamp}.jpg`;
      } else if (canvassPropertyId) {
        bucket = 'canvass-photos';
        path = `${tenantId}/${canvassPropertyId}/${timestamp}.jpg`;
      } else {
        bucket = 'customer-photos';
        path = `${tenantId}/inspections/${timestamp}.jpg`;
      }

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(path, file, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
      const photoUrl = urlData.publicUrl;

      // Append to photoUrls array
      setStepsData((prev) => {
        const next = [...prev];
        next[currentStep] = {
          ...next[currentStep],
          photoUrls: [...next[currentStep].photoUrls, photoUrl],
          completedAt: new Date().toISOString(),
          skipped: false,
        };
        return next;
      });

      if (leadId) {
        await supabase.from('customer_photos').insert({
          tenant_id: tenantId,
          pipeline_entry_id: leadId,
          contact_id: contactId || null,
          file_name: path,
          file_url: photoUrl,
          category: 'inspection',
          uploaded_by: user.id,
        } as any);
      }

      await upsertInspection(photoUrl);
    } catch (err: any) {
      toast.error('Upload failed: ' + (err.message || 'Unknown error'));
    } finally {
      setCapturing(false);
    }
  };

  const handleRemovePhoto = (photoIndex: number) => {
    setStepsData((prev) => {
      const next = [...prev];
      const step = next[currentStep];
      const newUrls = step.photoUrls.filter((_, i) => i !== photoIndex);
      next[currentStep] = {
        ...step,
        photoUrls: newUrls,
        completedAt: newUrls.length > 0 ? step.completedAt : null,
      };
      return next;
    });
  };

  const upsertInspection = async (latestPhotoUrl?: string) => {
    if (!tenantId || !user) return;

    const updatedSteps = stepsData.map((s, i) => {
      if (i === currentStep && latestPhotoUrl) {
        return {
          ...s,
          photoUrls: [...s.photoUrls, latestPhotoUrl],
          completedAt: new Date().toISOString(),
          skipped: false,
        };
      }
      return s;
    });

    if (inspectionId) {
      await supabase
        .from('inspections' as any)
        .update({ steps_data: updatedSteps } as any)
        .eq('id', inspectionId);
    } else {
      const { data, error } = await supabase
        .from('inspections' as any)
        .insert({
          tenant_id: tenantId,
          lead_id: leadId || null,
          canvass_property_id: canvassPropertyId || null,
          inspected_by: user.id,
          status: 'in_progress',
          steps_data: updatedSteps,
        } as any)
        .select('id')
        .single();

      if (!error && data) {
        setInspectionId((data as any).id);
      }
    }
  };

  const handleNext = () => {
    if (currentStep < INSPECTION_STEPS.length - 1) {
      setCurrentStep((p) => p + 1);
    } else {
      setShowSummary(true);
    }
  };

  const handleBack = () => {
    if (showSummary) {
      setShowSummary(false);
      return;
    }
    if (currentStep > 0) setCurrentStep((p) => p - 1);
  };

  const handleSkip = () => {
    setStepsData((prev) => {
      const next = [...prev];
      next[currentStep] = { ...next[currentStep], skipped: true };
      return next;
    });
    handleNext();
  };

  const handleFinish = async () => {
    if (!inspectionId) {
      toast.error('No inspection to finish');
      return;
    }
    setFinishing(true);
    try {
      await supabase
        .from('inspections' as any)
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          steps_data: stepsData,
        } as any)
        .eq('id', inspectionId);
      toast.success('Inspection completed!');
      onOpenChange(false);
    } catch {
      toast.error('Failed to finish inspection');
    } finally {
      setFinishing(false);
    }
  };

  const handleNotesChange = (notes: string) => {
    setStepsData((prev) => {
      const next = [...prev];
      next[currentStep] = { ...next[currentStep], notes };
      return next;
    });
  };

  const progressPercent =
    (stepsData.filter((s) => s.photoUrls.length > 0 || s.skipped).length / INSPECTION_STEPS.length) * 100;

  const step = INSPECTION_STEPS[currentStep];
  const currentData = stepsData[currentStep];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-full h-[90vh] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Inspection Walkthrough</DialogTitle>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-background shrink-0">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold">
              {showSummary ? 'Review' : `Inspection`}
            </span>
          </div>
          {propertyAddress && (
            <span className="text-xs text-muted-foreground truncate max-w-[180px]">
              {propertyAddress}
            </span>
          )}
        </div>

        {/* Progress */}
        <div className="px-4 pt-3 shrink-0">
          <Progress value={progressPercent} className="h-2" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {showCamera ? (
            <div className="relative w-full h-full min-h-[300px] bg-black flex items-center justify-center">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-3">
                <Button variant="secondary" onClick={stopCamera} className="rounded-full h-12 w-12 p-0">
                  <X className="h-5 w-5" />
                </Button>
                <Button
                  onClick={capturePhoto}
                  disabled={capturing}
                  className="rounded-full h-14 w-14 p-0 bg-white text-black hover:bg-gray-200"
                >
                  {capturing ? <Loader2 className="h-6 w-6 animate-spin" /> : <div className="h-10 w-10 rounded-full border-4 border-black" />}
                </Button>
              </div>
            </div>
          ) : showSummary ? (
            <InspectionSummary
              stepsData={stepsData}
              onStepClick={(idx) => {
                setShowSummary(false);
                setCurrentStep(idx);
              }}
              onFinish={handleFinish}
              finishing={finishing}
            />
          ) : (
            <InspectionStepCard
              step={step}
              stepIndex={currentStep}
              totalSteps={INSPECTION_STEPS.length}
              data={currentData}
              onTakePhoto={startCamera}
              onRemovePhoto={handleRemovePhoto}
              onNotesChange={handleNotesChange}
              capturing={capturing}
            />
          )}
        </div>

        {/* Footer nav */}
        {!showCamera && !showSummary && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-background shrink-0">
            <Button variant="ghost" size="sm" onClick={handleBack} disabled={currentStep === 0}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSkip}>
              <SkipForward className="h-4 w-4 mr-1" /> Skip
            </Button>
            <Button size="sm" onClick={handleNext}>
              {currentStep === INSPECTION_STEPS.length - 1 ? 'Review' : 'Next'}
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
