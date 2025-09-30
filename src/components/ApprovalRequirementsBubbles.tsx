import React, { useRef, useState } from 'react';
import { FileText, DollarSign, Package, Hammer, CheckCircle, ArrowRight, Camera, Upload } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

interface ApprovalRequirements {
  hasContract: boolean;
  hasEstimate: boolean;
  hasMaterials: boolean;
  hasLabor: boolean;
  allComplete: boolean;
}

interface ApprovalRequirementsBubblesProps {
  requirements: ApprovalRequirements;
  onApprove: () => void;
  disabled?: boolean;
  pipelineEntryId?: string;
  onUploadComplete?: () => void;
}

const bubbleSteps = [
  { key: 'hasContract', label: 'Contract', icon: FileText, color: 'from-blue-500 to-blue-400' },
  { key: 'hasEstimate', label: 'Estimate', icon: DollarSign, color: 'from-yellow-500 to-yellow-400' },
  { key: 'hasMaterials', label: 'Materials', icon: Package, color: 'from-purple-500 to-purple-400' },
  { key: 'hasLabor', label: 'Labor', icon: Hammer, color: 'from-orange-500 to-orange-400' },
] as const;

export const ApprovalRequirementsBubbles: React.FC<ApprovalRequirementsBubblesProps> = ({
  requirements,
  onApprove,
  disabled = false,
  pipelineEntryId,
  onUploadComplete,
}) => {
  const { toast } = useToast();
  const [uploadingContract, setUploadingContract] = useState(false);
  const [openPopover, setOpenPopover] = useState(false);
  const [openEstimatePopover, setOpenEstimatePopover] = useState(false);
  const [selectedEstimateId, setSelectedEstimateId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Fetch available estimates for this pipeline entry
  const { data: availableEstimates, isLoading: estimatesLoading } = useQuery({
    queryKey: ['estimates', pipelineEntryId],
    queryFn: async () => {
      if (!pipelineEntryId) return [];
      
      const { data, error } = await supabase
        .from('enhanced_estimates')
        .select('*')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!pipelineEntryId,
  });
  
  const completedCount = Object.entries(requirements)
    .filter(([key, value]) => key !== 'allComplete' && value === true)
    .length;
  
  const progressPercentage = (completedCount / 4) * 100;

  const handleFileUpload = async (file: File, source: 'camera' | 'file') => {
    if (!pipelineEntryId) {
      toast({
        title: "Error",
        description: "Pipeline entry ID is required",
        variant: "destructive",
      });
      return;
    }

    setUploadingContract(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${pipelineEntryId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase
        .from('documents')
        .insert({
          pipeline_entry_id: pipelineEntryId,
          document_type: 'contract',
          filename: file.name,
          file_path: fileName,
          file_size: file.size,
        });

      if (dbError) throw dbError;

      toast({
        title: "Success",
        description: `Contract uploaded successfully via ${source}`,
      });
      
      setOpenPopover(false);
      onUploadComplete?.();
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload Failed",
        description: "Failed to upload contract. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingContract(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file, 'file');
    }
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file, 'camera');
    }
  };

  const handleEstimateSelect = async (estimateId: string) => {
    if (!pipelineEntryId) return;

    try {
      // Get current metadata
      const { data: currentEntry } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();

      const currentMetadata = (currentEntry?.metadata as Record<string, any>) || {};

      // Update the pipeline entry to mark this estimate as selected
      const { error } = await supabase
        .from('pipeline_entries')
        .update({ 
          metadata: { 
            ...(typeof currentMetadata === 'object' ? currentMetadata : {}),
            selected_estimate_id: estimateId 
          }
        })
        .eq('id', pipelineEntryId);

      if (error) throw error;

      setSelectedEstimateId(estimateId);
      setOpenEstimatePopover(false);
      
      toast({
        title: "Estimate Selected",
        description: "This estimate has been approved for the project budget.",
      });

      onUploadComplete?.();
    } catch (error) {
      console.error('Error selecting estimate:', error);
      toast({
        title: "Error",
        description: "Failed to select estimate. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Progress and Action Button */}
      <div className="flex items-center justify-between">
        <div className="flex-1 mr-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Progress</span>
            <span className="text-sm text-muted-foreground">
              {completedCount} / 4 complete
            </span>
          </div>
          <Progress value={progressPercentage} className="h-2" />
        </div>
        
        {requirements.allComplete ? (
          <Button 
            onClick={onApprove} 
            disabled={disabled}
            className="gradient-primary whitespace-nowrap"
          >
            Approve to Project
          </Button>
        ) : (
          <Button disabled variant="outline" className="whitespace-nowrap">
            Complete Requirements
          </Button>
        )}
      </div>

      {/* Floating Bubbles Timeline */}
      <div className="relative max-w-3xl mx-auto">
        <div className="flex items-center justify-center gap-6 md:gap-8 flex-wrap">
          {bubbleSteps.map((step, index) => {
            const isComplete = requirements[step.key as keyof ApprovalRequirements];
            const Icon = step.icon;
            
            return (
              <React.Fragment key={step.key}>
                {/* Bubble */}
                <div className="flex flex-col items-center space-y-2 relative">
                  {/* Circular Bubble */}
                  {step.key === 'hasContract' && !isComplete ? (
                    <Popover open={openPopover} onOpenChange={setOpenPopover}>
                      <PopoverTrigger asChild>
                        <div
                          className={cn(
                            "relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300",
                            "border-4 cursor-pointer",
                            "bg-muted border-border opacity-50 hover:opacity-100 hover:border-primary hover:scale-105"
                          )}
                        >
                          <Icon 
                            className="h-8 w-8 text-muted-foreground" 
                          />
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2">
                        <div className="space-y-1">
                          <Button
                            variant="ghost"
                            className="w-full justify-start"
                            onClick={() => cameraInputRef.current?.click()}
                            disabled={uploadingContract}
                          >
                            <Camera className="h-4 w-4 mr-2" />
                            Scan with Camera
                          </Button>
                          <Button
                            variant="ghost"
                            className="w-full justify-start"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadingContract}
                          >
                            <Upload className="h-4 w-4 mr-2" />
                            Upload from Device
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : step.key === 'hasEstimate' && !isComplete ? (
                    <Popover open={openEstimatePopover} onOpenChange={setOpenEstimatePopover}>
                      <PopoverTrigger asChild>
                        <div
                          className={cn(
                            "relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300",
                            "border-4 cursor-pointer",
                            "bg-muted border-border opacity-50 hover:opacity-100 hover:border-primary hover:scale-105"
                          )}
                        >
                          <Icon 
                            className="h-8 w-8 text-muted-foreground" 
                          />
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="w-96 p-4">
                        <div className="space-y-4">
                          <div>
                            <h4 className="font-semibold mb-1">Select Estimate for Budget</h4>
                            <p className="text-sm text-muted-foreground">
                              Choose which estimate to use for materials and labor budget
                            </p>
                          </div>
                          
                          {estimatesLoading ? (
                            <p className="text-sm text-muted-foreground">Loading estimates...</p>
                          ) : !availableEstimates || availableEstimates.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No estimates available. Create an estimate first.</p>
                          ) : (
                            <RadioGroup value={selectedEstimateId || ''} onValueChange={handleEstimateSelect}>
                              <div className="space-y-3 max-h-64 overflow-y-auto">
                                {availableEstimates.map((estimate) => (
                                  <div key={estimate.id} className="flex items-start space-x-3 border rounded-lg p-3 hover:bg-accent/50 transition-colors">
                                    <RadioGroupItem value={estimate.id} id={estimate.id} className="mt-1" />
                                    <Label htmlFor={estimate.id} className="flex-1 cursor-pointer">
                                      <div className="font-medium">
                                        {estimate.estimate_number || 'Estimate'}
                                      </div>
                                      <div className="text-sm text-muted-foreground mt-1">
                                        Total: ${estimate.selling_price?.toLocaleString() || '0'}
                                      </div>
                                      <div className="text-xs text-muted-foreground mt-0.5">
                                        Materials: ${estimate.material_cost?.toLocaleString() || '0'} | 
                                        Labor: ${estimate.labor_cost?.toLocaleString() || '0'}
                                      </div>
                                    </Label>
                                  </div>
                                ))}
                              </div>
                            </RadioGroup>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <div
                      className={cn(
                        "relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300",
                        "border-4",
                        isComplete
                          ? `bg-gradient-to-br ${step.color} border-white shadow-lg animate-scale-in hover:scale-110 hover:-translate-y-1 hover:shadow-xl cursor-pointer`
                          : "bg-muted border-border opacity-50"
                      )}
                    >
                      <Icon 
                        className={cn(
                          "h-8 w-8 transition-colors",
                          isComplete ? "text-white" : "text-muted-foreground"
                        )} 
                      />
                      
                      {/* Checkmark Badge */}
                      {isComplete && (
                        <div className="absolute -top-1 -right-1 w-6 h-6 bg-success rounded-full flex items-center justify-center border-2 border-background shadow-md animate-fade-in">
                          <CheckCircle className="h-4 w-4 text-success-foreground" />
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Label */}
                  <span className={cn(
                    "text-sm font-medium text-center",
                    isComplete ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {step.label}
                  </span>
                  
                  {/* Status Badge */}
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full",
                    isComplete 
                      ? "bg-success/10 text-success" 
                      : "bg-muted text-muted-foreground"
                  )}>
                    {isComplete ? "Complete" : "Pending"}
                  </span>
                </div>
                
                {/* Arrow Connector */}
                {index < bubbleSteps.length - 1 && (
                  <div className="flex items-center">
                    <ArrowRight 
                      className={cn(
                        "h-5 w-5 transition-all duration-300",
                        isComplete ? "text-primary opacity-100" : "text-muted-foreground/20"
                      )}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/*,.doc,.docx"
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraCapture}
        className="hidden"
      />
    </div>
  );
};
