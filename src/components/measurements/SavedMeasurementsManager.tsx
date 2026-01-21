import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  CheckCircle2, Trash2, Ruler, FileText, Star, StarOff,
  Loader2, AlertCircle, Upload, Calculator
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/components/ui/use-toast';
import { ImportReportButton } from './ImportReportButton';

interface SavedMeasurement {
  id: string;
  approved_at: string;
  saved_tags: Record<string, any>;
  approval_notes: string | null;
  source?: string;
}

interface ExternalReport {
  id: string;
  provider: string;
  total_area_sqft: number | null;
  facet_count: number | null;
  predominant_pitch: string | null;
  uploaded_at: string;
  linears: Record<string, any> | null;
}

interface SavedMeasurementsManagerProps {
  pipelineEntryId: string;
  onMeasurementSelected?: (approvalId: string) => void;
  compact?: boolean;
}

export function SavedMeasurementsManager({ 
  pipelineEntryId, 
  onMeasurementSelected,
  compact = false 
}: SavedMeasurementsManagerProps) {
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Fetch approved measurements
  const { data: approvals, isLoading: approvalsLoading } = useQuery({
    queryKey: ['measurement-approvals', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('measurement_approvals')
        .select('id, approved_at, saved_tags, approval_notes')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('approved_at', { ascending: false });

      if (error) throw error;
      return data as SavedMeasurement[];
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch external reports
  const { data: externalReports, isLoading: reportsLoading } = useQuery({
    queryKey: ['external-reports', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_measurement_reports')
        .select('id, provider, total_area_sqft, facet_count, predominant_pitch, uploaded_at, linears')
        .eq('lead_id', pipelineEntryId)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      return data as ExternalReport[];
    },
    enabled: !!pipelineEntryId,
  });

  // Get current active measurement from pipeline entry
  const { data: activeApproval } = useQuery({
    queryKey: ['active-measurement', pipelineEntryId],
    queryFn: async () => {
      const { data } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();
      
      const metadata = data?.metadata as any;
      return metadata?.selected_measurement_approval_id || null;
    },
    enabled: !!pipelineEntryId,
  });

  const handleDelete = async (approvalId: string) => {
    if (!confirm('Delete this saved measurement? This cannot be undone.')) return;
    
    setIsDeleting(approvalId);
    try {
      const { error } = await supabase
        .from('measurement_approvals')
        .delete()
        .eq('id', approvalId);

      if (error) throw error;

      toast({
        title: 'Deleted',
        description: 'Saved measurement deleted successfully',
      });

      queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
    } catch (error: any) {
      toast({
        title: 'Delete Failed',
        description: error.message || 'Failed to delete measurement',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(null);
    }
  };

  const handleSetActive = async (approvalId: string) => {
    try {
      const { data: entry, error: fetchError } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();

      if (fetchError) throw fetchError;

      const existingMetadata = (entry?.metadata as Record<string, any>) || {};

      const { error: updateError } = await supabase
        .from('pipeline_entries')
        .update({
          metadata: {
            ...existingMetadata,
            selected_measurement_approval_id: approvalId,
          },
        })
        .eq('id', pipelineEntryId);

      if (updateError) throw updateError;

      setActiveId(approvalId);
      queryClient.invalidateQueries({ queryKey: ['active-measurement', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
      
      onMeasurementSelected?.(approvalId);

      toast({
        title: 'Active Measurement Set',
        description: 'This measurement will be used for estimate templates',
      });
    } catch (error: any) {
      toast({
        title: 'Failed',
        description: error.message || 'Could not set active measurement',
        variant: 'destructive',
      });
    }
  };

  const getSourceBadge = (savedTags: Record<string, any>) => {
    const source = savedTags?.source || 'unknown';
    if (source.includes('xactimate')) {
      return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">Xactimate</Badge>;
    }
    if (source.includes('eagleview')) {
      return <Badge variant="outline" className="bg-info/10 text-info border-info/30">EagleView</Badge>;
    }
    if (source.includes('roofr')) {
      return <Badge variant="outline" className="bg-success/10 text-success border-success/30">Roofr</Badge>;
    }
    if (source.includes('ai') || source.includes('google')) {
      return <Badge variant="outline" className="bg-accent/50 text-accent-foreground border-accent">AI-Pulled</Badge>;
    }
    return <Badge variant="outline">Imported</Badge>;
  };

  const formatValue = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
  };

  const isLoading = approvalsLoading || reportsLoading;
  const currentActive = activeId || activeApproval;
  const hasApprovals = approvals && approvals.length > 0;
  const hasReports = externalReports && externalReports.length > 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasApprovals && !hasReports) {
    return (
      <Card className={compact ? 'border-dashed' : ''}>
        <CardContent className="flex flex-col items-center justify-center py-8 gap-4">
          <div className="rounded-full bg-muted p-3">
            <Ruler className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-medium">No Saved Measurements</p>
            <p className="text-sm text-muted-foreground mt-1">
              Import an Xactimate, EagleView, or Roofr report to get started
            </p>
          </div>
          <ImportReportButton 
            pipelineEntryId={pipelineEntryId} 
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
              queryClient.invalidateQueries({ queryKey: ['external-reports', pipelineEntryId] });
            }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={compact ? 'border-0 shadow-none' : ''}>
      {!compact && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calculator className="h-5 w-5" />
              Saved Measurements
            </CardTitle>
            <ImportReportButton 
              pipelineEntryId={pipelineEntryId} 
              onSuccess={() => {
                queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
                queryClient.invalidateQueries({ queryKey: ['external-reports', pipelineEntryId] });
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Select which measurement to use for estimate templates
          </p>
        </CardHeader>
      )}
      <CardContent className={compact ? 'p-0' : ''}>
        <ScrollArea className={compact ? 'max-h-[300px]' : 'max-h-[400px]'}>
          <div className="space-y-2">
            {approvals?.map((approval) => {
              const tags = approval.saved_tags || {};
              const isActive = currentActive === approval.id;
              const squares = tags['roof.squares'] || tags['xactimate.squares'] || 0;
              const sqft = tags['roof.total_sqft'] || tags['roof.plan_area'] || 0;
              const pitch = tags['roof.predominant_pitch'] || '—';
              const facets = tags['roof.faces_count'] || 0;
              const ridgeLf = tags['lf.ridge'] || 0;

              return (
                <div
                  key={approval.id}
                  className={`
                    relative p-3 rounded-lg border transition-all
                    ${isActive 
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20' 
                      : 'border-border hover:border-muted-foreground/30'
                    }
                  `}
                >
                  {isActive && (
                    <div className="absolute top-2 right-2">
                      <Badge className="bg-primary text-primary-foreground">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Active
                      </Badge>
                    </div>
                  )}
                  
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getSourceBadge(tags)}
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(approval.approved_at), 'MMM d, yyyy h:mm a')}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-sm mt-2">
                        <div>
                          <span className="text-muted-foreground">Squares:</span>{' '}
                          <span className="font-medium">{formatValue(squares)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Sq Ft:</span>{' '}
                          <span className="font-medium">{formatValue(sqft)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Pitch:</span>{' '}
                          <span className="font-medium">{pitch}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Ridge:</span>{' '}
                          <span className="font-medium">{formatValue(ridgeLf)} ft</span>
                        </div>
                      </div>

                      {approval.approval_notes && (
                        <p className="text-xs text-muted-foreground mt-2 truncate">
                          {approval.approval_notes}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-3 pt-2 border-t">
                    {!isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSetActive(approval.id)}
                        className="text-xs"
                      >
                        <Star className="h-3 w-3 mr-1" />
                        Use for Estimates
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(approval.id)}
                      disabled={isDeleting === approval.id}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      {isDeleting === approval.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
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
