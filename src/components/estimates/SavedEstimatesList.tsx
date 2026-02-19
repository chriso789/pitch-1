import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, FileText, ExternalLink, Percent, Check, Pencil, Trash2, FileSignature } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

interface SavedEstimate {
  id: string;
  estimate_number: string;
  short_description: string | null;
  display_name: string | null;
  pricing_tier: 'good' | 'better' | 'best' | null;
  selling_price: number;
  actual_profit_percent: number;
  status: string;
  pdf_url: string | null;
  created_at: string;
  template_name?: string;
}

interface SavedEstimatesListProps {
  pipelineEntryId: string;
  onCreateNew?: () => void;
  selectedEstimateId?: string | null;
  onEstimateSelect?: (estimateId: string) => void;
  onEditEstimate?: (estimateId: string) => void;
  onShareEstimate?: (estimateId: string) => void;
  currentEditingId?: string | null;
  hasUnsavedChanges?: boolean;
  onSaveAndSwitch?: () => Promise<void>;
  currentEditingName?: string;
  onEstimateDeleted?: (estimateId: string) => void;
}

export const SavedEstimatesList: React.FC<SavedEstimatesListProps> = ({
  pipelineEntryId,
  onCreateNew,
  selectedEstimateId: externalSelectedId,
  onEstimateSelect,
  onEditEstimate,
  onShareEstimate,
  currentEditingId,
  hasUnsavedChanges = false,
  onSaveAndSwitch,
  currentEditingName,
  onEstimateDeleted
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [estimateToDelete, setEstimateToDelete] = useState<SavedEstimate | null>(null);
  const [showCannotDeleteDialog, setShowCannotDeleteDialog] = useState(false);
  
  // Unsaved changes dialog state
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [pendingEditId, setPendingEditId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Get current editing ID from URL if not provided as prop
  const effectiveEditingId = currentEditingId ?? searchParams.get('editEstimate');
  
  // Fetch the current selected estimate from pipeline_entries metadata
  const { data: pipelineData } = useQuery({
    queryKey: ['pipeline-entry-metadata', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!pipelineEntryId,
  });

  const currentSelectedId = externalSelectedId ?? (pipelineData?.metadata as any)?.selected_estimate_id;

  const { data: estimates, isLoading } = useQuery({
    queryKey: ['saved-estimates', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enhanced_estimates')
        .select(`
          id,
          estimate_number,
          short_description,
          display_name,
          pricing_tier,
          selling_price,
          actual_profit_percent,
          status,
          pdf_url,
          created_at,
          template_id,
          estimate_calculation_templates(name)
        `)
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map((est: any) => ({
        ...est,
        template_name: est.estimate_calculation_templates?.name || 'Custom'
      })) as SavedEstimate[];
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch signature envelopes linked to estimates for this pipeline entry
  const { data: signatureEnvelopes } = useQuery({
    queryKey: ['estimate-signature-envelopes', pipelineEntryId],
    queryFn: async () => {
      const estimateIds = estimates?.map(e => e.id) || [];
      if (estimateIds.length === 0) return {};

      const { data, error } = await supabase
        .from('signature_envelopes')
        .select('id, estimate_id, status')
        .in('estimate_id', estimateIds);

      if (error) throw error;

      // Map estimate_id -> latest envelope status
      const map: Record<string, string> = {};
      for (const env of (data || [])) {
        if (env.estimate_id) {
          // Keep the most relevant status (completed > sent > pending)
          const existing = map[env.estimate_id];
          if (!existing || env.status === 'completed' || (env.status === 'sent' && existing === 'pending')) {
            map[env.estimate_id] = env.status;
          }
        }
      }
      return map;
    },
    enabled: !!pipelineEntryId && !!estimates && estimates.length > 0,
  });

  const handleSelectEstimate = async (estimateId: string) => {
    const isCurrentlySelected = currentSelectedId === estimateId;
    const newSelectedId = isCurrentlySelected ? null : estimateId;
    
    try {
      // Get current metadata
      const { data: currentEntry } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();

      const currentMetadata = (currentEntry?.metadata as Record<string, any>) || {};

      // Update the pipeline entry metadata
      const { error } = await supabase
        .from('pipeline_entries')
        .update({ 
          metadata: { 
            ...currentMetadata,
            selected_estimate_id: newSelectedId 
          }
        })
        .eq('id', pipelineEntryId);

      if (error) throw error;

      // Invalidate queries to refresh - including the hyperlink bar and TemplateSectionSelector
      queryClient.invalidateQueries({ queryKey: ['pipeline-entry-metadata', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-selected-estimate', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-estimate-items', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['lead-requirements', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['hyperlink-data', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['estimate-costs', pipelineEntryId] });
      
      // Call external handler if provided
      if (onEstimateSelect && newSelectedId) {
        onEstimateSelect(newSelectedId);
      }

      toast({
        title: newSelectedId ? "Estimate Selected" : "Estimate Deselected",
        description: newSelectedId 
          ? "This estimate is now active for the project's materials and labor."
          : "No estimate is currently selected for this project.",
      });
    } catch (error) {
      console.error('Error selecting estimate:', error);
      toast({
        title: "Error",
        description: "Failed to update estimate selection.",
        variant: "destructive",
      });
    }
  };

  const getProfitColor = (percent: number) => {
    if (percent >= 30) return 'text-success';
    if (percent >= 20) return 'text-warning';
    return 'text-destructive';
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      draft: 'bg-muted text-muted-foreground',
      sent: 'bg-primary/20 text-primary',
      viewed: 'bg-accent text-accent-foreground',
      approved: 'bg-success/20 text-success',
      rejected: 'bg-destructive/20 text-destructive',
    };
    return variants[status] || variants.draft;
  };

  const handleViewPDF = async (pdfUrl: string) => {
    try {
      const { data } = await supabase.storage
        .from('documents')
        .createSignedUrl(pdfUrl, 3600);

      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
      }
    } catch (error) {
      console.error('Error getting PDF URL:', error);
    }
  };

  const handleDeleteEstimate = async () => {
    if (!estimateToDelete) return;
    
    // Store reference and close dialog immediately for better UX
    const estimateToRemove = estimateToDelete;
    setDeleteDialogOpen(false);
    setEstimateToDelete(null);
    
    try {
      // If this estimate has a PDF, delete it from storage first
      if (estimateToRemove.pdf_url) {
        await supabase.storage
          .from('documents')
          .remove([estimateToRemove.pdf_url]);
      }
      
      // Delete the estimate from the database and verify it was actually deleted
      const { data: deletedRows, error } = await supabase
        .from('enhanced_estimates')
        .delete()
        .eq('id', estimateToRemove.id)
        .select('id');
      
      if (error) throw error;
      
      // Verify the delete actually affected a row (RLS may silently block it)
      if (!deletedRows || deletedRows.length === 0) {
        // Refetch to restore correct UI state
        queryClient.invalidateQueries({ queryKey: ['saved-estimates', pipelineEntryId] });
        toast({
          title: 'Delete Failed',
          description: 'Unable to delete this estimate. You may not have permission.',
          variant: 'destructive',
        });
        return;
      }
      
      // If this was the selected estimate, clear the selection
      if (currentSelectedId === estimateToRemove.id) {
        const { data: currentEntry } = await supabase
          .from('pipeline_entries')
          .select('metadata')
          .eq('id', pipelineEntryId)
          .single();
        
        const currentMetadata = (currentEntry?.metadata as Record<string, any>) || {};
        
        await supabase
          .from('pipeline_entries')
          .update({ 
            metadata: { 
              ...currentMetadata,
              selected_estimate_id: null 
            }
          })
          .eq('id', pipelineEntryId);
      }
      
      // OPTIMISTIC UPDATE: Immediately remove from cache for instant UI update
      queryClient.setQueryData(
        ['saved-estimates', pipelineEntryId], 
        (oldData: SavedEstimate[] | undefined) => 
          oldData?.filter(est => est.id !== estimateToRemove.id) ?? []
      );
      
      // Background sync to ensure data consistency
      queryClient.invalidateQueries({ queryKey: ['saved-estimates', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-entry-metadata', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['hyperlink-data', pipelineEntryId] });
      
      // Notify parent so sibling components can clear editing state
      onEstimateDeleted?.(estimateToRemove.id);
      
      toast({
        title: 'Estimate Deleted',
        description: `${estimateToRemove.estimate_number} has been permanently deleted.`,
      });
    } catch (error) {
      console.error('Error deleting estimate:', error);
      // Refetch to restore correct UI state on error
      queryClient.invalidateQueries({ queryKey: ['saved-estimates', pipelineEntryId] });
      toast({
        title: 'Error',
        description: 'Failed to delete estimate.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!estimates || estimates.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Saved Estimates ({estimates.length})
          </CardTitle>
          {onCreateNew && (
            <Button variant="outline" size="sm" onClick={onCreateNew}>
              Create Another
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {estimates.map((estimate) => {
          const isSelected = currentSelectedId === estimate.id;
          return (
            <div
              key={estimate.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                isSelected 
                  ? 'bg-primary/10 border-primary' 
                  : 'bg-card hover:bg-accent/50'
              }`}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => handleSelectEstimate(estimate.id)}
                className="h-5 w-5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-medium text-sm">{estimate.display_name || estimate.estimate_number}</span>
                  {isSelected && (
                    <Badge variant="default" className="bg-primary text-primary-foreground text-xs">
                      <Check className="h-3 w-3 mr-1" />
                      Active
                    </Badge>
                  )}
                  {estimate.pricing_tier && (
                    <Badge 
                      variant="outline" 
                      className={
                        estimate.pricing_tier === 'best' 
                          ? 'border-amber-500 text-amber-600 bg-amber-50' 
                          : estimate.pricing_tier === 'better' 
                            ? 'border-blue-500 text-blue-600 bg-blue-50'
                            : 'border-gray-400 text-gray-600 bg-gray-50'
                      }
                    >
                      {estimate.pricing_tier.charAt(0).toUpperCase() + estimate.pricing_tier.slice(1)}
                    </Badge>
                  )}
                  <span className="text-muted-foreground">•</span>
                  <span className="text-sm text-muted-foreground truncate">
                    {estimate.short_description || estimate.template_name}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <Badge className={getStatusBadge(estimate.status)} variant="secondary">
                    {estimate.status}
                  </Badge>
                  {signatureEnvelopes?.[estimate.id] && (
                    <Badge 
                      variant="outline"
                      className={
                        signatureEnvelopes[estimate.id] === 'completed'
                          ? 'border-green-500 text-green-600 bg-green-50 dark:bg-green-950/30'
                          : 'border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/30'
                      }
                    >
                      <FileSignature className="h-3 w-3 mr-1" />
                      {signatureEnvelopes[estimate.id] === 'completed' ? 'Signed' : 'Awaiting Signature'}
                    </Badge>
                  )}
                  <span className={`flex items-center gap-1 ${getProfitColor(estimate.actual_profit_percent || 0)}`}>
                    <Percent className="h-3 w-3" />
                    {(estimate.actual_profit_percent || 0).toFixed(1)}% Margin
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold">
                  {formatCurrency(estimate.selling_price || 0)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    
                    // If clicking on the same estimate, do nothing
                    if (effectiveEditingId === estimate.id) {
                      return;
                    }
                    
                    // If there's an active estimate with unsaved changes, show confirmation
                    if (effectiveEditingId && effectiveEditingId !== estimate.id && hasUnsavedChanges) {
                      setPendingEditId(estimate.id);
                      setShowUnsavedWarning(true);
                      return;
                    }
                    
                    // Otherwise proceed directly
                    onEditEstimate?.(estimate.id);
                  }}
                  className="h-8 px-2"
                  title="Edit Estimate"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEstimateToDelete(estimate);
                    // Check if this is the only estimate
                    if (estimates && estimates.length === 1) {
                      setShowCannotDeleteDialog(true);
                    } else {
                      setDeleteDialogOpen(true);
                    }
                  }}
                  className="h-8 px-2 text-muted-foreground hover:text-destructive"
                  title="Delete Estimate"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onShareEstimate?.(estimate.id);
                  }}
                  className="h-8 px-2"
                  title="Share Estimate"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>

      {/* Simple delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Estimate?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{estimateToDelete?.estimate_number}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteEstimate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cannot delete last estimate dialog */}
      <AlertDialog open={showCannotDeleteDialog} onOpenChange={setShowCannotDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cannot Delete Last Estimate</AlertDialogTitle>
            <AlertDialogDescription>
              You must have at least one estimate for this project. Create a new estimate first, then you can delete this one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>OK</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowCannotDeleteDialog(false);
                onCreateNew?.();
              }}
            >
              Create New Estimate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsaved changes warning dialog */}
      <AlertDialog open={showUnsavedWarning} onOpenChange={setShowUnsavedWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes{currentEditingName ? ` to "${currentEditingName}"` : ''}.
              What would you like to do?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel 
              onClick={() => {
                setShowUnsavedWarning(false);
                setPendingEditId(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setShowUnsavedWarning(false);
                // Discard and switch
                if (pendingEditId) {
                  onEditEstimate?.(pendingEditId);
                }
                setPendingEditId(null);
              }}
            >
              Discard Changes
            </Button>
            <Button
              onClick={async () => {
                if (!onSaveAndSwitch) {
                  // If no save handler, just switch
                  setShowUnsavedWarning(false);
                  if (pendingEditId) {
                    onEditEstimate?.(pendingEditId);
                  }
                  setPendingEditId(null);
                  return;
                }
                
                setIsSaving(true);
                try {
                  await onSaveAndSwitch();
                  setShowUnsavedWarning(false);
                  // After save succeeds, switch to the pending estimate
                  if (pendingEditId) {
                    onEditEstimate?.(pendingEditId);
                  }
                  setPendingEditId(null);
                } catch (error) {
                  console.error('Error saving before switch:', error);
                  toast({
                    title: 'Save Failed',
                    description: 'Could not save changes. Please try again.',
                    variant: 'destructive',
                  });
                } finally {
                  setIsSaving(false);
                }
              }}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default SavedEstimatesList;
