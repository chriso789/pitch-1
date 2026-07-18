import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Play, Loader2, CheckCircle2, AlertTriangle, ChevronDown, MapPin, Ruler, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MeasurementTestResults } from './MeasurementTestResults';
import { ImageQualityBadge } from './ImageQualityBadge';
import { AddressAutocomplete, type AddressComponents } from '@/components/AddressAutocomplete';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

interface TestResult {
  measurementId: string;
  canonicalJobId?: string;
  aiMeasurementJobId?: string;
  timing: { totalMs: number };
  data: {
    address: string;
    coordinates: { lat: number; lng: number };
    measurements: {
      totalAreaSqft: number;
      totalSquares: number;
      predominantPitch: string;
      linear: any;
    };
    aiAnalysis: {
      roofType: string;
      complexity: string;
      facetCount: number;
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
      google?: string;
      mapbox?: string;
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
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function numberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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
    `created_by_function: ${measurement?.created_by_function ?? report?.route_provenance?.created_by_function ?? 'start-ai-measurement'}`,
    `canonical_measurement_route: ${measurement?.canonical_measurement_route ?? report?.route_provenance?.canonical_measurement_route ?? true}`,
    `result_state: ${measurement?.result_state ?? report?.result_state ?? '—'}`,
    `footprint_source: ${measurement?.footprint_source ?? '—'}`,
  ];

  return {
    measurementId: measurement.id,
    canonicalJobId: fallback.canonicalJobId,
    aiMeasurementJobId: fallback.aiMeasurementJobId ?? measurement.ai_measurement_job_id,
    timing: { totalMs: Math.max(0, Date.now() - fallback.startedAt.getTime()) },
    data: {
      address: measurement?.property_address || fallback.address,
      coordinates: {
        lat: numberOrZero(measurement?.target_lat ?? measurement?.gps_coordinates?.lat ?? fallback.coordinates.lat),
        lng: numberOrZero(measurement?.target_lng ?? measurement?.gps_coordinates?.lng ?? fallback.coordinates.lng),
      },
      measurements: {
        totalAreaSqft: numberOrZero(measurement?.total_area_adjusted_sqft ?? measurement?.total_area_flat_sqft ?? measurements?.totalAreaSqft),
        totalSquares: numberOrZero(measurement?.total_squares ?? measurements?.totalSquares),
        predominantPitch: measurement?.predominant_pitch ?? measurements?.predominantPitch ?? 'unknown',
        linear: {
          ridge: numberOrZero(measurement?.total_ridge_length ?? measurements?.linear?.ridge),
          hip: numberOrZero(measurement?.total_hip_length ?? measurements?.linear?.hip),
          valley: numberOrZero(measurement?.total_valley_length ?? measurements?.linear?.valley),
          eave: numberOrZero(measurement?.total_eave_length ?? measurements?.linear?.eave),
          rake: numberOrZero(measurement?.total_rake_length ?? measurements?.linear?.rake),
        },
      },
      aiAnalysis: {
        roofType: analysis?.roofType ?? analysis?.roof_type ?? 'unknown',
        complexity: analysis?.complexity ?? report?.complexity ?? 'unknown',
        facetCount: numberOrZero(measurement?.facet_count ?? analysis?.facetCount ?? analysis?.facet_count),
      },
      confidence: {
        score: Math.round(numberOrZero(measurement?.measurement_confidence ?? measurement?.detection_confidence * 100)),
        factors: confidenceFactors,
      },
      solarApiData: {
        available: Boolean(measurement?.solar_building_footprint_sqft),
        buildingFootprint: numberOrZero(measurement?.solar_building_footprint_sqft),
      },
      images: {
        selected: measurement?.selected_image_source || measurement?.image_source || 'canonical',
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
  const [address, setAddress] = useState('');
  const [verifiedAddress, setVerifiedAddress] = useState<AddressComponents | null>(null);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [previousResults, setPreviousResults] = useState<TestResult[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  const hasVerifiedAddress = !!verifiedAddress?.latitude && !!verifiedAddress?.longitude;
  const hasManualCoords = !!lat && !!lng;

  const runMeasurement = async () => {
    if (!hasVerifiedAddress && !hasManualCoords) {
      toast({
        title: 'Verified address required',
        description: 'Pick an address from the Google suggestions, or enter lat/lng in Advanced Options.',
        variant: 'destructive'
      });
      return;
    }

    if (!effectiveTenantId) {
      toast({
        title: 'Company context required',
        description: 'Select or load an active company before running the measurement test.',
        variant: 'destructive'
      });
      return;
    }

    setIsRunning(true);
    setProgress(10);
    setProgressMessage('Preparing measurement...');
    setResult(null);

    try {
      // Prefer the verified Google Places address; otherwise manual lat/lng.
      let coordinates = hasVerifiedAddress
        ? { lat: verifiedAddress!.latitude!, lng: verifiedAddress!.longitude! }
        : { lat: parseFloat(lat), lng: parseFloat(lng) };

      const runAddress = verifiedAddress?.formatted_address || address || `${coordinates.lat}, ${coordinates.lng}`;

      if (hasVerifiedAddress) {
        setLat(coordinates.lat.toString());
        setLng(coordinates.lng.toString());
      }


      setProgress(40);
      setProgressMessage('Fetching satellite imagery...');

      setProgress(60);
      setProgressMessage('Starting canonical AI measurement job...');

      // Stamp the current signed-in user so RLS (`measured_by = auth.uid()`)
      // lets the browser read the persisted `roof_measurements` row that
      // the edge function inserts. Without this the tester sees
      // "Persisted roof_measurements row was not found" even though the
      // AI trace was saved successfully.
      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData?.user?.id ?? null;

      const requestStart = new Date();
      const measurementTestRunId = crypto.randomUUID();
      const { data: startData, error: startError } = await supabase.functions.invoke('start-ai-measurement', {
        body: {
          measurement_test_run_id: measurementTestRunId,
          tenant_id: effectiveTenantId,
          property_address: runAddress,
          latitude: coordinates.lat,
          longitude: coordinates.lng,
          original_geocode_lat: coordinates.lat,
          original_geocode_lng: coordinates.lng,
          confirmed_roof_center_lat: coordinates.lat,
          confirmed_roof_center_lng: coordinates.lng,
          user_confirmed_roof_target: true,
          source_button: 'AI Measurement Developer Test',
          user_id: currentUserId,
          zoom: 20,
          logical_image_width: 640,
          logical_image_height: 640,
          raster_scale: 2,
        }
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
          .select('id, status, progress_message, measurement_id, error, ai_measurement_job_id, created_at, completed_at')
          .eq('id', canonicalJobId)
          .maybeSingle();

        if (job?.progress_message) setProgressMessage(job.progress_message);

        const linkedMeasurementId = job?.measurement_id || startData?.measurementId;
        if (linkedMeasurementId) {
          const { data: measurement } = await supabase
            .from('roof_measurements')
            .select('*')
            .eq('id', linkedMeasurementId)
            .maybeSingle();
          if (measurement) {
            persistedMeasurement = measurement;
            break;
          }
        }

        const linkedAiJobId = job?.ai_measurement_job_id || aiMeasurementJobId;
        if (linkedAiJobId) {
          const { data: rows } = await supabase
            .from('roof_measurements')
            .select('*')
            .eq('ai_measurement_job_id', linkedAiJobId)
            .order('created_at', { ascending: false })
            .limit(1);
          if (rows && rows.length > 0) {
            persistedMeasurement = rows[0];
            break;
          }
        }

        if (job?.status === 'failed') {
          terminalError = job.error || job.progress_message || 'Canonical measurement job failed before a report row was saved.';
          break;
        }

        await sleep(3000);
      }

      if (!persistedMeasurement) {
        throw new Error(terminalError || 'Canonical measurement job timed out before a report row was visible.');
      }

      const measurementData = buildResultFromRoofMeasurement(persistedMeasurement, {
        address: runAddress,
        coordinates,
        startedAt: requestStart,
        canonicalJobId,
        aiMeasurementJobId,
      });

      setProgress(80);
      setProgressMessage('Analyzing image quality...');

      // Run image quality analysis
      let qualityAssessment = null;
      try {
        const { data: qualityData } = await supabase.functions.invoke('analyze-image-quality', {
          body: {
            imageUrl: measurementData.data?.images?.google || measurementData.data?.images?.mapbox,
            address
          }
        });
        if (qualityData?.success) {
          qualityAssessment = qualityData.result;
        }
      } catch (e) {
        console.warn('Image quality analysis failed:', e);
      }

      setProgress(100);
      setProgressMessage('Complete!');

      const testResult: TestResult = {
        ...measurementData,
        qualityAssessment
      };

      // Save to history
      if (result) {
        setPreviousResults(prev => [result, ...prev.slice(0, 4)]);
      }
      
      setResult(testResult);

      toast({
        title: 'Measurement complete',
        description: `Canonical job ${canonicalJobId.slice(0, 8)}… saved report ${measurementData.measurementId.slice(0, 8)}…`,
      });

    } catch (error) {
      console.error('Measurement test failed:', error);
      toast({
        title: 'Measurement failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setIsRunning(false);
      setTimeout(() => {
        setProgress(0);
        setProgressMessage('');
      }, 2000);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Ruler className="h-5 w-5" />
            Measurement Test Runner
          </CardTitle>
          <CardDescription>
            Test the roof measurement algorithm on any property
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Address Input — Google Places autocomplete + verification */}
          <div className="space-y-2">
            <Label htmlFor="test-address">Property Address</Label>
            <AddressAutocomplete
              value={address}
              onChange={(v) => {
                setAddress(v);
                // Any manual edit invalidates the last verified pick.
                if (verifiedAddress && v !== verifiedAddress.formatted_address) {
                  setVerifiedAddress(null);
                }
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
              disabled={isRunning}
            />
            {!hasVerifiedAddress && address.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Pick a suggestion to verify the address before running the test.
              </p>
            )}
            {hasVerifiedAddress && (
              <p className="text-xs text-green-600">
                Verified via Google: {verifiedAddress!.formatted_address}
              </p>
            )}
          </div>


          {/* Coordinates (optional) */}
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
                  <Input
                    id="test-lat"
                    placeholder="26.1234"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    disabled={isRunning}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="test-lng" className="text-xs">Longitude</Label>
                  <Input
                    id="test-lng"
                    placeholder="-80.1234"
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    disabled={isRunning}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Progress Bar */}
          {isRunning && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">{progressMessage}</p>
            </div>
          )}

          {/* Run Button */}
          <Button 
            onClick={runMeasurement} 
            disabled={isRunning || (!hasVerifiedAddress && !hasManualCoords)}
            className="w-full"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Measuring...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Run Measurement Test
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <MeasurementTestResults 
          result={result} 
          previousResults={previousResults}
        />
      )}
    </div>
  );
}
