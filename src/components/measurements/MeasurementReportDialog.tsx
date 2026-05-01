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

import { AlertTriangle, Download, Loader2, Ruler, TriangleIcon, Square, Activity } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import PatentRoofReport from './PatentRoofReport';
import RasterOverlayDebugView from './RasterOverlayDebugView';

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
  if (grj.block_customer_report_reason) {
    return { ok: false, reason: String(grj.block_customer_report_reason) };
  }
  if (grj.is_placeholder === true) return { ok: false, reason: 'Geometry is placeholder.' };
  if (grj.geometry_source === 'google_solar_bbox')
    return { ok: false, reason: 'Geometry source is solar bbox (rectangles).' };
  const cal = grj.overlay_calibration;
  if (cal?.calibrated !== true) return { ok: false, reason: 'overlay_alignment_failed' };
  if (cal?.calibrated) {
    if (Number(cal.coverage_ratio_width) < 0.65 || Number(cal.coverage_ratio_height) < 0.65)
      return { ok: false, reason: 'overlay_alignment_failed' };
    if (Number(cal.center_error_px) > 80)
      return { ok: false, reason: 'overlay_alignment_failed' };
  }

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
  const exportImageCacheRef = useRef<Map<string, string>>(new Map());
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
    return serverPatent ?? null;
  }, [effectiveMeasurement]);
  const persistedPlaneCount = Number(
    (reportModel as any)?.plane_count
      ?? (reportModel as any)?.facet_count
      ?? (Array.isArray((reportModel as any)?.planes) ? (reportModel as any).planes.length : 0),
  );
  const renderedPlaneCount = Array.isArray((reportModel as any)?.planes)
    ? (reportModel as any).planes.length
    : 0;
  const renderedPlaneLabels = Array.isArray((reportModel as any)?.planes)
    ? new Set((reportModel as any).planes.map((p: any) => String(p.label ?? p.id ?? 'A'))).size
    : 0;
  const reportCollapsed = Boolean(
    reportModel && persistedPlaneCount > 1 && (renderedPlaneCount <= 1 || renderedPlaneLabels <= 1),
  );
  const hasRasterOverlayRenderable = (() => {
    const grj = (effectiveMeasurement as any)?.geometry_report_json || {};
    const rasterUrl =
      (effectiveMeasurement as any)?.satellite_overlay_url ||
      (effectiveMeasurement as any)?.google_maps_image_url ||
      (effectiveMeasurement as any)?.mapbox_image_url ||
      grj?.raster_image_url || null;
    const rasterSize = grj?.raster_size || (effectiveMeasurement as any)?.analysis_image_size || null;
    const planesPx = Array.isArray(grj?.planes_px) ? grj.planes_px : [];
    const edgesPx = Array.isArray(grj?.edges_px) ? grj.edges_px : [];
    return Boolean(rasterUrl && rasterSize && (planesPx.length > 0 || edgesPx.length > 0));
  })();
  const hasRenderableReport = Boolean(reportModel) || diagrams.length > 0 || hasRasterOverlayRenderable;

  type PdfExportProfile = {
    scale: number;
    jpegQuality: number;
  };

  const PDF_MAX_BYTES = 9.5 * 1024 * 1024;
  const PDF_EXPORT_PROFILES: PdfExportProfile[] = [
    { scale: 2.5, jpegQuality: 0.95 },
    { scale: 2, jpegQuality: 0.9 },
    { scale: 1.5, jpegQuality: 0.65 },
  ];

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...Array.from(chunk));
    }
    return btoa(binary);
  };

  const imageUrlToDataUrl = async (url: string): Promise<string> => {
    if (!url || url.startsWith('data:')) return url;
    const cached = exportImageCacheRef.current.get(url);
    if (cached) return cached;
    const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
    const contentType = response.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) throw new Error(`Expected image, got ${contentType}`);
    const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(await response.arrayBuffer())}`;
    exportImageCacheRef.current.set(url, dataUrl);
    return dataUrl;
  };

  const replaceSvgImagesForExport = async (source: HTMLElement, clone: HTMLElement, profile: PdfExportProfile) => {
    const sourceImages = Array.from(source.querySelectorAll<SVGImageElement>('svg image'));
    const cloneImages = Array.from(clone.querySelectorAll<SVGImageElement>('svg image'));
    await Promise.all(cloneImages.map(async (image, index) => {
      const sourceImage = sourceImages[index] || image;
      const href = sourceImage.getAttribute('href') || sourceImage.getAttribute('xlink:href');
      if (!href) return;
      const dataUrl = await imageUrlToDataUrl(href);
      image.setAttribute('href', dataUrl);
      image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUrl);
      image.style.imageRendering = 'auto';
      const width = Number(image.getAttribute('width') || 0);
      const height = Number(image.getAttribute('height') || 0);
      if (width > 0 && height > 0 && profile.scale >= 2) {
        image.setAttribute('width', String(width));
        image.setAttribute('height', String(height));
      }
    }));
  };

  const createExportReadyClone = async (page: HTMLElement, profile: PdfExportProfile) => {
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

    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    await replaceSvgImagesForExport(page, clone, profile);
    return { element: clone, cleanup: () => wrapper.remove() };
  };

  const capturePageImage = async (page: HTMLElement, profile: PdfExportProfile) => {
    const captureOptions = {
      scale: profile.scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      imageTimeout: 30000,
      logging: false,
    } as const;

    const exportClone = await createExportReadyClone(page, profile);
    try {
      await Promise.all(Array.from(exportClone.element.querySelectorAll('img')).map((img) => (
        img.complete ? Promise.resolve() : new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        })
      )));
      const canvas = await html2canvas(exportClone.element, {
        ...captureOptions,
        windowWidth: exportClone.element.scrollWidth,
        windowHeight: exportClone.element.scrollHeight,
      });
      return { imgData: canvas.toDataURL('image/jpeg', profile.jpegQuality), width: canvas.width, height: canvas.height };
    } catch (err) {
      console.warn('Export-ready PDF page capture failed; retrying direct capture:', err);
    } finally {
      exportClone.cleanup();
    }

    const canvas = await html2canvas(page, captureOptions);
    return { imgData: canvas.toDataURL('image/jpeg', profile.jpegQuality), width: canvas.width, height: canvas.height };
  };

  const downloadVisibleReportPdf = async () => {
    const root = reportContentRef.current;
    if (!root) throw new Error('Report preview is not ready yet.');
    const pages = Array.from(root.querySelectorAll<HTMLElement>('.measurement-report-page'));
    if (pages.length === 0) throw new Error('No report pages are available to export.');

    await document.fonts?.ready;
    let pdf: jsPDF | null = null;
    for (const profile of PDF_EXPORT_PROFILES) {
      const candidate = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
      const pdfWidth = candidate.internal.pageSize.getWidth();
      const pdfHeight = candidate.internal.pageSize.getHeight();
      const margin = 24;
      const usableWidth = pdfWidth - margin * 2;
      const usableHeight = pdfHeight - margin * 2;

      for (let index = 0; index < pages.length; index += 1) {
        const pageImage = await capturePageImage(pages[index], profile);
        const ratio = Math.min(usableWidth / pageImage.width, usableHeight / pageImage.height);
        const width = pageImage.width * ratio;
        const height = pageImage.height * ratio;
        if (index > 0) candidate.addPage();
        candidate.addImage(pageImage.imgData, 'JPEG', (pdfWidth - width) / 2, margin, width, height);
      }

      const size = candidate.output('blob').size;
      pdf = candidate;
      if (size <= PDF_MAX_BYTES || profile === PDF_EXPORT_PROFILES[PDF_EXPORT_PROFILES.length - 1]) break;
    }

    const safeAddress = (address || 'measurement-report')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'measurement-report';
    pdf?.save(`${safeAddress}-measurement-report.pdf`);
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
    if (!hasRenderableReport && !jobId) return;
    setDownloading(true);

    // ALWAYS prefer capturing the visible report — it is the source of truth
    // the user sees on screen (raster overlay + patent model + diagrams).
    // The cached server `report_pdf_url` is often stale and shows entirely
    // different visuals (legacy patent line drawings) than the current
    // dialog. Only fall back to the cached/server PDF when client capture
    // genuinely cannot produce anything (no DOM pages at all).
    if (hasRenderableReport) {
      try {
        await downloadVisibleReportPdf();
        toast({
          title: pdfGate.ok ? 'Report downloaded' : 'Diagnostic report downloaded',
          description: pdfGate.ok
            ? 'The measurement report PDF is ready.'
            : 'This PDF is marked preview-only and includes QA failure details for troubleshooting.',
        });
        setDownloading(false);
        return;
      } catch (clientErr: any) {
        console.warn('Client PDF export failed, attempting server fallback:', clientErr);
      }
    }

    // Server fallback path: existing cached PDF first, then re-render.
    const existingPdfUrl = (effectiveMeasurement as any)?.report_pdf_url;
    if (existingPdfUrl && pdfGate.ok && !pdfIsStale) {
      window.open(existingPdfUrl, '_blank', 'noopener,noreferrer');
      setDownloading(false);
      return;
    }
    if (!jobId) {
      toast({
        title: 'PDF generation failed',
        description: 'The browser could not export this report and no server job is available.',
        variant: 'destructive',
      });
      setDownloading(false);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('render-measurement-pdf', {
        body: { ai_measurement_job_id: jobId },
      });

      // supabase.functions.invoke treats any non-2xx as `error`. Our QC gate
      // returns 422 with a structured body — read it before falling through
      // to a generic failure toast.
      let payload: any = data;
      if (error && (error as any)?.context?.json) {
        try { payload = await (error as any).context.json(); } catch { /* noop */ }
      } else if (error && (error as any)?.context?.body) {
        try {
          const txt = await (error as any).context.text?.();
          payload = txt ? JSON.parse(txt) : null;
        } catch { /* noop */ }
      }

      const errCode = (payload as any)?.error;
      if (errCode === 'manual_measurement_required' || errCode === 'internal_review_required') {
        toast({
          title: 'Internal review required',
          description: (payload as any)?.reason || 'Automated roof geometry could not be verified.',
          variant: 'destructive',
        });
        return;
      }
      if (errCode === 'no_diagrams') {
        toast({
          title: 'No diagrams available',
          description: 'No roof diagrams were generated for this job. Re-run the AI measurement.',
          variant: 'destructive',
        });
        return;
      }
      if (error) throw error;

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
            {(effectiveMeasurement as any)?.geometry_report_json?.block_customer_report_reason && (
              <p className="mt-1 text-xs font-medium text-destructive">
                Diagnostic export only — not customer-ready.
              </p>
            )}
            {address && (
              <p className="text-sm text-muted-foreground mt-1">{address}</p>
            )}
            {(() => {
              const grj = (effectiveMeasurement as any)?.geometry_report_json || {};
              const footprintSource =
                (effectiveMeasurement as any)?.footprint_source ?? grj.footprint_source ?? 'unknown';
              const inferenceSource =
                (effectiveMeasurement as any)?.inference_source ?? grj.inference_source ?? 'unknown';
              const topologySource = grj.topology_source ?? grj.geometry_source ?? 'unknown';
              const usedDeterministic = grj.used_deterministic_topology === true;
              const blocked = grj.block_customer_report_reason || null;
              return (
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono text-muted-foreground">
                  <span
                    className={`px-1.5 py-0.5 rounded ${
                      usedDeterministic ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted'
                    }`}
                    title="Topology engine that produced ridges/hips/valleys"
                  >
                    topology: {String(topologySource)}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-muted" title="Building footprint provider">
                    footprint: {String(footprintSource)}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-muted" title="Inference source for plane detection">
                    inference: {String(inferenceSource)}
                  </span>
                  {debugPipeline && (
                    <>
                      <span className="px-1.5 py-0.5 rounded bg-muted">
                        planes: {String(debugPipeline.final_plane_count_saved ?? 0)}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-muted">
                        edges: {String(debugPipeline.final_edge_count_saved ?? 0)}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-muted">
                        patent_planes: {String(debugPipeline.final_patent_model_plane_count ?? 0)}
                      </span>
                      {debugPipeline.ridge_split_recursive_entered && (
                        <span className="px-1.5 py-0.5 rounded bg-muted">
                          rsr: {String(debugPipeline.ridge_split_recursive_plane_count ?? 0)}p/
                          {String(debugPipeline.ridge_split_recursive_edge_count ?? 0)}e
                        </span>
                      )}
                    </>
                  )}
                  {blocked && (
                    <span className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground">
                      blocked: {String(blocked)}
                    </span>
                  )}
                  {pdfIsStale && (
                    <span className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground">
                      PDF stale — will regenerate
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
          {(() => {
            const needsReview =
              measurement?.validation_status === 'needs_internal_review' ||
              measurement?.validation_status === 'needs_manual_measurement' ||
              Boolean((effectiveMeasurement as any)?.geometry_report_json?.block_customer_report_reason);
            const canDownloadDiagnostic = hasRenderableReport || canOpenExistingPdf || Boolean(jobId && pdfGate.ok);
            return (
              <Button
                size="sm"
                variant={needsReview ? 'destructive' : 'default'}
                onClick={handleDownloadPdf}
                disabled={downloading || !canDownloadDiagnostic}
                title={needsReview ? 'Download a preview-only diagnostic PDF for analysis. Customer-ready PDF remains blocked.' : undefined}
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : needsReview ? (
                  <AlertTriangle className="h-4 w-4 mr-2" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                {needsReview ? 'Download Diagnostic PDF' : 'Download PDF'}
              </Button>
            );
          })()}
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
              const grj = (effectiveMeasurement as any)?.geometry_report_json || {};
              const rasterUrl =
                (effectiveMeasurement as any)?.satellite_overlay_url ||
                (effectiveMeasurement as any)?.google_maps_image_url ||
                (effectiveMeasurement as any)?.mapbox_image_url ||
                grj?.raster_image_url || null;
              const rasterSize = grj?.raster_size || (effectiveMeasurement as any)?.analysis_image_size || null;
              const planes_px = Array.isArray(grj?.planes_px) ? grj.planes_px : [];
              const edges_px = Array.isArray(grj?.edges_px) ? grj.edges_px : [];
              const hasRasterOverlay =
                Boolean(rasterUrl) && Boolean(rasterSize) && (planes_px.length > 0 || edges_px.length > 0);
              const showDebugOverlay = hasRasterOverlay;

              const debugOverlay = showDebugOverlay ? (
                <div className="measurement-report-page border rounded-lg overflow-hidden bg-background">
                  <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                    <div className="font-semibold text-sm">Roof Overlay</div>
                    <Badge variant="secondary">preliminary</Badge>
                  </div>
                  <div className="p-2 bg-white">
                    <RasterOverlayDebugView
                      imageUrl={rasterUrl}
                      rasterSize={rasterSize}
                      planes_px={planes_px}
                      edges_px={edges_px}
                      overlayCalibration={grj?.overlay_calibration || null}
                      roofTargetBboxPx={grj?.roof_target_bbox_px || grj?.debug_geometry?.solar_bbox_px || null}
                      geometryPxSpace={grj?.geometry_px_space || null}
                    />
                  </div>
                </div>
              ) : null;

              if (reportCollapsed) {
                return (
                  <div className="space-y-6">
                    {debugOverlay}
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Report model collapse detected</AlertTitle>
                      <AlertDescription>
                        BUG: persisted patent_model has multiple planes but report UI collapsed it.
                      </AlertDescription>
                    </Alert>
                  </div>
                );
              }

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
                            : `Customer-ready PDF is blocked, but this diagnostic preview can be downloaded for analysis. (${pdfGate.reason})`}
                        </AlertDescription>
                      </Alert>
                    )}
                    {debugOverlay}
                    <PatentRoofReport initialModel={reportModel} address={address} />
                  </div>
                );
              }

              // Fallback: legacy SVG diagrams when no overlay is available
              if (diagrams.length === 0) {
                return (
                  <div className="space-y-6">
                    {debugOverlay}
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>No diagrams available</AlertTitle>
                      <AlertDescription>
                        The roof report has not been generated for this measurement yet.
                      </AlertDescription>
                    </Alert>
                  </div>
                );
              }

              return (
                <div className="space-y-6">
                  {debugOverlay}
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
                            : `Customer-ready PDF is blocked, but this diagnostic preview can be downloaded for analysis. (${pdfGate.reason})`}
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
