import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { JobApprovalDialog } from '@/components/JobApprovalDialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  ArrowRight, 
  Briefcase, 
  DollarSign, 
  Home, 
  Calendar,
  AlertCircle,
  Loader2,
  Package,
  Hammer,
  TrendingUp
} from 'lucide-react';

interface PipelineToJobConverterProps {
  pipelineEntries: any[];
  onJobCreated: () => void;
}

interface EstimateData {
  selling_price: number | null;
  material_cost: number | null;
  labor_cost: number | null;
  actual_margin_percent: number | null;
}

export const PipelineToJobConverter: React.FC<PipelineToJobConverterProps> = ({
  pipelineEntries,
  onJobCreated
}) => {
  const [loading, setLoading] = useState(false);
  const [estimates, setEstimates] = useState<Record<string, EstimateData>>({});
  const { toast } = useToast();

  const convertibleEntries = pipelineEntries.filter(entry => 
    entry.status === 'ready_for_approval'
  );

  useEffect(() => {
    if (convertibleEntries.length > 0) {
      fetchEstimates();
    }
  }, [pipelineEntries]);

  const fetchEstimates = async () => {
    const entryIds = convertibleEntries.map(e => e.id);
    
    const { data, error } = await supabase
      .from('estimates')
      .select('pipeline_entry_id, selling_price, material_cost, labor_cost, actual_margin_percent')
      .in('pipeline_entry_id', entryIds);
    
    if (!error && data) {
      const estimatesMap = data.reduce((acc, est) => {
        acc[est.pipeline_entry_id] = est;
        return acc;
      }, {} as Record<string, EstimateData>);
      setEstimates(estimatesMap);
    }
  };

  const handleBulkConvert = async () => {
    setLoading(true);
    let successCount = 0;
    
    try {
      for (const entry of convertibleEntries) {
        try {
          const { data, error } = await supabase.functions.invoke('api-approve-job-from-lead', {
            body: {
              pipelineEntryId: entry.id,
              jobDetails: {
                name: `${entry.contacts?.first_name || ''} ${entry.contacts?.last_name || ''} - ${entry.roof_type?.replace('_', ' ') || 'Roofing Project'}`.trim(),
                description: `Job created from ${entry.roof_type?.replace('_', ' ') || 'roofing'} project`,
                priority: 'medium',
                create_production_workflow: false
              }
            }
          });
          
          if (error) throw error;
          successCount++;
        } catch (error) {
          console.error(`Failed to convert entry ${entry.id}:`, error);
        }
      }
      
      if (successCount > 0) {
        toast({
          title: "Conversion Complete",
          description: `${successCount} of ${convertibleEntries.length} pipeline entries converted to jobs successfully.`,
        });
        onJobCreated();
      } else {
        toast({
          title: "Conversion Failed",
          description: "No pipeline entries were converted. Please try individual conversions.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Conversion Error",
        description: "Failed to convert pipeline entries to jobs.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (convertibleEntries.length === 0) {
    return null;
  }

  return (
    <Card className="border-warning/20 bg-warning/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-warning">
          <AlertCircle className="h-5 w-5" />
          Pipeline Entries Ready for Conversion
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          Found {convertibleEntries.length} pipeline entries that can be converted to jobs.
        </div>
        
        {convertibleEntries.length > 1 && (
          <Button 
            onClick={handleBulkConvert} 
            disabled={loading}
            variant="outline"
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Converting All...
              </>
            ) : (
              <>
                <Briefcase className="h-4 w-4 mr-2" />
                Convert All to Jobs ({convertibleEntries.length})
              </>
            )}
          </Button>
        )}

        <div className="space-y-3">
          {convertibleEntries.map((entry) => {
            const estimate = estimates[entry.id];
            const profitPercent = estimate?.actual_margin_percent || 0;
            const getProfitColor = (percent: number) => {
              if (percent >= 30) return 'text-success';
              if (percent >= 20) return 'text-warning';
              return 'text-destructive';
            };

            return (
              <div key={entry.id} className="flex items-center justify-between p-4 bg-background rounded-lg border hover:shadow-soft transition-smooth">
                <div className="flex-1 min-w-0 mr-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Home className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="font-semibold capitalize">
                      {entry.roof_type?.replace('_', ' ') || 'Roofing Project'}
                    </span>
                    <Badge variant="secondary" className="text-xs ml-2">
                      {entry.status?.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </div>
                  
                  {estimate ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <DollarSign className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                        <div>
                          <div className="text-muted-foreground">Selling</div>
                          <div className="font-semibold">${estimate.selling_price?.toLocaleString() || '0'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                        <div>
                          <div className="text-muted-foreground">Material</div>
                          <div className="font-semibold">${estimate.material_cost?.toLocaleString() || '0'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Hammer className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                        <div>
                          <div className="text-muted-foreground">Labor</div>
                          <div className="font-semibold">${estimate.labor_cost?.toLocaleString() || '0'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <TrendingUp className={`h-3.5 w-3.5 flex-shrink-0 ${getProfitColor(profitPercent)}`} />
                        <div>
                          <div className="text-muted-foreground">Profit</div>
                          <div className={`font-bold ${getProfitColor(profitPercent)}`}>
                            {profitPercent.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {new Date(entry.created_at).toLocaleDateString()}
                      {entry.estimated_value && (
                        <>
                          <span>•</span>
                          <DollarSign className="h-3 w-3" />
                          ${entry.estimated_value.toLocaleString()}
                        </>
                      )}
                    </div>
                  )}
                </div>
                
                <JobApprovalDialog
                  pipelineEntry={entry}
                  onJobCreated={() => {
                    toast({
                      title: "Job Created",
                      description: `Pipeline entry converted to job successfully.`,
                    });
                    onJobCreated();
                  }}
                >
                  <Button size="sm" className="gradient-primary flex-shrink-0">
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Convert to Job
                  </Button>
                </JobApprovalDialog>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};