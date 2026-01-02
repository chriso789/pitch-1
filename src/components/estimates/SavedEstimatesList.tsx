import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, FileText, ExternalLink, TrendingUp, TrendingDown, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
}

export const SavedEstimatesList: React.FC<SavedEstimatesListProps> = ({
  pipelineEntryId,
  onCreateNew,
  selectedEstimateId: externalSelectedId,
  onEstimateSelect
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
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

      // Invalidate queries to refresh
      queryClient.invalidateQueries({ queryKey: ['pipeline-entry-metadata', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['lead-requirements', pipelineEntryId] });
      
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
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{estimate.estimate_number}</span>
                  {isSelected && (
                    <Badge variant="default" className="bg-primary text-primary-foreground text-xs">
                      <Check className="h-3 w-3 mr-1" />
                      Active
                    </Badge>
                  )}
                  <span className="text-muted-foreground">•</span>
                  <span className="text-sm text-muted-foreground truncate">
                    {estimate.short_description || estimate.template_name}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <Badge className={getStatusBadge(estimate.status)} variant="secondary">
                    {estimate.status}
                  </Badge>
                  <span className={`flex items-center gap-1 ${getProfitColor(estimate.actual_profit_percent || 0)}`}>
                    {(estimate.actual_profit_percent || 0) >= 25 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {(estimate.actual_profit_percent || 0).toFixed(1)}% Profit
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold">
                  {formatCurrency(estimate.selling_price || 0)}
                </span>
                {estimate.pdf_url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleViewPDF(estimate.pdf_url!)}
                    className="h-8 px-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default SavedEstimatesList;
