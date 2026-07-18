import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Play, Loader2, CheckCircle2, ChevronDown, Ruler } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MeasurementTestResults } from './MeasurementTestResults';
import { VisionTracePanel, type TraceResponse } from './VisionTracePanel';
import { AddressAutocomplete, type AddressComponents } from '@/components/AddressAutocomplete';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { RoofTraceWorkbenchPreview } from './RoofTraceWorkbenchPreview';
import {
  createRoofTraceSession,
  runRoofTracePerimeter,
  approveRoofTraceSession,
  type RoofTraceSession,
  type RoofTraceRevision,
} from '@/integrations/roofTraceApi';

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
  data: any;
  qualityAssessment?: any;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function numberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function confidencePercent(...values: unknown[]): number {
  for (const value of values) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    return Math.round(n <= 1 ? n * 100 : n);
  }
  return 0;
}

function buildResultFromRoofMeasurement(
  measurement: any,
  fallback: {
    address: string;
    coordinates: { lat: number; lng: number };
    startedAt: Date;
    canonicalJobId?: string;
    aiMeasurementJobId?: string;
  },
): TestResult {
  const report = measurement?.geometry_report_json ?? {};
  const aiData = measurement?.ai_detection_data ?? measurement?.ai_analysis ?? {};
  const measurements = report?.measurements ?? aiData?.measurements ?? {};
  const analysis = report?.aiAnalysis ?? aiData?.aiAnalysis ?? aiData ?? {};
  const confidenceFactors = [
    `created_by_function: ${measurement?.created_by_function ?? 'start-ai-measurement'}`,
    `result_state: ${measurement?.result_state ?? '—'}`,
    `footprint_source: ${measurement?.footprint_source ?? '—'}`,
  ];

  return {
    measurementId: measurement.id,
    canonicalJobId: fallback.canonicalJobId,
    aiMeasurementJobId: fallback.aiMeasurementJobId ?? measurement.ai_measurement_job_id,
    resultState: measurement?.result_state ?? report?.result_state,
    hardFailReason: measurement?.hard_fail_reason ?? null,
    blockCustomerReportReason: measurement?.block_customer_report_reason ?? null,
    validationStatus: measurement?.validation_status ?? null,
    customerReportReady: Boolean(measurement?.customer_report_ready || measurement?.result_state === 'customer_report_ready'),
    timing: { totalMs: Math.max(0, Date.now() - fallback.startedAt.getTime()) },
    data: {
      address: measurement?.property_address || fallback.address,
      coordinates: {
        lat: numberOrZero(measurement?.target_lat ?? fallback.coordinates.lat),
        lng: numberOrZero(measurement?.target_lng ?? fallback.coordinates.lng),
      },
      measurements: {
        totalAreaSqft: numberOrZero(measurement?.total_area_adjusted_sqft ?? measurements?.totalAreaSqft),
        totalSquares: numberOrZero(measurement?.total_squares ?? measurements?.totalSquares),
        predominantPitch: measurement?.predominant_pitch ?? measurements?.predominantPitch ?? 'unknown',
        linear: {
          ridge: numberOrZero(measurement?.total_ridge_length),
          hip: numberOrZero(measurement?.total_hip_length),
          valley: numberOrZero(measurement?.total_valley_length),
          eave: numberOrZero(measurement?.total_eave_length),
          rake: numberOrZero(measurement?.total_rake_length),
        },
      },
      aiAnalysis: {
        roofType: analysis?.roofType ?? 'unknown',
        complexity: analysis?.complexity ?? 'unknown',
        facetCount: numberOrZero(measurement?.facet_count),
      },
      confidence: {
        score: confidencePercent(measurement?.measurement_confidence, measurement?.detection_confidence),
        factors: confidenceFactors,
      },
      solarApiData: {
        available: Boolean(measurement?.solar_building_footprint_sqft),
        buildingFootprint: numberOrZero(measurement?.solar_building_footprint_sqft),
      },
      images: {
        selected: measurement?.selected_image_source || 'canonical',
        google: measurement?.google_maps_image_url,
        mapbox: measurement?.mapbox_image_url,
      },
      footprint: {
        source: measurement?.footprint_source,
        requiresReview: Boolean(measurement?.requires_manual_review),
      },
    },
  };
}

