import React, { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
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
import PatentRoofReport from './PatentRoofReport';
import { overlayToPatentModel } from '@/lib/measurements/overlayToPatentModel';

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
  // Preview gate is intentionally lenient: we want to show diagrams whenever
  // real geometry exists, even for needs_review / single_plane_fallback jobs.
  // Hard blocks: placeholder, solar bbox rectangles, or no geometry+no PDF at all.
  if (grj?.is_placeholder === true) return { ok: false, reason: 'Geometry is placeholder.' };
  if (grj?.geometry_source === 'google_solar_bbox')
    return { ok: false, reason: 'Geometry source is solar bbox (rectangles).' };
  if (!grj && !measurement.report_pdf_url && !measurement.ai_measurement_job_id)
    return { ok: false, reason: 'No geometry, PDF, or job to preview.' };
  return { ok: true };
}

/** Client mirror of the PDF-specific QC gate enforced by render-measurement-pdf. */
function evaluatePdfGate(measurement: any): { ok: boolean; reason?: string; warning?: string } {
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

  const warnings: string[] = [];
  if (grj.single_plane_fallback === true)
    warnings.push('Roof slopes could not be fully segmented; PDF will be marked as a footprint estimate.');
  if (typeof grj.overlay_alignment_score === 'number' && grj.overlay_alignment_score < 0.75)
    warnings.push('Overlay alignment is below the review threshold; PDF will be marked for verification.');
  return { ok: true, warning: warnings.join(' ') || undefined };
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
  const reportContentRef = useRef<HTMLDivElement | null>(null);
  const [diagrams, setDiagrams] = useState<DiagramRow[]>([]);
  const [jobId, setJobId] = useState<string | null>(explicitJobId || null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [fullMeasurement, setFullMeasurement] = useState<any | null>(null);

  const effectiveMeasurement = fullMeasurement || measurement;
  const previewGate = useMemo(() => evaluatePreviewGate(effectiveMeasurement), [effectiveMeasurement]);
  const pdfGate = useMemo(() => evaluatePdfGate(effectiveMeasurement), [effectiveMeasurement]);

  // ── PATCH 2: don't open a stale cached PDF if its signature no longer
  // matches the latest geometry_report_json (means a newer AI run
  // produced different planes/edges and the PDF must be re-rendered).
  const debugPipeline = (effectiveMeasurement as any)?.geometry_report_json?.debug_pipeline || null;
  const currentPdfSig = (effectiveMeasurement as any)?.geometry_report_json?.pdf_source_signature || null;
  const lastRenderedSig = (effectiveMeasurement as any)?.geometry_report_json?.last_rendered_pdf_signature || null;
  const pdfIsStale = Boolean(currentPdfSig && lastRenderedSig && currentPdfSig !== lastRenderedSig);
  const canOpenExistingPdf = Boolean(
    (effectiveMeasurement as any)?.report_pdf_url && pdfGate.ok && !pdfIsStale
  );
  const reportModel = useMemo(() => {
    const serverPatent = (effectiveMeasurement as any)?.patent_model
      || (effectiveMeasurement as any)?.geometry_report_json?.patent_model;
    const overlay = (effectiveMeasurement as any)?.overlay_schema
      || (effectiveMeasurement as any)?.geometry_report_json?.overlay_schema;

    return serverPatent ?? (overlay ? overlayToPatentModel(overlay, effectiveMeasurement) : null);
  }, [effectiveMeasurement]);
  const hasRenderableReport = Boolean(reportModel) || diagrams.length > 0;

  const createExportSafeClone = (page: HTMLElement) => {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-10000px';
    wrapper.style.top = '0';
    wrapper.style.width = `${page.offsetWidth || 900}px`;
    wrapper.style.background = 'hsl(var(--background))';
    wrapper.style.zIndex = '-1';

    const clone = page.cloneNode(true) as HTMLElement;
    clone.style.width = `${page.offsetWidth || 900}px`;
    clone.querySelectorAll('img[aria-hidden="true"], img.hidden').forEach((img) => img.remove());
    clone.querySelectorAll('svg image').forEach((image) => {
      const parent = image.parentElement;
      if (parent?.tagName.toLowerCase() === 'svg') {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', '0');
        rect.setAttribute('y', '0');
        rect.setAttribute('width', '100%');
        rect.setAttribute('height', '100%');
        rect.setAttribute('fill', 'hsl(var(--muted))');
        parent.insertBefore(rect, image);
      }
      image.remove();
    });

    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    return { element: clone, cleanup: () => wrapper.remove() };
  };

  const capturePageImage = async (page: HTMLElement) => {
    const captureOptions = {
      scale: 1.5,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
    } as const;

    try {
      const canvas = await html2canvas(page, captureOptions);
      return { imgData: canvas.toDataURL('image/jpeg', 0.65), width: canvas.width, height: canvas.height };
    } catch (err) {
      console.warn('Direct PDF page capture failed; retrying without cross-origin imagery:', err);
    }

    const safeClone = createExportSafeClone(page);
    try {
      const canvas = await html2canvas(safeClone.element, captureOptions);
      return { imgData: canvas.toDataURL('image/jpeg', 0.65), width: canvas.width, height: canvas.height };
    } finally {
      safeClone.cleanup();
    }
  };

  const downloadVisibleReportPdf = async () => {
    const root = reportContentRef.current;
    if (!root) throw new Error('Report preview is not ready yet.');
    const pages = Array.from(root.querySelectorAll<HTMLElement>('.measurement-report-page'));
    if (pages.length === 0) throw new Error('No report pages are available to export.');

    await document.fonts?.ready;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const usableWidth = pdfWidth - margin * 2;
    const usableHeight = pdfHeight - margin * 2;

    for (let index = 0; index < pages.length; index += 1) {
      const pageImage = await capturePageImage(pages[index]);
      const ratio = Math.min(usableWidth / pageImage.width, usableHeight / pageImage.height);
      const width = pageImage.width * ratio;
      const height = pageImage.height * ratio;
      if (index > 0) pdf.addPage();
      pdf.addImage(pageImage.imgData, 'JPEG', (pdfWidth - width) / 2, margin, width, height);
    }

    const safeAddress = (address || 'measurement-report')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'measurement-report';
    pdf.save(`${safeAddress}-measurement-report.pdf`);
  };

  useEffect(() => {
    if (!open) {
      setFullMeasurement(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        setFullMeasurement(null);
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

        const { data: roofMeasurement } = await (supabase as any)
          .from('roof_measurements')
          .select('id, ai_measurement_job_id, validation_status, requires_manual_review, facet_count, geometry_report_json, report_pdf_url, report_pdf_path, total_area_flat_sqft, total_area_adjusted_sqft, total_squares, predominant_pitch, total_ridge_length, total_hip_length, total_valley_length, total_eave_length, total_rake_length, footprint_source, detection_method, google_maps_image_url, linear_features_wkt, perimeter_wkt, target_lat, target_lng, footprint_vertices_geo, footprint_confidence, satellite_overlay_url, gps_coordinates, analysis_zoom, analysis_image_size, image_bounds, mapbox_image_url, selected_image_source, image_source, measurement_confidence, overlay_schema, patent_model')
          .eq('ai_measurement_job_id', resolvedJobId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const mergedMeasurement = roofMeasurement
          ? { ...(measurement as any), ...roofMeasurement }
          : measurement;
        if (!cancelled) setFullMeasurement(mergedMeasurement);

        if (evaluatePreviewGate(mergedMeasurement).ok) {
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
  }, [open, explicitJobId, measurement, pipelineEntryId]);

  const handleDownloadPdf = async () => {
    const existingPdfUrl = (effectiveMeasurement as any)?.report_pdf_url;
    if (existingPdfUrl && pdfGate.ok) {
      window.open(existingPdfUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!hasRenderableReport && !jobId) return;
    setDownloading(true);
    try {
      await downloadVisibleReportPdf();
      setDownloading(false);
      return;
    } catch (clientErr: any) {
      console.warn('Client PDF export failed, falling back to server render:', clientErr);
      if (!jobId || reportModel) {
        toast({
          title: 'PDF generation failed',
          description: clientErr?.message || 'The browser could not export this report.',
          variant: 'destructive',
        });
        setDownloading(false);
        return;
      }
    }

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
            disabled={!pdfGate.ok || downloading || (!canOpenExistingPdf && !hasRenderableReport && !jobId)}
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
          <div ref={reportContentRef}>
          {!previewGate.ok ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Internal review required</AlertTitle>
              <AlertDescription>
                Automated roof geometry could not be verified. This measurement has been
                routed to internal QA. ({previewGate.reason})
              </AlertDescription>
            </Alert>
          ) : loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Loading diagrams…
            </div>
          ) : (
            (() => {
              if (reportModel) {
                return (
                  <div className="space-y-6">
                    {(!pdfGate.ok || pdfGate.warning) && (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>
                          {pdfGate.warning
                            ? 'Footprint estimate'
                            : pdfGate.reason?.includes('single-plane')
                            ? 'Footprint estimate'
                            : 'Preview only'}
                        </AlertTitle>
                        <AlertDescription>
                          {pdfGate.warning
                            ? pdfGate.warning
                            : pdfGate.reason?.includes('single-plane')
                            ? 'Roof slopes could not be segmented. Showing footprint estimate.'
                            : `Preview is available, but customer PDF download is blocked. (${pdfGate.reason})`}
                        </AlertDescription>
                      </Alert>
                    )}
                    <PatentRoofReport initialModel={reportModel} address={address} />
                  </div>
                );
              }

              // Fallback: legacy SVG diagrams when no overlay is available
              if (diagrams.length === 0) {
                return (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>No diagrams available</AlertTitle>
                    <AlertDescription>
                      The roof report has not been generated for this measurement yet.
                    </AlertDescription>
                  </Alert>
                );
              }

              return (
                <div className="space-y-6">
                  {(!pdfGate.ok || pdfGate.warning) && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>
                        {pdfGate.warning
                          ? 'Footprint estimate'
                          : pdfGate.reason?.includes('single-plane')
                          ? 'Footprint estimate'
                          : 'Preview only'}
                      </AlertTitle>
                      <AlertDescription>
                        {pdfGate.warning
                          ? pdfGate.warning
                          : pdfGate.reason?.includes('single-plane')
                          ? 'Roof slopes could not be segmented. Showing footprint estimate.'
                          : `Diagram preview is available, but customer PDF download is blocked. (${pdfGate.reason})`}
                      </AlertDescription>
                    </Alert>
                  )}
                  {diagrams.map((d) => {
                    const label =
                      PAGE_LABELS[(d.page_number || 1) - 1] || d.title || d.diagram_type;
                    const normalized = (d.svg_markup || '').replace(
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
                    );
                    const safeSvg = DOMPurify.sanitize(normalized, {
                      USE_PROFILES: { svg: true, svgFilters: true },
                    });
                    return (
                      <div key={d.id} className="measurement-report-page border rounded-lg overflow-hidden bg-background">
                        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                          <div className="font-semibold text-sm">
                            {d.page_number}. {label}
                          </div>
                          <Badge variant="secondary">{d.diagram_type}</Badge>
                        </div>
                        <div
                          className="w-full bg-white p-2 [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-h-[80vh] [&_svg]:block"
                          dangerouslySetInnerHTML={{ __html: safeSvg }}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })()
          )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default MeasurementReportDialog;
