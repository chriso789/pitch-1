import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface MeasurementReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  measurement: any;
  tags?: Record<string, any>;
  address?: string;
  pipelineEntryId?: string;
  tenantId?: string;
  aiMeasurementJobId?: string | null;
  onMeasurementUpdate?: (measurement: any, tags: any) => void;
}

interface DiagramRow {
  id: string;
  diagram_type: string;
  title: string;
  page_number: number | null;
  svg_markup: string | null;
}

const PAGE_LABELS = [
  'Cover',
  'Image / Overlay',
  'Length Diagram',
  'Pitch Diagram',
  'Area Diagram',
  'Notes Diagram',
];

function evaluatePreviewGate(measurement: any): { ok: boolean; reason?: string } {
  if (!measurement) return { ok: false, reason: 'No measurement record.' };
  const grj = measurement.geometry_report_json;
  if (
    measurement.validation_status === 'needs_internal_review' ||
    measurement.validation_status === 'needs_manual_measurement' // legacy
  )
    return { ok: false, reason: 'Job flagged needs_internal_review.' };
  if (!measurement.facet_count || measurement.facet_count <= 0)
    return { ok: false, reason: 'No roof facets recorded.' };
  if (!grj) return measurement.report_pdf_url ? { ok: true } : { ok: false, reason: 'geometry_report_json missing.' };
  if (grj.is_placeholder === true) return { ok: false, reason: 'Geometry is placeholder.' };
  if (grj.geometry_source === 'google_solar_bbox')
    return { ok: false, reason: 'Geometry source is solar bbox (rectangles).' };
  if (typeof grj.overlay_alignment_score === 'number' && grj.overlay_alignment_score < 0.75)
    return { ok: false, reason: 'overlay_alignment_score below 0.75.' };
  return { ok: true };
}

/** Client mirror of the PDF-specific QC gate enforced by render-measurement-pdf. */
function evaluatePdfGate(measurement: any): { ok: boolean; reason?: string } {
  if (!measurement) return { ok: false, reason: 'No measurement record.' };
  const grj = measurement.geometry_report_json;
  if (
    measurement.validation_status === 'needs_internal_review' ||
    measurement.validation_status === 'needs_manual_measurement'
  ) return { ok: false, reason: 'Job flagged needs_internal_review.' };
  if (!measurement.facet_count || measurement.facet_count <= 0)
    return { ok: false, reason: 'No roof facets recorded.' };
  if (!grj) return { ok: false, reason: 'geometry_report_json missing.' };
  if (grj.is_placeholder === true) return { ok: false, reason: 'Geometry is placeholder.' };
  if (grj.geometry_source === 'google_solar_bbox')
    return { ok: false, reason: 'Geometry source is solar bbox (rectangles).' };
  if (grj.single_plane_fallback === true)
    return { ok: false, reason: 'Preview-only single-plane fallback.' };
  if (typeof grj.overlay_alignment_score === 'number' && grj.overlay_alignment_score < 0.75)
    return { ok: false, reason: 'overlay_alignment_score below 0.75.' };
  return { ok: true };
}

