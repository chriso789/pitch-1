import React, { useRef, useState } from 'react';
import { FileText, DollarSign, Package, Camera, CheckCircle, ArrowRight, Upload, Shield, AlertCircle, Eye, Trash2 } from 'lucide-react';
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
import { DocumentPreviewModal } from '@/components/documents/DocumentPreviewModal';
import { resolveStorageBucket } from '@/lib/documents/resolveStorageBucket';
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
  
  // Review/Delete state for completed bubbles
  const [viewingDocument, setViewingDocument] = useState<{
    id: string;
    filename: string;
    file_path: string;
    mime_type: string | null;
    document_type: string | null;
  } | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingDocKey, setDeletingDocKey] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
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

  // Fetch documents for this pipeline entry to enable review/delete on completed bubbles
  const { data: requirementDocuments, refetch: refetchDocuments } = useQuery({
    queryKey: ['requirement-documents', pipelineEntryId],
    queryFn: async () => {
      if (!pipelineEntryId) return [];
      const { data, error } = await supabase
        .from('documents')
        .select('id, filename, file_path, mime_type, document_type')
        .eq('pipeline_entry_id', pipelineEntryId)
        .in('document_type', ['contract', 'notice_of_commencement', 'required_photos', 'inspection_photo', 'photos']);
      if (error) throw error;
      return data || [];
    },
    enabled: !!pipelineEntryId,
  });

  // Helper to find document for a specific requirement step
  const getDocumentForRequirement = (stepKey: string) => {
    if (!requirementDocuments) return null;
    
    // Map step keys to document types
    const typeMap: Record<string, string[]> = {
      'contract': ['contract'],
      'notice_of_commencement': ['notice_of_commencement'],
      'required_photos': ['required_photos', 'inspection_photo', 'photos'],
    };
    
    const docTypes = typeMap[stepKey] || [stepKey];
    return requirementDocuments.find(doc => 
      doc.document_type && docTypes.includes(doc.document_type)
    );
  };

  // Delete handler for requirement documents
  const handleDeleteRequirementDoc = async () => {
    if (!deletingDocId) return;
    
    setIsDeleting(true);
    try {
      const { error } = await supabase.functions.invoke('delete-documents', {
        body: { document_ids: [deletingDocId], mode: 'delete_only' }
      });
      
      if (error) throw error;
      
      toast({
        title: "Document Deleted",
        description: "You can now upload a new document.",
      });
      
      refetchDocuments();
      onUploadComplete?.();
    } catch (error: any) {
      toast({
        title: "Delete Failed",
        description: error.message || "Could not delete document",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteConfirmOpen(false);
      setDeletingDocId(null);
      setDeletingDocKey(null);
    }
  };

  // Download handler for document preview
  const handleDownloadDocument = async (doc: { id: string; filename: string; file_path: string; mime_type: string | null; document_type: string | null }) => {
    const bucket = resolveStorageBucket(doc.document_type, doc.file_path);
    const { data } = await supabase.storage.from(bucket).download(doc.file_path);
    if (data) {
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };
  
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

  // Helper to render a bubble icon (shared across all states)
  const renderBubbleIcon = (step: typeof bubbleSteps[0], isComplete: boolean) => {
    const Icon = getIcon(step.icon);
    if (isComplete) {
      return (
        <div
          className={cn(
            "relative w-9 h-9 rounded-full flex items-center justify-center",
            "border-2 cursor-pointer",
            `bg-gradient-to-br ${step.color} border-white shadow-md hover:scale-105`
          )}
        >
          <Icon className="h-4 w-4 text-white" />
          <div className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-success rounded-full flex items-center justify-center border border-background">
            <CheckCircle className="h-2.5 w-2.5 text-success-foreground" />
          </div>
        </div>
      );
    }
    return (
      <div
        className={cn(
          "relative w-9 h-9 rounded-full flex items-center justify-center",
          "border-2 cursor-pointer",
          "bg-muted border-border opacity-60 hover:opacity-100 hover:border-primary"
        )}
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  };

  return (
    <div className="space-y-2.5">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <Progress value={progressPercentage} className="h-1.5 flex-1" />
        <span className="text-[11px] text-muted-foreground font-medium shrink-0">
          {completedCount}/{totalCount}
        </span>
      </div>

      {/* Requirements grid - 2x2 on mobile, row on desktop */}
      <div className="grid grid-cols-4 gap-x-1 gap-y-2">
        {bubbleSteps.map((step) => {
          const isComplete = step.isComplete;

          // Wrap bubble in appropriate popover
          const bubbleElement = step.key === 'contract' && !isComplete ? (
            <Popover open={openPopover} onOpenChange={setOpenPopover}>
              <PopoverTrigger asChild>
                {renderBubbleIcon(step, isComplete)}
              </PopoverTrigger>
              <PopoverContent className="w-52 p-2">
                <div className="space-y-1">
                  <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => { setScanningDocType('contract'); setScanningDocLabel('Contract'); setScannerOpen(true); setOpenPopover(false); }} disabled={uploadingContract}>
                    <Camera className="h-3.5 w-3.5 mr-2" />Scan with Camera
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => fileInputRef.current?.click()} disabled={uploadingContract}>
                    <Upload className="h-3.5 w-3.5 mr-2" />Upload from Device
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : step.key === 'estimate' && !isComplete ? (
            <Popover open={openEstimatePopover} onOpenChange={setOpenEstimatePopover}>
              <PopoverTrigger asChild>
                {renderBubbleIcon(step, isComplete)}
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3">
                <div className="space-y-3">
                  <div>
                    <h4 className="font-semibold text-sm mb-0.5">Select Estimate</h4>
                    <p className="text-xs text-muted-foreground">Choose estimate for budget</p>
                  </div>
                  {estimatesLoading ? (
                    <p className="text-xs text-muted-foreground">Loading...</p>
                  ) : !availableEstimates || availableEstimates.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No estimates available.</p>
                  ) : (
                    <RadioGroup value={selectedEstimateId || ''} onValueChange={handleEstimateSelect}>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {availableEstimates.map((estimate) => (
                          <div key={estimate.id} className="flex items-start space-x-2 border rounded-lg p-2 hover:bg-accent/50">
                            <RadioGroupItem value={estimate.id} id={estimate.id} className="mt-0.5" />
                            <Label htmlFor={estimate.id} className="flex-1 cursor-pointer text-xs">
                              <div className="font-medium">{estimate.estimate_number || 'Estimate'}</div>
                              <div className="text-muted-foreground">${estimate.selling_price?.toLocaleString() || '0'}</div>
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
            <Popover open={openGenericPopover === step.key} onOpenChange={(open) => setOpenGenericPopover(open ? step.key : null)}>
              <PopoverTrigger asChild>
                {renderBubbleIcon(step, isComplete)}
              </PopoverTrigger>
              <PopoverContent className="w-52 p-2">
                <div className="space-y-1">
                  <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => { setScanningDocType(step.key); setScanningDocLabel(step.label); setScannerOpen(true); setOpenGenericPopover(null); }} disabled={uploadingGeneric}>
                    <Camera className="h-3.5 w-3.5 mr-2" />{step.validationType === 'photos' ? 'Take Photo' : 'Scan Document'}
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => genericFileInputRef.current?.click()} disabled={uploadingGeneric}>
                    <Upload className="h-3.5 w-3.5 mr-2" />Upload from Device
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : isComplete ? (
            <Popover>
              <PopoverTrigger asChild>
                {renderBubbleIcon(step, isComplete)}
              </PopoverTrigger>
              <PopoverContent className="w-52 p-2">
                <div className="space-y-1">
                  {step.key !== 'estimate' && (
                    <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => { const doc = getDocumentForRequirement(step.key); if (doc) setViewingDocument(doc); }} disabled={!getDocumentForRequirement(step.key)}>
                      <Eye className="h-3.5 w-3.5 mr-2" />View
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => { if (step.key === 'estimate') { setOpenEstimatePopover(true); } else { setScanningDocType(step.key); setScanningDocLabel(step.label); setScannerOpen(true); } }}>
                    <Camera className="h-3.5 w-3.5 mr-2" />{step.key === 'estimate' ? 'Change' : 'Replace'}
                  </Button>
                  {step.key !== 'estimate' && (
                    <Button variant="ghost" size="sm" className="w-full justify-start text-xs text-destructive hover:text-destructive" onClick={() => { const doc = getDocumentForRequirement(step.key); if (doc) { setDeletingDocId(doc.id); setDeletingDocKey(step.label); setDeleteConfirmOpen(true); } }} disabled={!getDocumentForRequirement(step.key)}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" />Delete
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            renderBubbleIcon(step, isComplete)
          );

          return (
            <div key={step.key} className="flex flex-col items-center gap-0.5">
              {bubbleElement}
              <span className={cn(
                "text-[10px] font-medium text-center leading-tight line-clamp-2",
                isComplete ? "text-foreground" : "text-muted-foreground"
              )}>
                {step.label}
              </span>
              <span className={cn(
                "text-[9px] px-1.5 py-px rounded-full leading-none",
                isComplete ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
              )}>
                {isComplete ? "Complete" : "Pending"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Action buttons row */}
      <div className="flex items-center gap-2">
        {requirements.allComplete ? (
          <Button onClick={onApprove} disabled={disabled} size="sm" className="gradient-primary text-xs h-7 px-3 flex-1">
            Approve to Project
          </Button>
        ) : (
          <Button disabled variant="outline" size="sm" className="text-xs h-7 px-3 flex-1">
            Complete Requirements
          </Button>
        )}
        {isManager && (
          <>
            <Button
              onClick={handleManagerApprove}
              disabled={disabled || approvingJob}
              size="sm"
              className="gradient-primary text-xs h-7 px-3 flex-1"
            >
              <Shield className="h-3 w-3 mr-1" />
              {approvingJob ? 'Approving...' : 'Manager Approve'}
            </Button>
            {!requirements.allComplete && (
              <span className="text-[9px] text-warning flex items-center gap-0.5 shrink-0">
                <AlertCircle className="h-2.5 w-2.5" />Override
              </span>
            )}
          </>
        )}
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
          onUploadComplete={() => {
            refetchDocuments();
            onUploadComplete?.();
          }}
        />
      )}

      {/* Document Preview Modal for viewing requirement documents */}
      {viewingDocument && (
        <DocumentPreviewModal
          document={viewingDocument}
          isOpen={!!viewingDocument}
          onClose={() => setViewingDocument(null)}
          onDownload={handleDownloadDocument}
        />
      )}

      {/* Delete Confirmation Dialog for requirement documents */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingDocKey} Document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the document. You will need to upload a new one to complete this requirement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRequirementDoc}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete Document'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
