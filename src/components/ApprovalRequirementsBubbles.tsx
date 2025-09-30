import React, { useRef, useState } from 'react';
import { FileText, DollarSign, Package, Hammer, CheckCircle, ArrowRight, Camera, Upload } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  
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
