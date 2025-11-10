import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { 
  CheckCircle2, 
  Circle, 
  Satellite, 
  Edit3, 
  Save, 
  FileText,
  ArrowRight,
  Clock,
  AlertCircle
} from 'lucide-react';
import { PullMeasurementsButton } from './PullMeasurementsButton';
import { MeasurementVerificationDialog } from './MeasurementVerificationDialog';
import { MeasurementHistoryDialog } from './MeasurementHistoryDialog';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type WorkflowStep = 'pull' | 'verify' | 'adjust' | 'save' | 'estimate';

interface WorkflowStepConfig {
  id: WorkflowStep;
  label: string;
  icon: typeof Circle;
  description: string;
}

const WORKFLOW_STEPS: WorkflowStepConfig[] = [
  {
    id: 'pull',
    label: 'Pull Measurements',
    icon: Satellite,
    description: 'Fetch roof data from satellite imagery',
  },
  {
    id: 'verify',
    label: 'Verify',
    icon: Edit3,
    description: 'Review measurements for accuracy',
  },
  {
    id: 'adjust',
    label: 'Adjust',
    icon: Edit3,
    description: 'Fine-tune pitch, waste, and features',
  },
  {
    id: 'save',
    label: 'Save',
    icon: Save,
    description: 'Save verified measurements',
  },
  {
    id: 'estimate',
    label: 'Create Estimate',
    icon: FileText,
    description: 'Generate estimate from measurements',
  },
];

interface MeasurementWorkflowProps {
  propertyId: string;
  pipelineEntryId?: string;
  lat: number;
  lng: number;
  address?: string;
  onComplete?: () => void;
}

