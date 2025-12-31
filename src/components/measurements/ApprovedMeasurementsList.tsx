import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  CheckCircle2, FileText, Download, Calendar, User, 
  Ruler, Home, ExternalLink, Loader2
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
        <CardTitle className="text-lg flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          Approved Measurements
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className={approvals.length > 3 ? 'h-[300px]' : undefined}>
          <div className="space-y-3">
            {approvals.map((approval) => {
              const tags = approval.saved_tags || {};
              const squares = tags['roof.squares'] || tags['roof.plan_area'] 
                ? ((tags['roof.plan_area'] || 0) / 100).toFixed(1) 
                : null;
              const pitch = tags['roof.predominant_pitch'] || tags['roof.pitch'];
              const facets = tags['roof.faces_count'];

              return (
                <div
                  key={approval.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900"
                >
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
