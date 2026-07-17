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

interface TestResult {
  measurementId: string;
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
    };
  };
  qualityAssessment?: {
    shadow_risk: 'low' | 'medium' | 'high';
    image_quality_score: number;
    factors: string[];
  };
}

export function MeasurementTestPanel() {
  const { toast } = useToast();
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

      // Run measurement
      setProgress(60);
      setProgressMessage('Analyzing roof with AI...');

      // Stamp the current signed-in user so RLS (`measured_by = auth.uid()`)
      // lets the browser read the persisted `roof_measurements` row that
      // the edge function inserts. Without this the tester sees
      // "Persisted roof_measurements row was not found" even though the
      // AI trace was saved successfully.
      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData?.user?.id ?? null;

      const requestStart = new Date();
      let measurementData: any = null;
      let measurementError: any = null;
      try {
        const invoked = await supabase.functions.invoke('analyze-roof-aerial', {
          body: {
            address: runAddress,
            coordinates,
            customerId: null, // Test mode - no customer
            userId: currentUserId,
          }
        });
        measurementData = invoked.data;
        measurementError = invoked.error;
      } catch (e: any) {
        measurementError = e;
      }

      // The edge function frequently runs 120–160s and hits the Supabase
      // gateway timeout even though it successfully persisted the row.
      // If invoke errored OR returned no data, poll roof_measurements for
      // a row that was created after we kicked the request off.
      if (measurementError || !measurementData) {
        console.warn('[MeasurementTestPanel] invoke did not return; polling roof_measurements for the persisted row', measurementError);
        setProgressMessage('Response timed out — checking if the run saved…');
        const deadline = Date.now() + 45_000;
        let persisted: any = null;
        while (Date.now() < deadline && !persisted) {
          const { data: rows } = await supabase
            .from('roof_measurements')
            .select('id, created_at, result_state, footprint_source, property_address, geometry_report_json')
            .eq('property_address', runAddress)
            .gte('created_at', requestStart.toISOString())
            .order('created_at', { ascending: false })
            .limit(1);
          if (rows && rows.length > 0) {
            persisted = rows[0];
            break;
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
        if (persisted) {
          measurementData = {
            measurementId: persisted.id,
            timing: { totalMs: Math.max(0, Date.now() - requestStart.getTime()) },
            data: {
              address: runAddress,
              coordinates,
              measurements: {
                totalAreaSqft: persisted.geometry_report_json?.measurements?.totalAreaSqft ?? 0,
                totalSquares: persisted.geometry_report_json?.measurements?.totalSquares ?? 0,
                predominantPitch: persisted.geometry_report_json?.measurements?.predominantPitch ?? 'unknown',
                linear: persisted.geometry_report_json?.measurements?.linear ?? {},
              },
              aiAnalysis: {
                roofType: persisted.geometry_report_json?.aiAnalysis?.roofType ?? 'unknown',
                complexity: persisted.geometry_report_json?.aiAnalysis?.complexity ?? 'unknown',
                facetCount: persisted.geometry_report_json?.aiAnalysis?.facetCount ?? 0,
              },
              confidence: {
                score: persisted.geometry_report_json?.confidence?.score ?? 0,
                factors: [
                  `Recovered from gateway timeout — row ${persisted.id.slice(0, 8)}… persisted`,
                  `result_state: ${persisted.result_state}`,
                  `footprint_source: ${persisted.footprint_source}`,
                ],
              },
              solarApiData: { available: false, buildingFootprint: 0 },
              images: { selected: '' },
            },
            recoveredFromTimeout: true,
          };
          toast({
            title: 'Run persisted despite timeout',
            description: `Row ${persisted.id.slice(0, 8)}… saved. Opening it now.`,
          });
        } else {
          throw new Error(measurementError?.message || 'Edge function timed out and no persisted row was found for this address.');
        }
      }

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
        description: `${measurementData.data?.measurements?.totalAreaSqft?.toLocaleString() || 0} sqft detected in ${measurementData.timing?.totalMs}ms`,
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
