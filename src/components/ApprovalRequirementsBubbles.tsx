import React, { useRef, useState } from 'react';
import { FileText, DollarSign, Package, Camera, CheckCircle, ArrowRight, Upload, Shield, AlertCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { getIcon } from '@/lib/iconMap';
import { DocumentScannerDialog } from '@/components/documents/DocumentScannerDialog';
import type { DynamicRequirement } from '@/hooks/useLeadDetails';

interface ApprovalRequirements {
  hasContract: boolean;
  hasEstimate: boolean;
  hasMaterials: boolean;
  hasLabor: boolean;
  allComplete: boolean;
}

interface ApprovalRequirementsBubblesProps {
  requirements: ApprovalRequirements;
  dynamicRequirements?: DynamicRequirement[];
  onApprove: () => void;
  disabled?: boolean;
  pipelineEntryId?: string;
  onUploadComplete?: () => void;
}

// Default bubble steps for backward compatibility
const defaultBubbleSteps = [
  { key: 'contract', label: 'Contract', icon: 'FileText', color: 'from-blue-500 to-blue-400', validationType: 'document' },
  { key: 'estimate', label: 'Estimate', icon: 'DollarSign', color: 'from-yellow-500 to-yellow-400', validationType: 'estimate' },
  { key: 'notice_of_commencement', label: 'Notice of Commencement', icon: 'Package', color: 'from-purple-500 to-purple-400', validationType: 'document' },
  { key: 'required_photos', label: 'Required Photos', icon: 'Camera', color: 'from-orange-500 to-orange-400', validationType: 'photos' },
] as const;

// Map keys to gradient colors
const colorMap: Record<string, string> = {
  'contract': 'from-blue-500 to-blue-400',
  'estimate': 'from-yellow-500 to-yellow-400',
  'notice_of_commencement': 'from-purple-500 to-purple-400',
  'required_photos': 'from-orange-500 to-orange-400',
};

export const ApprovalRequirementsBubbles: React.FC<ApprovalRequirementsBubblesProps> = ({
  requirements,
  dynamicRequirements = [],
  onApprove,
  disabled = false,
  pipelineEntryId,
  onUploadComplete,
}) => {
  const { toast } = useToast();
  const [uploadingContract, setUploadingContract] = useState(false);
  const [openPopover, setOpenPopover] = useState(false);
  const [openEstimatePopover, setOpenEstimatePopover] = useState(false);
  const [openGenericPopover, setOpenGenericPopover] = useState<string | null>(null);
  const [uploadingGeneric, setUploadingGeneric] = useState(false);
  const [selectedEstimateId, setSelectedEstimateId] = useState<string | null>(null);
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [overrideAcknowledged, setOverrideAcknowledged] = useState(false);
  const [approvingJob, setApprovingJob] = useState(false);
  
  // Document Scanner state
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanningDocType, setScanningDocType] = useState<string | null>(null);
  const [scanningDocLabel, setScanningDocLabel] = useState<string>('Document');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const genericFileInputRef = useRef<HTMLInputElement>(null);

  // Use dynamic requirements if available, otherwise fall back to defaults
  const bubbleSteps = dynamicRequirements.length > 0
    ? dynamicRequirements.map(req => ({
        key: req.key,
        label: req.label,
        icon: req.icon,
        color: colorMap[req.key] || 'from-primary to-primary/80',
        isComplete: req.isComplete,
        isRequired: req.isRequired,
        validationType: req.validationType,
      }))
    : defaultBubbleSteps.map(step => ({
        key: step.key,
        label: step.label,
        icon: step.icon,
        color: step.color,
        isComplete: step.key === 'contract' ? requirements.hasContract 
          : step.key === 'estimate' ? requirements.hasEstimate
          : step.key === 'notice_of_commencement' ? requirements.hasMaterials
          : requirements.hasLabor,
        isRequired: step.key === 'contract' || step.key === 'estimate',
        validationType: step.validationType,
      }));

  // Check if user is manager/admin
  const { data: userProfile } = useQuery({
    queryKey: ['userProfile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      
      if (error) throw error;
      return data;
    },
  });

  const isManager = userProfile?.role === 'owner' || userProfile?.role === 'master' || userProfile?.role === 'corporate' || userProfile?.role === 'office_admin' || userProfile?.role === 'regional_manager';

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
  
  const completedCount = bubbleSteps.filter(step => step.isComplete).length;
  const totalCount = bubbleSteps.length;
  const progressPercentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

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
      // Get user and tenant info
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user?.id)
        .single();

      const fileExt = file.name.split('.').pop();
      const fileName = `${pipelineEntryId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase
        .from('documents')
        .insert({
          tenant_id: profile?.tenant_id,
          pipeline_entry_id: pipelineEntryId,
          document_type: 'contract',
          filename: file.name,
          file_path: fileName,
          file_size: file.size,
          mime_type: file.type,
          uploaded_by: user?.id,
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
      
      // Invalidate all estimate-related queries for consistency
      const queryClient = await import('@tanstack/react-query').then(m => m.useQueryClient);
      
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

  // Generic file upload handler for photos/documents bubbles
  const handleGenericUpload = async (file: File, documentType: string, source: 'camera' | 'file') => {
    if (!pipelineEntryId) {
      toast({
        title: "Error",
        description: "Pipeline entry ID is required",
        variant: "destructive",
      });
      return;
    }

    setUploadingGeneric(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user?.id)
        .single();

      // For photo-type uploads, use the photo-upload edge function (canonical source)
      if (documentType === 'required_photos' || documentType === 'inspection_photo' || documentType === 'photos') {
        // Convert file to base64
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64Data = result.split(',')[1];
            resolve(base64Data);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Call the photo-upload edge function
        const { data, error } = await supabase.functions.invoke('photo-upload', {
          body: {
            action: 'upload',
            tenant_id: profile?.tenant_id,
            lead_id: pipelineEntryId,
            file_data: base64,
            filename: file.name,
            mime_type: file.type,
            category: 'inspection',
          }
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        toast({
          title: "Photo Uploaded",
          description: `Photo uploaded successfully via ${source}`,
        });
      } else {
        // For non-photo documents, use the documents bucket
        const fileExt = file.name.split('.').pop();
        const fileName = `${pipelineEntryId}/${Date.now()}_${documentType}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { error: dbError } = await supabase
          .from('documents')
          .insert({
            tenant_id: profile?.tenant_id,
            pipeline_entry_id: pipelineEntryId,
            document_type: documentType,
            filename: file.name,
            file_path: fileName,
            file_size: file.size,
            mime_type: file.type,
            uploaded_by: user?.id,
          });

        if (dbError) throw dbError;

        toast({
          title: "Upload Successful",
          description: `${documentType.replace(/_/g, ' ')} uploaded via ${source}`,
        });
      }
      
      setOpenGenericPopover(null);
      onUploadComplete?.();
    } catch (error: any) {
      console.error('Generic upload error:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingGeneric(false);
    }
  };

  const handleManagerApprove = async () => {
    if (!requirements.allComplete) {
      setShowOverrideDialog(true);
      return;
    }
    await processApproval();
  };

  const processApproval = async () => {
    if (!pipelineEntryId) {
      toast({
        title: "Error",
        description: "Pipeline entry ID is required",
        variant: "destructive",
      });
      return;
    }

    setApprovingJob(true);
    try {
      console.log('[Approval] Starting project approval for:', pipelineEntryId);
      
      // Call edge function to approve job and create project
      const { data, error } = await supabase.functions.invoke('api-approve-job-from-lead', {
        body: { 
          pipelineEntryId,
          jobDetails: {
            create_production_workflow: true,
            override_incomplete_requirements: !requirements.allComplete
          }
        }
      });

      console.log('[Approval] Response:', { data, error });

      if (error) {
        console.error('[Approval] Edge function error:', error);
        throw new Error(error.message || 'Edge function returned an error');
      }

      if (data?.error) {
        console.error('[Approval] Data error:', data.error);
        throw new Error(data.error.message || data.error || 'Approval failed');
      }

      if (data?.requires_approval) {
        toast({
          title: "Approval Required",
          description: `Projects over $25,000 require manager approval. Value: $${data.estimated_value?.toLocaleString()}`,
          variant: "destructive",
        });
        return;
      }

      // Check if project already existed
      if (data.already_existed) {
        toast({
          title: "Project Already Exists",
          description: `This lead has already been converted to project ${data.project_job_number}.`,
        });
      } else {
        toast({
          title: "Project Approved",
          description: `Project ${data.project_job_number || ''} has been created and added to production.`,
        });
      }

      setShowOverrideDialog(false);
      setOverrideAcknowledged(false);
      onApprove();
    } catch (error: any) {
      console.error('[Approval] Error details:', error);
      toast({
        title: "Approval Failed",
        description: error.message || "Failed to approve project. Please check the console for details.",
        variant: "destructive",
      });
    } finally {
      setApprovingJob(false);
    }
  };

  const getMissingRequirements = () => {
    return bubbleSteps
      .filter(step => step.isRequired && !step.isComplete)
      .map(step => step.label);
  };

  return (
    <div className="space-y-3">
      {/* Header with Progress and Action Button */}
      <div className="flex items-center justify-between">
        <div className="flex-1 mr-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Progress</span>
            <span className="text-sm text-muted-foreground">
              {completedCount} / {totalCount} complete
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

      {/* Floating Bubbles Timeline with Manager Approval */}
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          {/* Bubbles Section - Left Side */}
          <div className="flex-1">
            <div className="flex items-center justify-start gap-2 sm:gap-4 md:gap-5 flex-wrap">
          {bubbleSteps.map((step, index) => {
            const isComplete = step.isComplete;
            const Icon = getIcon(step.icon);
            
            return (
              <React.Fragment key={step.key}>
                {/* Bubble */}
                <div className="flex flex-col items-center space-y-1 sm:space-y-2 relative">
                  {/* Circular Bubble */}
                  {step.key === 'contract' && !isComplete ? (
                    <Popover open={openPopover} onOpenChange={setOpenPopover}>
                      <PopoverTrigger asChild>
                        <div
                          className={cn(
                            "relative w-10 h-10 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all duration-300",
                            "border-2 sm:border-4 cursor-pointer",
                            "bg-muted border-border opacity-50 hover:opacity-100 hover:border-primary hover:scale-105"
                          )}
                        >
                          <Icon 
                            className="h-4 w-4 sm:h-6 sm:w-6 text-muted-foreground"
                          />
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2">
                        <div className="space-y-1">
                          <Button
                            variant="ghost"
                            className="w-full justify-start"
                            onClick={() => {
                              setScanningDocType('contract');
                              setScanningDocLabel('Contract');
                              setScannerOpen(true);
                              setOpenPopover(false);
                            }}
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
                  ) : step.key === 'estimate' && !isComplete ? (
                    <Popover open={openEstimatePopover} onOpenChange={setOpenEstimatePopover}>
                      <PopoverTrigger asChild>
                        <div
                          className={cn(
                            "relative w-10 h-10 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all duration-300",
                            "border-2 sm:border-4 cursor-pointer",
                            "bg-muted border-border opacity-50 hover:opacity-100 hover:border-primary hover:scale-105"
                          )}
                        >
                          <Icon 
                            className="h-4 w-4 sm:h-6 sm:w-6 text-muted-foreground"
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
                  ) : (step.validationType === 'photos' || step.validationType === 'document') && !isComplete && step.key !== 'contract' && step.key !== 'estimate' ? (
                    // Generic photo/document upload popover for non-contract, non-estimate requirements
                    <Popover open={openGenericPopover === step.key} onOpenChange={(open) => setOpenGenericPopover(open ? step.key : null)}>
                      <PopoverTrigger asChild>
                        <div
                          className={cn(
                            "relative w-10 h-10 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all duration-300",
                            "border-2 sm:border-4 cursor-pointer",
                            "bg-muted border-border opacity-50 hover:opacity-100 hover:border-primary hover:scale-105"
                          )}
                        >
                          <Icon className="h-4 w-4 sm:h-6 sm:w-6 text-muted-foreground" />
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2">
                        <div className="space-y-1">
                          <Button
                            variant="ghost"
                            className="w-full justify-start"
                            onClick={() => {
                              setScanningDocType(step.key);
                              setScanningDocLabel(step.label);
                              setScannerOpen(true);
                              setOpenGenericPopover(null);
                            }}
                            disabled={uploadingGeneric}
                          >
                            <Camera className="h-4 w-4 mr-2" />
                            {step.validationType === 'photos' ? 'Take Photo' : 'Scan Document'}
                          </Button>
                          <Button
                            variant="ghost"
                            className="w-full justify-start"
                            onClick={() => genericFileInputRef.current?.click()}
                            disabled={uploadingGeneric}
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
                        "relative w-10 h-10 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all duration-300",
                        "border-2 sm:border-4",
                        isComplete
                          ? `bg-gradient-to-br ${step.color} border-white shadow-lg animate-scale-in hover:scale-110 hover:-translate-y-1 hover:shadow-xl cursor-pointer`
                          : "bg-muted border-border opacity-50"
                      )}
                    >
                      <Icon 
                        className={cn(
                          "h-4 w-4 sm:h-6 sm:w-6 transition-colors",
                          isComplete ? "text-white" : "text-muted-foreground"
                        )} 
                      />
                      
                      {/* Checkmark Badge */}
                      {isComplete && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-success rounded-full flex items-center justify-center border-2 border-background shadow-md animate-fade-in">
                          <CheckCircle className="h-3 w-3 text-success-foreground" />
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Label */}
                  <span className={cn(
                    "text-xs sm:text-sm font-medium text-center max-w-[60px] sm:max-w-none leading-tight",
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

          {/* Manager Approval Button - Right Side */}
          {isManager && (
            <div className="flex flex-col items-center gap-3 pt-2">
              <Button
                onClick={handleManagerApprove}
                disabled={disabled || approvingJob}
                className="gradient-primary whitespace-nowrap min-w-[160px]"
              >
                <Shield className="h-4 w-4 mr-2" />
                {approvingJob ? 'Approving...' : 'Manager Approve'}
              </Button>
              {!requirements.allComplete && (
                <div className="flex items-center gap-1 text-xs text-warning">
                  <AlertCircle className="h-3 w-3" />
                  <span>Override available</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Override Confirmation Dialog */}
      <AlertDialog open={showOverrideDialog} onOpenChange={setShowOverrideDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve with Incomplete Requirements?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>The following requirements are not yet complete:</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {getMissingRequirements().map((req) => (
                    <li key={req}>{req}</li>
                  ))}
                </ul>
                <div className="flex items-start space-x-2 pt-4 border-t">
                  <Checkbox
                    id="override-acknowledge"
                    checked={overrideAcknowledged}
                    onCheckedChange={(checked) => setOverrideAcknowledged(checked as boolean)}
                  />
                  <label
                    htmlFor="override-acknowledge"
                    className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    I acknowledge that not all requirements are complete and approve this job to proceed to In Production.
                  </label>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setOverrideAcknowledged(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={processApproval}
              disabled={!overrideAcknowledged || approvingJob}
              className="gradient-primary"
            >
              {approvingJob ? 'Processing...' : 'Approve Job'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/*,.doc,.docx"
        onChange={handleFileSelect}
        className="hidden"
      />
      {/* Generic file input for photos/documents bubbles */}
      <input
        ref={genericFileInputRef}
        type="file"
        accept="application/pdf,image/*,.doc,.docx"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && openGenericPopover) {
            handleGenericUpload(file, openGenericPopover, 'file');
          }
          e.target.value = '';
        }}
        className="hidden"
      />
      
      {/* Document Scanner Dialog */}
      {pipelineEntryId && (
        <DocumentScannerDialog
          open={scannerOpen}
          onOpenChange={setScannerOpen}
          documentType={scanningDocType || 'document'}
          documentLabel={scanningDocLabel}
          pipelineEntryId={pipelineEntryId}
          onUploadComplete={onUploadComplete}
        />
      )}
    </div>
  );
};