export function MeasurementTestPanel() {
  const { toast } = useToast();
  const effectiveTenantId = useEffectiveTenantId();

  // Shared address inputs
  const [address, setAddress] = useState('');
  const [verifiedAddress, setVerifiedAddress] = useState<AddressComponents | null>(null);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [showDebug, setShowDebug] = useState(false);

  // RoofTrace AI state
  const [rtRunning, setRtRunning] = useState(false);
  const [rtProgress, setRtProgress] = useState(0);
  const [rtMessage, setRtMessage] = useState('');
  const [rtSession, setRtSession] = useState<RoofTraceSession | null>(null);
  const [rtRevision, setRtRevision] = useState<RoofTraceRevision | null>(null);
  const [rtDraftId, setRtDraftId] = useState<string | null>(null);
  const [rtApproving, setRtApproving] = useState(false);

  // Legacy pipeline state
  const [showLegacy, setShowLegacy] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [previousResults, setPreviousResults] = useState<TestResult[]>([]);
  const [quickTraceCoords, setQuickTraceCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [quickTraceResult, setQuickTraceResult] = useState<TraceResponse | null>(null);

  const hasVerifiedAddress = !!verifiedAddress?.latitude && !!verifiedAddress?.longitude;
  const hasManualCoords = !!lat && !!lng;

  const resolveCoords = () => {
    if (hasVerifiedAddress) {
      return { lat: verifiedAddress!.latitude!, lng: verifiedAddress!.longitude! };
    }
    if (hasManualCoords) return { lat: parseFloat(lat), lng: parseFloat(lng) };
    return null;
  };

  // ---------------- RoofTrace AI primary flow ----------------
  const runRoofTrace = async () => {
    const coords = resolveCoords();
    if (!coords) {
      toast({
        title: 'Verified address required',
        description: 'Pick an address from the Google suggestions, or enter lat/lng in Advanced Options.',
        variant: 'destructive',
      });
      return;
    }
    if (!effectiveTenantId) {
      toast({ title: 'Company context required', variant: 'destructive' });
      return;
    }
    setRtRunning(true);
    setRtProgress(10);
    setRtMessage('Creating trace session...');
    setRtSession(null);
    setRtRevision(null);
    setRtDraftId(null);
    try {
      const runAddress = verifiedAddress?.formatted_address || address || `${coords.lat}, ${coords.lng}`;
      const session = await createRoofTraceSession({
        address: runAddress,
        lat: coords.lat,
        lng: coords.lng,
      });
      setRtSession(session);
      setRtProgress(30);
      setRtMessage('Running perimeter trace (Gemini vision + Solar centering)...');

      const { revision, gate_metrics } = await runRoofTracePerimeter(session.id);
      setRtRevision(revision);
      setRtProgress(100);
      setRtMessage(
        gate_metrics.passes
          ? 'Perimeter proposed — review and approve.'
          : 'Perimeter needs review before approval.',
      );
      toast({
        title: gate_metrics.passes ? 'Perimeter proposed' : 'Perimeter needs review',
        description: `Revision ${revision.revision} · coverage ${gate_metrics.coverage_pct}%`,
      });
    } catch (e: any) {
      console.error('RoofTrace run failed', e);
      toast({
        title: 'RoofTrace failed',
        description: String(e?.message ?? e),
        variant: 'destructive',
      });
    } finally {
      setRtRunning(false);
      setTimeout(() => { setRtProgress(0); setRtMessage(''); }, 2000);
    }
  };

  const approveTrace = async () => {
    if (!rtSession) return;
    setRtApproving(true);
    try {
      const { revision, measurement_draft } = await approveRoofTraceSession(rtSession.id);
      setRtRevision(revision);
      setRtDraftId(measurement_draft.id);
      setRtSession({
        ...rtSession,
        perimeter_status: 'accepted',
        approved_revision: revision.revision,
      });
      toast({
        title: 'Perimeter approved',
        description: `Measurement draft ${measurement_draft.id.slice(0, 8)}… ready.`,
      });
    } catch (e: any) {
      toast({
        title: 'Approve failed',
        description: String(e?.message ?? e),
        variant: 'destructive',
      });
    } finally {
      setRtApproving(false);
    }
  };

  // ---------------- Legacy start-ai-measurement flow (kept for comparison) ----------------
  const runMeasurement = async () => {
    const coords = resolveCoords();
    if (!coords) {
      toast({ title: 'Verified address required', variant: 'destructive' });
      return;
    }
    if (!effectiveTenantId) {
      toast({ title: 'Company context required', variant: 'destructive' });
      return;
    }
    setIsRunning(true);
    setProgress(5);
    setProgressMessage('Starting quick AI roof trace...');
    setResult(null);
    setQuickTraceResult(null);
    try {
      const runAddress = verifiedAddress?.formatted_address || address || `${coords.lat}, ${coords.lng}`;
      setQuickTraceCoords({ lat: coords.lat, lng: coords.lng });

      const { data: traceData, error: traceError } = await supabase.functions.invoke('vision-trace-roof', {
        body: { lat: coords.lat, lng: coords.lng, size: 640, address: runAddress, prefer_roof_center: true },
      });
      if (traceError) throw traceError;
      if ((traceData as any)?.error) throw new Error((traceData as any).error);
      if (!traceData || Number((traceData as any).count || 0) <= 0) {
        throw new Error('Quick AI roof trace returned 0 roof segments.');
      }
      setQuickTraceResult(traceData as TraceResponse);
      setProgress(60);
      setProgressMessage('Starting canonical AI measurement job...');

      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData?.user?.id ?? null;
      const requestStart = new Date();
      const measurementTestRunId = crypto.randomUUID();

      const { data: startData, error: startError } = await supabase.functions.invoke('start-ai-measurement', {
        body: {
          measurement_test_run_id: measurementTestRunId,
          tenant_id: effectiveTenantId,
          property_address: runAddress,
          latitude: coords.lat,
          longitude: coords.lng,
          original_geocode_lat: coords.lat,
          original_geocode_lng: coords.lng,
          confirmed_roof_center_lat: coords.lat,
          confirmed_roof_center_lng: coords.lng,
          user_confirmed_roof_target: true,
          source_button: 'AI Measurement Developer Test',
          user_id: currentUserId,
          zoom: 20,
          logical_image_width: 640,
          logical_image_height: 640,
          raster_scale: 2,
        },
      });
      if (startError) throw startError;
      if (startData?.success === false) {
        throw new Error(startData?.message || startData?.error || 'Canonical measurement job failed to start.');
      }

      const canonicalJobId = startData?.jobId || startData?.job_id;
      const aiMeasurementJobId = startData?.aiMeasurementJobId || startData?.ai_measurement_job_id;
      if (!canonicalJobId) throw new Error('Canonical measurement job did not return a job id.');

      setProgress(70);
      setProgressMessage('Canonical job running — waiting for persisted report...');

      const deadline = Date.now() + 9 * 60_000;
      let persistedMeasurement: any = null;
      let terminalError: string | null = null;
      while (Date.now() < deadline && !persistedMeasurement && !terminalError) {
        const { data: job } = await supabase
          .from('measurement_jobs')
          .select('id, status, progress_message, measurement_id, error, ai_measurement_job_id')
          .eq('id', canonicalJobId)
          .maybeSingle();
        if (job?.progress_message) setProgressMessage(job.progress_message);
        const linkedMeasurementId = job?.measurement_id || startData?.measurementId;
        if (linkedMeasurementId) {
          const { data: m } = await supabase.from('roof_measurements').select('*').eq('id', linkedMeasurementId).maybeSingle();
          if (m) { persistedMeasurement = m; break; }
        }
        const linkedAiJobId = job?.ai_measurement_job_id || aiMeasurementJobId;
        if (linkedAiJobId) {
          const { data: rows } = await supabase
            .from('roof_measurements').select('*').eq('ai_measurement_job_id', linkedAiJobId)
            .order('created_at', { ascending: false }).limit(1);
          if (rows && rows.length > 0) { persistedMeasurement = rows[0]; break; }
        }
        if (job?.status === 'failed') {
          terminalError = job.error || job.progress_message || 'Canonical measurement job failed.';
          break;
        }
        await sleep(3000);
      }
      if (!persistedMeasurement) throw new Error(terminalError || 'Canonical measurement timed out.');

      const measurementData = buildResultFromRoofMeasurement(persistedMeasurement, {
        address: runAddress, coordinates: coords, startedAt: requestStart, canonicalJobId, aiMeasurementJobId,
      });
      setProgress(100);
      setProgressMessage('Complete');
      const testResult: TestResult = { ...measurementData };
      if (result) setPreviousResults((prev) => [result, ...prev.slice(0, 4)]);
      setResult(testResult);
      toast({ title: 'Legacy measurement complete' });
    } catch (error) {
      console.error('Legacy measurement test failed:', error);
      toast({
        title: 'Legacy measurement failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsRunning(false);
      setTimeout(() => { setProgress(0); setProgressMessage(''); }, 2000);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Ruler className="h-5 w-5" />
            Measurement Test Runner — RoofTrace AI
          </CardTitle>
          <CardDescription>
            Perimeter-first tracing workflow. Creates a trace session, runs the AI perimeter, and lets you approve into a measurement draft.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="test-address">Property Address</Label>
            <AddressAutocomplete
              value={address}
              onChange={(v) => {
                setAddress(v);
                if (verifiedAddress && v !== verifiedAddress.formatted_address) setVerifiedAddress(null);
              }}
              onAddressSelect={(components) => {
                setVerifiedAddress(components);
                setAddress(components.formatted_address);
                if (components.latitude && components.longitude) {
                  setLat(components.latitude.toString());
                  setLng(components.longitude.toString());
                }
              }}
              placeholder="Start typing an address..."
              disabled={rtRunning || isRunning}
            />
            {!hasVerifiedAddress && address.length > 0 && (
              <p className="text-xs text-muted-foreground">Pick a suggestion to verify the address before running.</p>
            )}
            {hasVerifiedAddress && (
              <p className="text-xs text-green-600">Verified: {verifiedAddress!.formatted_address}</p>
            )}
          </div>

          <Collapsible open={showDebug} onOpenChange={setShowDebug}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                <ChevronDown className={`h-3 w-3 transition-transform ${showDebug ? 'rotate-180' : ''}`} />
                Advanced Options
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="test-lat" className="text-xs">Latitude</Label>
                  <Input id="test-lat" placeholder="26.1234" value={lat} onChange={(e) => setLat(e.target.value)} disabled={rtRunning || isRunning} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="test-lng" className="text-xs">Longitude</Label>
                  <Input id="test-lng" placeholder="-80.1234" value={lng} onChange={(e) => setLng(e.target.value)} disabled={rtRunning || isRunning} />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {rtRunning && (
            <div className="space-y-2">
              <Progress value={rtProgress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">{rtMessage}</p>
            </div>
          )}

          <Button
            onClick={runRoofTrace}
            disabled={rtRunning || (!hasVerifiedAddress && !hasManualCoords)}
            className="w-full"
          >
            {rtRunning ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Tracing perimeter...</>
            ) : (
              <><Play className="h-4 w-4 mr-2" />Run Measurement Test</>
            )}
          </Button>

          {rtSession && (
            <div className="text-xs text-muted-foreground">
              Session <code>{rtSession.id.slice(0, 8)}…</code> · status <b>{rtSession.perimeter_status}</b> · state <b>{rtSession.result_state}</b>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workbench preview + approve */}
      {(rtRevision || rtRunning) && (
        <div className="space-y-3">
          <RoofTraceWorkbenchPreview
            revision={rtRevision}
            status={rtSession?.perimeter_status ?? 'pending'}
          />

          {rtRevision && rtRevision.perimeter_gate_metrics?.passes && rtSession?.perimeter_status !== 'accepted' && (
            <Button onClick={approveTrace} disabled={rtApproving} className="w-full">
              {rtApproving ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Approving...</>
              ) : (
                <><CheckCircle2 className="h-4 w-4 mr-2" />Approve perimeter → create measurement draft</>
              )}
            </Button>
          )}

          {rtDraftId && (
            <div className="text-xs rounded-md border bg-emerald-500/5 border-emerald-500/30 p-2">
              Measurement draft created: <code>{rtDraftId}</code>
            </div>
          )}
        </div>
      )}

      {/* Legacy pipeline (start-ai-measurement) */}
      <Card>
        <Collapsible open={showLegacy} onOpenChange={setShowLegacy}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ChevronDown className={`h-4 w-4 transition-transform ${showLegacy ? 'rotate-180' : ''}`} />
                Legacy pipeline (start-ai-measurement)
              </CardTitle>
              <CardDescription>
                Runs the full canonical pipeline for A/B comparison against the new RoofTrace AI flow.
              </CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              {quickTraceCoords && (
                <VisionTracePanel
                  lat={quickTraceCoords.lat}
                  lng={quickTraceCoords.lng}
                  address={verifiedAddress?.formatted_address || address}
                  zoom={21}
                  initialTrace={quickTraceResult}
                />
              )}
              {isRunning && (
                <div className="space-y-2">
                  <Progress value={progress} className="h-2" />
                  <p className="text-xs text-muted-foreground text-center">{progressMessage}</p>
                </div>
              )}
              <Button
                variant="secondary"
                onClick={runMeasurement}
                disabled={isRunning || (!hasVerifiedAddress && !hasManualCoords)}
                className="w-full"
              >
                {isRunning ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Measuring (legacy)...</>
                ) : (
                  <><Play className="h-4 w-4 mr-2" />Run legacy pipeline</>
                )}
              </Button>
              {result && (
                <MeasurementTestResults result={result} previousResults={previousResults} />
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  );
}
