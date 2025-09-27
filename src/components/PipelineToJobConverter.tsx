import React, { useState } from 'react';
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
  Loader2 
} from 'lucide-react';

interface PipelineToJobConverterProps {
  pipelineEntries: any[];
  onJobCreated: () => void;
}

export const PipelineToJobConverter: React.FC<PipelineToJobConverterProps> = ({
  pipelineEntries,
  onJobCreated
}) => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const convertibleEntries = pipelineEntries.filter(entry => 
    entry.status === 'lead' || entry.status === 'hot_lead' || entry.status === 'warm_lead'
  );

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
          {convertibleEntries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between p-3 bg-background rounded-lg border">
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Home className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium capitalize">
                      {entry.roof_type?.replace('_', ' ') || 'Roofing Project'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-xs">
                      {entry.status?.replace('_', ' ').toUpperCase()}
                    </Badge>
                    {entry.estimated_value && (
                      <div className="flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />
                        ${entry.estimated_value}
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(entry.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
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
                <Button size="sm" className="gradient-primary">
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Convert to Job
                </Button>
              </JobApprovalDialog>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};