const MeasurementReportDialog: React.FC<MeasurementReportDialogProps> = ({
  open,
  onOpenChange,
  measurement,
  address,
  pipelineEntryId,
  aiMeasurementJobId: explicitJobId,
}) => {
  const { toast } = useToast();
  const [diagrams, setDiagrams] = useState<DiagramRow[]>([]);
  const [jobId, setJobId] = useState<string | null>(explicitJobId || null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const previewGate = useMemo(() => evaluatePreviewGate(measurement), [measurement]);
  const pdfGate = useMemo(() => evaluatePdfGate(measurement), [measurement]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        let resolvedJobId = explicitJobId || (measurement as any)?.ai_measurement_job_id || null;
        if (!resolvedJobId && pipelineEntryId) {
          const { data } = await (supabase as any)
            .from('ai_measurement_jobs')
            .select('id')
            .eq('lead_id', pipelineEntryId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          resolvedJobId = data?.id || null;
        }
        if (!resolvedJobId) {
          if (!cancelled) {
            setJobId(null);
            setDiagrams([]);
          }
          return;
        }
        if (!cancelled) setJobId(resolvedJobId);

        if (qc.ok) {
          const { data, error } = await (supabase as any)
            .from('ai_measurement_diagrams')
            .select('id, diagram_type, title, page_number, svg_markup')
            .eq('ai_measurement_job_id', resolvedJobId)
            .order('page_number', { ascending: true });
          if (!error && !cancelled) setDiagrams(data || []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, explicitJobId, measurement, pipelineEntryId, qc.ok]);

  const handleDownloadPdf = async () => {
    if (!jobId) return;
    setDownloading(true);
    try {
      const { data, error } = await supabase.functions.invoke('render-measurement-pdf', {
        body: { ai_measurement_job_id: jobId },
      });
      if (error) throw error;
      if ((data as any)?.error === 'manual_measurement_required' || (data as any)?.error === 'internal_review_required') {
        toast({
          title: 'Internal review required',
          description: 'Automated roof geometry could not be verified.',
          variant: 'destructive',
        });
        return;
      }
      const url = (data as any)?.pdf_url;
      if (!url) throw new Error('No PDF URL returned.');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      toast({
        title: 'PDF generation failed',
        description: err?.message || 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] p-0">
        <DialogHeader className="px-6 pt-6 pb-4 flex flex-row items-center justify-between">
          <div>
            <DialogTitle>Measurement Report</DialogTitle>
            {address && (
              <p className="text-sm text-muted-foreground mt-1">{address}</p>
            )}
          </div>
          <Button
            size="sm"
            onClick={handleDownloadPdf}
            disabled={!qc.ok || !jobId || downloading || diagrams.length === 0}
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download PDF
          </Button>
        </DialogHeader>

        <ScrollArea className="h-[calc(90vh-100px)] px-6 pb-6">
          {!qc.ok ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Internal review required</AlertTitle>
              <AlertDescription>
                Automated roof geometry could not be verified. This measurement has been
                routed to internal QA. ({qc.reason})
              </AlertDescription>
            </Alert>
          ) : loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Loading diagrams…
            </div>
          ) : diagrams.length === 0 ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>No diagrams available</AlertTitle>
              <AlertDescription>
                The 6-page report has not been generated for this measurement yet.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-6">
              {diagrams.map((d) => {
                const label =
                  PAGE_LABELS[(d.page_number || 1) - 1] || d.title || d.diagram_type;
                return (
                  <div key={d.id} className="border rounded-lg overflow-hidden bg-background">
                    <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                      <div className="font-semibold text-sm">
                        {d.page_number}. {label}
                      </div>
                      <Badge variant="secondary">{d.diagram_type}</Badge>
                    </div>
                    <div
                      className="w-full bg-white p-2 [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-h-[80vh] [&_svg]:block"
                      dangerouslySetInnerHTML={{
                        __html: (d.svg_markup || '').replace(
                          /<svg([^>]*)>/i,
                          (_m, attrs) => {
                            let a = attrs as string;
                            const hasViewBox = /viewBox=/.test(a);
                            const w = a.match(/\bwidth="(\d+(?:\.\d+)?)"/);
                            const h = a.match(/\bheight="(\d+(?:\.\d+)?)"/);
                            if (!hasViewBox && w && h) {
                              a += ` viewBox="0 0 ${w[1]} ${h[1]}"`;
                            }
                            a = a.replace(/\s(width|height)="[^"]*"/g, '');
                            if (!/preserveAspectRatio=/.test(a)) {
                              a += ' preserveAspectRatio="xMidYMid meet"';
                            }
                            return `<svg${a}>`;
                          },
                        ),
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default MeasurementReportDialog;
