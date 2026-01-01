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
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [previousResults, setPreviousResults] = useState<TestResult[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  const runMeasurement = async () => {
    if (!address && (!lat || !lng)) {
      toast({
        title: 'Input required',
        description: 'Please enter an address or coordinates',
        variant: 'destructive'
      });
      return;
    }

    setIsRunning(true);
    setProgress(10);
    setProgressMessage('Geocoding address...');
    setResult(null);

    try {
      let coordinates = { lat: parseFloat(lat), lng: parseFloat(lng) };
      
      // If address provided, geocode it
      if (address && (!lat || !lng)) {
        setProgress(20);
        setProgressMessage('Looking up address...');
        
        const { data: geocodeData, error: geocodeError } = await supabase.functions.invoke('google-address-validation', {
          body: { address }
        });
        
        if (geocodeError || !geocodeData?.success) {
          throw new Error('Failed to geocode address');
        }
        
        coordinates = {
          lat: geocodeData.data.latitude,
          lng: geocodeData.data.longitude
        };
        setLat(coordinates.lat.toString());
        setLng(coordinates.lng.toString());
      }

      setProgress(40);
      setProgressMessage('Fetching satellite imagery...');

      // Run measurement
      setProgress(60);
      setProgressMessage('Analyzing roof with AI...');

      const { data: measurementData, error: measurementError } = await supabase.functions.invoke('analyze-roof-aerial', {
        body: {
          address: address || `${coordinates.lat}, ${coordinates.lng}`,
          coordinates,
          customerId: null, // Test mode - no customer
          userId: null
        }
      });

      if (measurementError) {
        throw new Error(measurementError.message || 'Measurement failed');
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
          {/* Address Input */}
          <div className="space-y-2">
            <Label htmlFor="test-address">Property Address</Label>
            <Input
              id="test-address"
              placeholder="123 Main St, City, State ZIP"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={isRunning}
            />
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
            disabled={isRunning || (!address && (!lat || !lng))}
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
