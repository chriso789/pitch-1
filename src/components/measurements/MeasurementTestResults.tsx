import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CheckCircle2, AlertTriangle, Clock, MapPin, Layers, ChevronDown, Bug, ArrowUpRight, ArrowDownRight, Minus, FileText, Loader2, Image as ImageIcon } from 'lucide-react';
import { useState, useEffect } from 'react';
import { ImageQualityBadge } from './ImageQualityBadge';
import { MeasurementComparisonTool } from './MeasurementComparisonTool';
import MeasurementReportDialog from './MeasurementReportDialog';
import { SchematicRoofDiagram } from './SchematicRoofDiagram';
import { VisionTracePanel } from './VisionTracePanel';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface TestResult {
  measurementId: string;
  canonicalJobId?: string;
  aiMeasurementJobId?: string;
  resultState?: string;
  hardFailReason?: string | null;
  blockCustomerReportReason?: string | null;
  validationStatus?: string | null;
  customerReportReady?: boolean;
  timing: { totalMs: number };
  data: {
    address: string;
    coordinates: { lat: number; lng: number };
    measurements: {
      totalAreaSqft: number;
      totalSquares: number;
      predominantPitch: string;
      linear: {
        ridge?: number;
        hip?: number;
        valley?: number;
        eave?: number;
        rake?: number;
      };
    };
    aiAnalysis: {
      roofType: string;
      complexity: string;
      facetCount: number;
      vertexDetection?: {
        perimeterVertices: number;
        interiorJunctions: number;
        derivedLines: number;
      };
      footprintValidation?: {
        isValid: boolean;
        spanXPct: number;
        spanYPct: number;
        estimatedPerimeterFt: number;
      };
    };
    confidence: {
      score: number;
      factors: string[];
    };
    solarApiData: {
      available: boolean;
      buildingFootprint: number;
    };
    images: {
      selected: string;
    };
    footprint?: {
      source?: string;
      requiresReview?: boolean;
    };
  };
  qualityAssessment?: {
    shadow_risk: 'low' | 'medium' | 'high';
    image_quality_score: number;
    factors: string[];
    brightness_score?: number;
    contrast_score?: number;
    shadow_coverage_pct?: number;
  };
}

interface MeasurementTestResultsProps {
  result: TestResult;
  previousResults?: TestResult[];
}

const getMeasurementSatelliteUrl = (measurement: any): string | undefined => {
  const selectedSource = (measurement?.selected_image_source || measurement?.image_source || '').toLowerCase();
  if (selectedSource.includes('mapbox') && measurement?.mapbox_image_url) return measurement.mapbox_image_url;
  if (selectedSource.includes('google') && measurement?.google_maps_image_url) return measurement.google_maps_image_url;
  return measurement?.satellite_overlay_url || measurement?.google_maps_image_url || measurement?.mapbox_image_url || undefined;
};