export function MeasurementWorkflow({
  propertyId,
  pipelineEntryId,
  lat,
  lng,
  address,
  onComplete,
}: MeasurementWorkflowProps) {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('pull');
  const [completedSteps, setCompletedSteps] = useState<Set<WorkflowStep>>(new Set());
  const [measurementData, setMeasurementData] = useState<{
    measurement: any;
    tags: Record<string, any>;
    satelliteImageUrl?: string;
  } | null>(null);
  const [showVerificationDialog, setShowVerificationDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Calculate progress percentage
  const progress = (completedSteps.size / WORKFLOW_STEPS.length) * 100;

  const markStepComplete = (step: WorkflowStep) => {
    setCompletedSteps(prev => new Set(prev).add(step));
  };

  const handleMeasurementPulled = (measurement: any, tags: Record<string, any>, satelliteImageUrl?: string) => {
    setMeasurementData({ measurement, tags, satelliteImageUrl });
    markStepComplete('pull');
    setCurrentStep('verify');
    setShowVerificationDialog(true);
  };

  const handleVerificationAccept = async (adjustedMeasurement?: any) => {
    if (adjustedMeasurement) {
      // Store adjusted measurements
      setMeasurementData(prev => prev ? {
        ...prev,
        measurement: { ...prev.measurement, ...adjustedMeasurement }
      } : null);
    }
    
    markStepComplete('verify');
    markStepComplete('adjust');
    setCurrentStep('save');
    setShowVerificationDialog(false);
    
    // Auto-save after verification
    await handleSaveMeasurements();
  };

  const handleVerificationReject = () => {
    setShowVerificationDialog(false);
    setCurrentStep('pull');
    toast.error('Measurements rejected. Please pull measurements again.');
  };

  const handleSaveMeasurements = async () => {
    if (!measurementData) return;
    
    setIsSaving(true);
    
    try {
      // Measurements are already saved during pull action
      // This step confirms they've been reviewed and verified
      markStepComplete('save');
      setCurrentStep('estimate');
      
      toast.success('Measurements verified successfully!', {
        description: 'Ready to create estimate',
      });
    } catch (error: any) {
      console.error('Error saving measurements:', error);
      toast.error('Failed to save measurements', {
        description: error.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateEstimate = () => {
    if (!pipelineEntryId) {
      toast.error('Cannot create estimate: Missing pipeline entry ID');
      return;
    }

    // Navigate to estimate builder with pre-populated data
    navigate(`/lead/${pipelineEntryId}?tab=estimate&autoPopulate=true`);
    
    markStepComplete('estimate');
    onComplete?.();
    
    toast.success('Navigating to Estimate Builder', {
      description: 'Measurements will be auto-populated',
    });
  };


  const getStepStatus = (stepId: WorkflowStep): 'complete' | 'current' | 'pending' => {
    if (completedSteps.has(stepId)) return 'complete';
    if (currentStep === stepId) return 'current';
    return 'pending';
  };

  return (
    <div className="space-y-6">
      {/* Progress Bar */}
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Measurement Workflow</h3>
            <Badge variant={completedSteps.size === WORKFLOW_STEPS.length ? 'default' : 'secondary'}>
              {completedSteps.size} / {WORKFLOW_STEPS.length} Complete
            </Badge>
          </div>
          
          <Progress value={progress} className="h-2" />
          
          <p className="text-sm text-muted-foreground">
            Follow these steps to pull, verify, and use measurements for estimates
          </p>
        </div>
      </Card>

      {/* Workflow Steps */}
      <Card className="p-6">
        <div className="space-y-4">
          {WORKFLOW_STEPS.map((step, index) => {
            const status = getStepStatus(step.id);
            const Icon = step.icon;
            const isLast = index === WORKFLOW_STEPS.length - 1;

            return (
              <div key={step.id}>
                <div className="flex items-start gap-4">
                  {/* Step Icon */}
                  <div className="flex-shrink-0">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        status === 'complete'
                          ? 'bg-primary text-primary-foreground'
                          : status === 'current'
                          ? 'bg-primary/20 text-primary border-2 border-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {status === 'complete' ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <Icon className="h-5 w-5" />
                      )}
                    </div>
                  </div>

                  {/* Step Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">{step.label}</h4>
                      {status === 'current' && (
                        <Badge variant="outline" className="gap-1">
                          <Clock className="h-3 w-3" />
                          In Progress
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{step.description}</p>

                    {/* Step Actions */}
                    <div className="mt-3">
                      {step.id === 'pull' && status === 'current' && (
                        <PullMeasurementsButton
                          propertyId={propertyId}
                          lat={lat}
                          lng={lng}
                          address={address}
                          onSuccess={handleMeasurementPulled}
                        />
                      )}

                      {step.id === 'verify' && status === 'current' && measurementData && (
                        <Button
                          onClick={() => setShowVerificationDialog(true)}
                          variant="default"
                          className="gap-2"
                        >
                          <Edit3 className="h-4 w-4" />
                          Open Verification Dialog
                        </Button>
                      )}

                      {step.id === 'save' && status === 'current' && (
                        <Button
                          onClick={handleSaveMeasurements}
                          disabled={isSaving}
                          variant="default"
                          className="gap-2"
                        >
                          {isSaving ? (
                            <>
                              <Clock className="h-4 w-4 animate-spin" />
                              Saving...
                            </>
                          ) : (
                            <>
                              <Save className="h-4 w-4" />
                              Save Verified Measurements
                            </>
                          )}
                        </Button>
                      )}

                      {step.id === 'estimate' && status === 'current' && (
                        <Button
                          onClick={handleCreateEstimate}
                          variant="default"
                          className="gap-2"
                        >
                          <FileText className="h-4 w-4" />
                          Create Estimate
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      )}

                      {status === 'complete' && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                          Completed
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {!isLast && <Separator className="my-4 ml-14" />}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Measurement History Link */}
      {measurementData && (
        <Card className="p-4">
          <Button
            variant="outline"
            onClick={() => setShowHistoryDialog(true)}
            className="w-full gap-2"
          >
            <Clock className="h-4 w-4" />
            View Measurement History & Comparisons
          </Button>
        </Card>
      )}

      {/* Verification Dialog */}
      {measurementData && (
        <MeasurementVerificationDialog
          open={showVerificationDialog}
          onOpenChange={setShowVerificationDialog}
          measurement={measurementData.measurement}
          tags={measurementData.tags}
          satelliteImageUrl={measurementData.satelliteImageUrl}
          centerLat={lat}
          centerLng={lng}
          onAccept={handleVerificationAccept}
          onReject={handleVerificationReject}
        />
      )}

      {/* History Dialog */}
      {showHistoryDialog && measurementData && (
        <MeasurementHistoryDialog
          open={showHistoryDialog}
          onOpenChange={setShowHistoryDialog}
          measurementId={measurementData.measurement.id}
          currentMeasurement={measurementData.measurement}
        />
      )}
    </div>
  );
}
