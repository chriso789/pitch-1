import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  CheckCircle2, Download, User, Trash2,
  Ruler, Home, Loader2, X
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/components/ui/use-toast';

interface ApprovedMeasurement {
  id: string;
  approved_at: string;
  saved_tags: Record<string, any>;
  approval_notes: string | null;
  report_generated: boolean;
  report_document_id: string | null;
  approved_by_profile?: {
    full_name: string;
  };
  document?: {
    id: string;
    file_name: string;
    storage_path: string;
  };
}

interface ApprovedMeasurementsListProps {
  pipelineEntryId: string;
}

export function ApprovedMeasurementsList({ pipelineEntryId }: ApprovedMeasurementsListProps) {
  const queryClient = useQueryClient();
  const [selectedApprovals, setSelectedApprovals] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: approvals, isLoading } = useQuery({
    queryKey: ['measurement-approvals', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('measurement_approvals')
        .select(`
          id,
          approved_at,
          saved_tags,
          approval_notes,
          report_generated,
          report_document_id,
          approved_by
        `)
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('approved_at', { ascending: false });

      if (error) throw error;
      
      // Fetch related data separately to avoid complex join issues
      const approvalData = await Promise.all((data || []).map(async (approval) => {
        let approvedByProfile = null;
        let document = null;
        
        if (approval.approved_by) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('first_name, last_name')
            .eq('id', approval.approved_by)
            .single();
          if (profile) {
            approvedByProfile = { full_name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() };
          }
        }
        
        if (approval.report_document_id) {
          const { data: doc } = await supabase
            .from('documents')
            .select('id, filename, file_path')
            .eq('id', approval.report_document_id)
            .single();
          if (doc) {
            document = { id: doc.id, file_name: doc.filename, storage_path: doc.file_path };
          }
        }
        
        return {
          ...approval,
          approved_by_profile: approvedByProfile,
          document
        };
      }));
      
      return approvalData as ApprovedMeasurement[];
    },
    enabled: !!pipelineEntryId
  });

  const handleDownloadReport = async (storagePath: string, fileName: string) => {
    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .createSignedUrl(storagePath, 3600);

      if (error) throw error;
      
      window.open(data.signedUrl, '_blank');
    } catch (error) {
      console.error('Error downloading report:', error);
      toast({
        title: 'Download Failed',
        description: 'Could not download the measurement report.',
        variant: 'destructive'
      });
    }
  };

  const handleDeleteApproval = async (approvalId: string, documentId?: string | null, _storagePath?: string) => {
    if (!confirm('Delete this approved measurement? This cannot be undone.')) return;

    setIsDeleting(true);
    try {
      // Delete the approval first (removes FK reference)
      const { error: approvalError } = await supabase
        .from('measurement_approvals')
        .delete()
        .eq('id', approvalId);

      if (approvalError) {
        throw new Error(`Failed to delete approval: ${approvalError.message}`);
      }

      // Now delete the associated document via edge function (handles storage safely)
      if (documentId) {
        const { data, error: docError } = await supabase.functions.invoke('delete-documents', {
          body: { document_ids: [documentId], mode: 'delete_only' }
        });

        if (docError) {
          console.warn('Document deletion warning:', docError);
          // Don't fail the whole operation - approval is already deleted
        } else if (data?.errors?.length > 0) {
          console.warn('Document deletion partial errors:', data.errors);
        }
      }

      toast({
        title: 'Deleted',
        description: 'Approved measurement deleted successfully',
      });

      setSelectedApprovals(prev => {
        const next = new Set(prev);
        next.delete(approvalId);
        return next;
      });

      queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
    } catch (error: any) {
      console.error('Delete error:', error);
      toast({
        title: 'Delete Failed',
        description: error.message || 'Failed to delete approved measurement',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedApprovals.size === 0 || !approvals) return;
    if (!confirm(`Delete ${selectedApprovals.size} approved measurement(s)? This cannot be undone.`)) return;

    setIsDeleting(true);
    try {
      const approvalsToDelete = approvals.filter(a => selectedApprovals.has(a.id));
      const approvalIds = approvalsToDelete.map(a => a.id);
      
      // Delete the approvals first (removes FK references)
      const { error: approvalError } = await supabase
        .from('measurement_approvals')
        .delete()
        .in('id', approvalIds);

      if (approvalError) {
        throw new Error(`Failed to delete approvals: ${approvalError.message}`);
      }

      // Collect document IDs to delete
      const documentIds = approvalsToDelete
        .filter(a => a.document?.id)
        .map(a => a.document!.id);

      // Delete associated documents via edge function
      if (documentIds.length > 0) {
        const { data, error: docError } = await supabase.functions.invoke('delete-documents', {
          body: { document_ids: documentIds, mode: 'delete_only' }
        });

        if (docError) {
          console.warn('Document deletion warning:', docError);
        } else if (data?.errors?.length > 0) {
          console.warn('Document deletion partial errors:', data.errors);
        }
      }

      toast({
        title: 'Deleted',
        description: `${approvalIds.length} approved measurement(s) deleted successfully`,
      });

      setSelectedApprovals(new Set());
      queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
    } catch (error: any) {
      console.error('Bulk delete error:', error);
      toast({
        title: 'Delete Failed',
        description: error.message || 'Failed to delete some approved measurements',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleApprovalSelection = (approvalId: string) => {
    setSelectedApprovals(prev => {
      const next = new Set(prev);
      if (next.has(approvalId)) {
        next.delete(approvalId);
      } else {
        next.add(approvalId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!approvals) return;
    if (selectedApprovals.size === approvals.length) {
      setSelectedApprovals(new Set());
    } else {
      setSelectedApprovals(new Set(approvals.map(a => a.id)));
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading approved measurements...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!approvals?.length) {
    return null; // Don't show anything if no approved measurements
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Approved Measurements
            {selectedApprovals.size > 0 && (
              <Badge variant="secondary">{selectedApprovals.size} selected</Badge>
            )}
          </CardTitle>
          {selectedApprovals.size > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedApprovals(new Set())}
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={isDeleting}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete {selectedApprovals.size}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className={approvals.length > 3 ? 'h-[300px]' : undefined}>
          <div className="space-y-3">
            {approvals.length > 1 && (
              <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 rounded-lg">
                <Checkbox
                  checked={selectedApprovals.size === approvals.length && approvals.length > 0}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all approvals"
                />
                <span className="text-sm text-muted-foreground">
                  Select all ({approvals.length})
                </span>
              </div>
            )}
            {approvals.map((approval) => {
              const tags = approval.saved_tags || {};
              const squares = tags['roof.squares'] || tags['roof.plan_area'] 
                ? ((tags['roof.plan_area'] || 0) / 100).toFixed(1) 
                : null;
              const pitch = tags['roof.predominant_pitch'] || tags['roof.pitch'];
              const facets = tags['roof.faces_count'];
              const isSelected = selectedApprovals.has(approval.id);

              return (
                <div
                  key={approval.id}
                  className={`flex items-center justify-between p-4 rounded-lg border bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900 ${
                    isSelected ? 'ring-2 ring-primary' : ''
                  }`}
                >
                  <div className="flex items-start gap-3 flex-1">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleApprovalSelection(approval.id)}
                      aria-label={`Select approval from ${format(new Date(approval.approved_at), 'MMM d, yyyy')}`}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/30">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Approved
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(approval.approved_at), 'MMM d, yyyy h:mm a')}
                        </span>
                      </div>

                      {/* Key Measurements */}
                      <div className="flex flex-wrap gap-4 text-sm">
                        {squares && (
                          <div className="flex items-center gap-1.5">
                            <Home className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{squares}</span>
                            <span className="text-muted-foreground">squares</span>
                          </div>
                        )}
                        {pitch && (
                          <div className="flex items-center gap-1.5">
                            <Ruler className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{pitch}</span>
                            <span className="text-muted-foreground">pitch</span>
                          </div>
                        )}
                        {facets && (
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{facets}</span>
                            <span className="text-muted-foreground">facets</span>
                          </div>
                        )}
                      </div>

                      {approval.approved_by_profile && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
                          <User className="h-3 w-3" />
                          <span>Approved by {approval.approved_by_profile.full_name}</span>
                        </div>
                      )}

                      {approval.approval_notes && (
                        <p className="text-xs text-muted-foreground mt-1 italic">
                          "{approval.approval_notes}"
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    {approval.report_generated && approval.document && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownloadReport(
                          approval.document!.storage_path,
                          approval.document!.file_name
                        )}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        View Report
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteApproval(
                        approval.id,
                        approval.document?.id,
                        approval.document?.storage_path
                      )}
                      className="text-destructive hover:text-destructive"
                      title="Delete approval"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}