export function MeasurementTestResults({ result, previousResults = [] }: MeasurementTestResultsProps) {
  const [showDebug, setShowDebug] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportMeasurement, setReportMeasurement] = useState<any | null>(null);
  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [inlineMeasurement, setInlineMeasurement] = useState<any | null>(null);
  const [inlineLoading, setInlineLoading] = useState(Boolean(result.measurementId));
  const { toast } = useToast();

  // Auto-load the persisted roof_measurements row so we can render the
  // aerial + roof tracing inline the moment the test completes.
  useEffect(() => {
    let cancelled = false;
    async function loadInline() {
      if (!result.measurementId) return;
      setInlineLoading(true);
      try {
        const { data } = await supabase
          .from('roof_measurements')
          .select('*')
          .eq('id', result.measurementId)
          .maybeSingle();
        if (!cancelled) setInlineMeasurement(data ?? null);
      } finally {
        if (!cancelled) setInlineLoading(false);
      }
    }
    loadInline();
    return () => { cancelled = true; };
  }, [result.measurementId]);

  const openFullReport = async () => {
    if (!result.measurementId) return;
    setReportLoading(true);
    try {
      // Load canonical roof_measurements row with all geometry buildouts
      const { data: rm, error: rmErr } = await supabase
        .from('roof_measurements')
        .select('*')
        .eq('id', result.measurementId)
        .maybeSingle();
      if (rmErr) throw rmErr;

      const resolvedJobId = result.aiMeasurementJobId ?? rm?.ai_measurement_job_id ?? null;

      setReportMeasurement(rm);
      setReportJobId(resolvedJobId);
      setReportOpen(true);
    } catch (e: any) {
      toast({
        title: 'Could not load full report',
        description: e?.message || String(e),
        variant: 'destructive',
      });
    } finally {
      setReportLoading(false);
    }
  };


  const { data, timing, qualityAssessment } = result;
  const measurements = data?.measurements;
  const responseFootprintSource = data?.footprint?.source;
  const resultState = inlineMeasurement?.result_state ?? result.resultState ?? 'unknown';
  const failureReason = inlineMeasurement?.hard_fail_reason
    ?? inlineMeasurement?.block_customer_report_reason
    ?? result.hardFailReason
    ?? result.blockCustomerReportReason
    ?? inlineMeasurement?.last_failure_reason
    ?? null;
  const isCustomerReady = inlineMeasurement
    ? inlineMeasurement.customer_report_ready === true || resultState === 'customer_report_ready'
    : result.customerReportReady === true || resultState === 'customer_report_ready';
  const isPerimeterOnly = resultState === 'perimeter_only';
  const isBlockedResult = !isCustomerReady;
  const hasUsableArea = isCustomerReady && Number(measurements?.totalAreaSqft) > 0;
  const diagnosticBboxTrace = (
    inlineMeasurement?.footprint_source === 'solar_bbox_fallback' ||
    responseFootprintSource === 'solar_bbox_fallback'
  ) && inlineMeasurement?.result_state !== 'customer_report_ready';
  const displayedLinear = diagnosticBboxTrace ? null : measurements?.linear;
  const analysis = data?.aiAnalysis;
  const confidence = data?.confidence;
  const solarApi = data?.solarApiData;
  const traceLat = Number(inlineMeasurement?.target_lat ?? inlineMeasurement?.gps_coordinates?.lat ?? data?.coordinates?.lat);
  const traceLng = Number(inlineMeasurement?.target_lng ?? inlineMeasurement?.gps_coordinates?.lng ?? data?.coordinates?.lng);
  const traceZoom = 0; // 0 = let vision-trace-roof auto-pick zoom from Solar bbox

  // Calculate variance with Solar API
  const solarVariance = solarApi?.available && solarApi.buildingFootprint && measurements?.totalAreaSqft
    ? ((measurements.totalAreaSqft - solarApi.buildingFootprint) / solarApi.buildingFootprint) * 100
    : null;

  const getVarianceIndicator = (variance: number | null) => {
    if (variance === null) return null;
    if (Math.abs(variance) < 5) return { icon: Minus, className: 'text-muted-foreground', label: 'Within tolerance' };
    if (variance > 0) return { icon: ArrowUpRight, className: 'text-amber-600', label: 'Over' };
    return { icon: ArrowDownRight, className: 'text-blue-600', label: 'Under' };
  };

  const varianceIndicator = getVarianceIndicator(solarVariance);

  return (
    <div className="space-y-4">
      {/* Main Results Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {isCustomerReady ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                )}
                {isCustomerReady ? 'Measurement Complete' : isPerimeterOnly ? 'Aerial Perimeter Needs Review' : 'Measurement Blocked'}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {data?.address || 'Unknown address'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {qualityAssessment && (
                <ImageQualityBadge
                  shadowRisk={qualityAssessment.shadow_risk}
                  qualityScore={qualityAssessment.image_quality_score}
                  factors={qualityAssessment.factors}
                />
              )}
              <Badge variant="outline" className="text-xs">
                {resultState}
              </Badge>
              <Badge variant="outline" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                {timing?.totalMs}ms
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isBlockedResult && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <div className="font-medium">This run did not produce a customer-ready measurement report.</div>
              <div className="mt-1 text-xs">
                {failureReason || 'The pipeline saved a diagnostic row for review, but the verified geometry gates did not pass.'}
              </div>
            </div>
          )}

          {/* Key Metrics */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold tabular-nums">
                {hasUsableArea ? measurements?.totalAreaSqft?.toLocaleString() : '—'}
              </div>
              <div className="text-xs text-muted-foreground">Total Area (sqft)</div>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold tabular-nums">
                {hasUsableArea && Number(measurements?.totalSquares) > 0 ? measurements?.totalSquares?.toFixed(1) : '—'}
              </div>
              <div className="text-xs text-muted-foreground">Squares</div>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold tabular-nums">
                {isCustomerReady && measurements?.predominantPitch && measurements.predominantPitch !== 'unknown' ? measurements.predominantPitch : '—'}
              </div>
              <div className="text-xs text-muted-foreground">Pitch</div>
            </div>
          </div>

          {/* Solar API Comparison */}
          {solarApi?.available && (
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
              <div className="text-sm">
                <span className="text-muted-foreground">Solar API Footprint:</span>{' '}
                <span className="font-medium">{solarApi.buildingFootprint?.toLocaleString()} sqft</span>
              </div>
              {solarVariance !== null && varianceIndicator && (
                <Badge 
                  variant="secondary" 
                  className={cn('gap-1', varianceIndicator.className)}
                >
                  <varianceIndicator.icon className="h-3 w-3" />
                  {solarVariance > 0 ? '+' : ''}{solarVariance.toFixed(1)}%
                </Badge>
              )}
            </div>
          )}

          {/* Linear Measurements */}
          {measurements?.linear && isCustomerReady && (
            <div className="grid grid-cols-5 gap-2 text-center text-sm">
              <div className="p-2 bg-background rounded border">
                <div className="font-medium tabular-nums">{displayedLinear?.ridge?.toFixed(0) || '—'}</div>
                <div className="text-xs text-muted-foreground">Ridge</div>
              </div>
              <div className="p-2 bg-background rounded border">
                <div className="font-medium tabular-nums">{displayedLinear?.hip?.toFixed(0) || '—'}</div>
                <div className="text-xs text-muted-foreground">Hip</div>
              </div>
              <div className="p-2 bg-background rounded border">
                <div className="font-medium tabular-nums">{displayedLinear?.valley?.toFixed(0) || '—'}</div>
                <div className="text-xs text-muted-foreground">Valley</div>
              </div>
              <div className="p-2 bg-background rounded border">
                <div className="font-medium tabular-nums">{displayedLinear?.eave?.toFixed(0) || '—'}</div>
                <div className="text-xs text-muted-foreground">Eave</div>
              </div>
              <div className="p-2 bg-background rounded border">
                <div className="font-medium tabular-nums">{displayedLinear?.rake?.toFixed(0) || '—'}</div>
                <div className="text-xs text-muted-foreground">Rake</div>
              </div>
            </div>
          )}
          {measurements?.linear && !isCustomerReady && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Ridge/hip/valley/eave/rake totals are hidden because this run is not customer-report-ready.
            </div>
          )}
          {diagnosticBboxTrace && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              The last run only produced a Solar rectangle, so ridge/hip/valley/eave/rake measurements are hidden until the full AI trace produces verified roof lines.
            </div>
          )}

          {/* Analysis Summary */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              <Layers className="h-3 w-3 mr-1" />
              {analysis?.roofType || 'Unknown'} roof
            </Badge>
            <Badge variant="secondary">
              {analysis?.facetCount || 0} facets
            </Badge>
            <Badge variant="secondary">
              {analysis?.complexity || 'moderate'} complexity
            </Badge>
            <Badge variant="outline">
              Confidence: {confidence?.score || 0}%
            </Badge>
            <Badge variant="outline">
              {data?.images?.selected || 'unknown'} imagery
            </Badge>
          </div>

          {/* Quick vision trace first on blocked runs: this gives the tester the
              visible roof outline immediately instead of forcing them to stare
              at a failed georeferencing/report card. Pixel-space only. */}
          {!inlineLoading && Number.isFinite(traceLat) && Number.isFinite(traceLng) && (
            <VisionTracePanel
              lat={traceLat}
              lng={traceLng}
              address={data.address}
              zoom={traceZoom}
              autoRun={isBlockedResult}
            />
          )}

          {/* Inline aerial + roof-tracing preview — always visible after test.
              Renders the persisted roof_measurements row (google satellite tile
              + perimeter + linear features from linear_features_wkt) so the
              user immediately sees the aerial with measurements applied even
              if the full report dialog gates it out. */}
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ImageIcon className="h-4 w-4" />
                Aerial with roof tracing
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {inlineMeasurement?.selected_image_source || inlineMeasurement?.image_source || 'google'} · zoom {inlineMeasurement?.analysis_zoom ?? 20}
              </div>
            </div>
            <div className="relative bg-muted/20" style={{ minHeight: 320 }}>
              {inlineLoading && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading aerial + overlays…
                </div>
              )}
              {!inlineLoading && !inlineMeasurement && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-xs text-muted-foreground p-4 text-center">
                  <AlertTriangle className="h-5 w-5 mb-1 text-amber-500" />
                  <span className="font-medium text-foreground">Trace saved, but not visible to this account.</span>
                  <span className="mt-1 max-w-md">
                    The AI trace for measurement <code className="px-1 rounded bg-muted">{result.measurementId?.slice(0, 8)}…</code> was
                    written by the edge function, but RLS on <code className="px-1 rounded bg-muted">roof_measurements</code> is
                    blocking this browser session from reading it back
                    (<code className="px-1 rounded bg-muted">measured_by</code> / <code className="px-1 rounded bg-muted">tenant_id</code> mismatch).
                  </span>
                  <span className="mt-2 text-[10px]">
                    Fix: rerun the test now that the tester stamps <code>measured_by = auth.uid()</code>, or open the full report
                    (service-role) below.
                  </span>
                </div>
              )}
              {!inlineLoading && inlineMeasurement && (
                <SchematicRoofDiagram
                  measurement={inlineMeasurement}
                  tags={{}}
                  measurementId={inlineMeasurement.id}
                  width={880}
                  height={520}
                  satelliteImageUrl={getMeasurementSatelliteUrl(inlineMeasurement)}
                  showSatelliteOverlay={true}
                  satelliteOpacity={0.95}
                  showLengthLabels={true}
                  showLegend={true}
                  showCompass={false}
                  showTotals={false}
                  showFacets={true}
                  showQAPanel={false}
                />
              )}
            </div>
            {inlineMeasurement && (
              <div className="px-3 py-2 border-t bg-muted/30 text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="font-medium text-foreground">Perimeter:</span> {inlineMeasurement.perimeter_wkt ? '✓' : '—'}</span>
                <span><span className="font-medium text-foreground">Roof lines:</span> {inlineMeasurement.linear_features_wkt ? '✓' : '—'}</span>
                <span><span className="font-medium text-foreground">Footprint src:</span> {inlineMeasurement.footprint_source || '—'}</span>
                <span><span className="font-medium text-foreground">Bounds:</span> {inlineMeasurement.image_bounds ? '✓' : '—'}</span>
                <span><span className="font-medium text-foreground">Result:</span> {inlineMeasurement.result_state || '—'}</span>
              </div>
            )}
          </div>

          {/* Open Full Report — surfaces all current geometry buildouts:
              perimeter overlay, phase gates, roof lines, DSM overlays,
              visual QA, layer toggles, manual verification, etc. */}
          <Button
            onClick={openFullReport}
            disabled={reportLoading || !result.measurementId}
            className="w-full"
            variant="default"
          >
            {reportLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Loading full report...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Open Full Measurement Report
              </>
            )}
          </Button>

          {/* Debug Panel */}
          <Collapsible open={showDebug} onOpenChange={setShowDebug}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-full justify-center py-2">
                <Bug className="h-3 w-3" />
                Debug Details
                <ChevronDown className={cn('h-3 w-3 transition-transform', showDebug && 'rotate-180')} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="bg-muted/30 rounded-lg p-3 text-xs font-mono space-y-2">
                <div>
                  <span className="text-muted-foreground">Measurement ID:</span>{' '}
                  <span className="select-all">{result.measurementId}</span>
                </div>
                {result.canonicalJobId && (
                  <div>
                    <span className="text-muted-foreground">Canonical Job:</span>{' '}
                    <span className="select-all">{result.canonicalJobId}</span>
                  </div>
                )}
                {result.aiMeasurementJobId && (
                  <div>
                    <span className="text-muted-foreground">AI Job:</span>{' '}
                    <span className="select-all">{result.aiMeasurementJobId}</span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Coordinates:</span>{' '}
                  {data?.coordinates?.lat?.toFixed(6)}, {data?.coordinates?.lng?.toFixed(6)}
                </div>
                {analysis?.vertexDetection && (
                  <div>
                    <span className="text-muted-foreground">Vertices:</span>{' '}
                    {analysis.vertexDetection.perimeterVertices} perimeter, {analysis.vertexDetection.interiorJunctions} interior, {analysis.vertexDetection.derivedLines} lines
                  </div>
                )}
                {analysis?.footprintValidation && (
                  <div>
                    <span className="text-muted-foreground">Footprint:</span>{' '}
                    {analysis.footprintValidation.isValid ? '✅ Valid' : '⚠️ Invalid'} 
                    ({analysis.footprintValidation.spanXPct?.toFixed(0)}% x {analysis.footprintValidation.spanYPct?.toFixed(0)}%)
                  </div>
                )}
                {qualityAssessment && (
                  <>
                    <div>
                      <span className="text-muted-foreground">Shadow Coverage:</span>{' '}
                      {qualityAssessment.shadow_coverage_pct?.toFixed(0) || '—'}%
                    </div>
                    <div>
                      <span className="text-muted-foreground">Brightness/Contrast:</span>{' '}
                      {qualityAssessment.brightness_score || '—'}/{qualityAssessment.contrast_score || '—'}
                    </div>
                  </>
                )}
                {confidence?.factors && confidence.factors.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Confidence Factors:</span>
                    <ul className="mt-1 ml-4 list-disc">
                      {confidence.factors.slice(0, 5).map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* Comparison with Previous */}
      {previousResults.length > 0 && (
        <Collapsible open={showComparison} onOpenChange={setShowComparison}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground py-2">
              Compare with previous ({previousResults.length})
              <ChevronDown className={cn('h-4 w-4 transition-transform', showComparison && 'rotate-180')} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <MeasurementComparisonTool
              measurements={[
                {
                  id: result.measurementId,
                  created_at: new Date().toISOString(),
                  summary: {
                    total_area_sqft: measurements?.totalAreaSqft,
                    ridge_ft: measurements?.linear?.ridge,
                    hip_ft: measurements?.linear?.hip,
                    valley_ft: measurements?.linear?.valley,
                    eave_ft: measurements?.linear?.eave,
                    rake_ft: measurements?.linear?.rake,
                  },
                  predominant_pitch: measurements?.predominantPitch,
                  confidence_score: confidence?.score,
                  selected_image_source: data?.images?.selected,
                  quality_assessment: qualityAssessment ? {
                    shadow_risk: qualityAssessment.shadow_risk,
                    image_quality_score: qualityAssessment.image_quality_score,
                  } : undefined,
                },
                ...previousResults.map(pr => ({
                  id: pr.measurementId,
                  created_at: new Date(Date.now() - (previousResults.indexOf(pr) + 1) * 60000).toISOString(),
                  summary: {
                    total_area_sqft: pr.data?.measurements?.totalAreaSqft,
                    ridge_ft: pr.data?.measurements?.linear?.ridge,
                    hip_ft: pr.data?.measurements?.linear?.hip,
                    valley_ft: pr.data?.measurements?.linear?.valley,
                    eave_ft: pr.data?.measurements?.linear?.eave,
                    rake_ft: pr.data?.measurements?.linear?.rake,
                  },
                  predominant_pitch: pr.data?.measurements?.predominantPitch,
                  confidence_score: pr.data?.confidence?.score,
                  selected_image_source: pr.data?.images?.selected,
                }))
              ]}
              centerLat={data?.coordinates?.lat || 0}
              centerLng={data?.coordinates?.lng || 0}
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Full report dialog — renders every current geometry/buildout layer */}
      {reportMeasurement && (
        <MeasurementReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          measurement={reportMeasurement}
          address={data?.address}
          aiMeasurementJobId={reportJobId}
        />
      )}
    </div>
  );
}
