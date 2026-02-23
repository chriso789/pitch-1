import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Download, Loader2, FileText } from 'lucide-react';
import { useInspectionReportPDF } from './useInspectionReportPDF';
import { format } from 'date-fns';

interface InspectionHistoryProps {
  leadId: string;
  propertyAddress?: string;
}

export function InspectionHistory({ leadId, propertyAddress }: InspectionHistoryProps) {
  const { downloadReport, generating } = useInspectionReportPDF();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data: inspections, isLoading } = useQuery({
    queryKey: ['inspections', leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const normalizeSteps = (raw: any[]): any[] =>
    raw.map((s: any) => ({
      ...s,
      photoUrls: s.photoUrls || (s.photoUrl ? [s.photoUrl] : []),
    }));

  const handleDownload = async (inspection: any) => {
    setDownloadingId(inspection.id);
    const stepsData = normalizeSteps((inspection.steps_data || []) as any[]);
    await downloadReport(
      {
        stepsData,
        propertyAddress,
        inspectionDate: format(new Date(inspection.created_at), 'MMM d, yyyy'),
        status: inspection.status === 'completed' ? 'Completed' : 'In Progress',
      },
      `inspection-${format(new Date(inspection.created_at), 'yyyy-MM-dd')}.pdf`
    );
    setDownloadingId(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading history...
      </div>
    );
  }

  if (!inspections?.length) return null;

  return (
    <div className="space-y-2">
      <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Past Inspections</h5>
      {inspections.map((insp) => {
        const stepsData = normalizeSteps((insp.steps_data || []) as any[]);
        const photoCount = stepsData.filter((s: any) => s.photoUrls?.length > 0).length;
        const isDownloading = downloadingId === insp.id && generating;

        return (
          <div
            key={insp.id}
            className="flex items-center justify-between p-2 rounded-md border bg-card"
          >
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium">
                  {format(new Date(insp.created_at), 'MMM d, yyyy h:mm a')}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {photoCount} photos • {insp.status}
                </p>
              </div>
            </div>
            {insp.status === 'completed' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDownload(insp)}
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
