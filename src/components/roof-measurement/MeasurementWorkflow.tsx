import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MapboxRoofViewer } from './MapboxRoofViewer';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, MapPin, Ruler, Download, ArrowRight, RotateCcw } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface MeasurementWorkflowProps {
  propertyId?: string;
  pipelineEntryId?: string;
  latitude: number;
  longitude: number;
  address: string;
  onComplete?: (measurementId: string, data: any) => void;
  onCancel?: () => void;
}

export function MeasurementWorkflow({
  propertyId,
  pipelineEntryId,
  latitude,
  longitude,
  address,
  onComplete,
  onCancel
}: MeasurementWorkflowProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [imageData, setImageData] = useState<any>(null);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [measurements, setMeasurements] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const totalSteps = 4;
  const progress = (step / totalSteps) * 100;

  // Step 1: Fetch Mapbox imagery
  const fetchImagery = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { data, error: fetchError } = await supabase.functions.invoke('fetch-mapbox-imagery', {
        body: {
          latitude,
          longitude,
          zoom: 20,
          width: 1280,
          height: 1280
        }
      });
      
      if (fetchError) throw fetchError;
      if (!data?.success) throw new Error(data?.error || 'Failed to fetch imagery');
      
      setImageData(data);
      setStep(2);
      toast.success('Satellite imagery loaded');
    } catch (err: any) {
      console.error('Imagery fetch error:', err);
      setError(err.message || 'Failed to load satellite imagery');
      toast.error('Failed to load imagery');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Run AI building detection
  const runAIDetection = async () => {
    if (!imageData) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const { data, error: detectError } = await supabase.functions.invoke('detect-building-structure', {
        body: {
          imageBase64: imageData.image,
          imageBounds: imageData.bounds,
          dimensions: imageData.dimensions
        }
      });
      
      if (detectError) throw detectError;
      if (!data?.success) throw new Error(data?.error || 'Building detection failed');
      
      setAiAnalysis(data.gpsAnalysis || data.aiAnalysis);
      setStep(3);
      toast.success('Building structure detected');
    } catch (err: any) {
      console.error('AI detection error:', err);
      setError(err.message || 'Building detection failed');
      toast.error('Detection failed');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Calculate measurements
  const calculateMeasurements = async () => {
    if (!aiAnalysis) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const { data, error: calcError } = await supabase.functions.invoke('calculate-roof-measurements', {
        body: { gpsAnalysis: aiAnalysis }
      });
      
      if (calcError) throw calcError;
      if (!data?.success) throw new Error(data?.error || 'Measurement calculation failed');
      
      setMeasurements(data);
      setStep(4);
      toast.success('Measurements calculated');
    } catch (err: any) {
      console.error('Calculation error:', err);
      setError(err.message || 'Measurement calculation failed');
      toast.error('Calculation failed');
    } finally {
      setLoading(false);
    }
  };

  // Step 4: Save to database (optional - can integrate with existing save flow)
  const handleComplete = () => {
    if (onComplete && measurements) {
      onComplete(propertyId || '', {
        imageData,
        aiAnalysis,
        measurements
      });
    }
    toast.success('Measurement workflow complete!');
  };

  const resetWorkflow = () => {
    setStep(1);
    setImageData(null);
    setAiAnalysis(null);
    setMeasurements(null);
    setError(null);
  };

  return (
    <div className="space-y-6">
      {/* Progress Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">Mapbox Roof Measurement</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{address}</p>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {latitude.toFixed(6)}, {longitude.toFixed(6)}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Step {step} of {totalSteps}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground pt-2">
              <span className={step >= 1 ? 'text-primary font-medium' : ''}>Load Imagery</span>
              <span className={step >= 2 ? 'text-primary font-medium' : ''}>AI Detection</span>
              <span className={step >= 3 ? 'text-primary font-medium' : ''}>Calculate</span>
              <span className={step >= 4 ? 'text-primary font-medium' : ''}>Complete</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="pt-4">
            <p className="text-destructive text-sm">{error}</p>
            <Button variant="outline" size="sm" onClick={resetWorkflow} className="mt-2">
              <RotateCcw className="h-4 w-4 mr-2" />
              Start Over
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Load Imagery */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-primary font-semibold">1</span>
              </div>
              Load Satellite Imagery
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Fetch high-resolution Mapbox satellite imagery for the property at zoom level 20.
            </p>
            <Button onClick={fetchImagery} disabled={loading} size="lg">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <MapPin className="h-4 w-4 mr-2" />
                  Fetch Mapbox Imagery
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: AI Detection */}
      {step === 2 && imageData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-primary font-semibold">2</span>
              </div>
              Run AI Building Detection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border rounded-lg overflow-hidden max-w-[640px]">
              <img 
                src={imageData.image} 
                alt="Satellite view" 
                className="w-full h-auto"
              />
            </div>
            <div className="flex gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">Zoom: {imageData.zoom}</Badge>
              <Badge variant="secondary">{imageData.dimensions.width}x{imageData.dimensions.height}px</Badge>
              <Badge variant="secondary">{imageData.metersPerPixel?.toFixed(4)} m/px</Badge>
            </div>
            <Button onClick={runAIDetection} disabled={loading} size="lg">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Detecting...
                </>
              ) : (
                <>
                  <Ruler className="h-4 w-4 mr-2" />
                  Detect Building Structure
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Review Detection & Calculate */}
      {step === 3 && aiAnalysis && imageData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-primary font-semibold">3</span>
              </div>
              Review AI Detection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <Card className="bg-muted/50">
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{aiAnalysis.roofType || 'Unknown'}</div>
                  <div className="text-sm text-muted-foreground">Roof Type</div>
                </CardContent>
              </Card>
              <Card className="bg-muted/50">
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{aiAnalysis.facets?.length || 0}</div>
                  <div className="text-sm text-muted-foreground">Facets Detected</div>
                </CardContent>
              </Card>
              <Card className="bg-muted/50">
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold capitalize">{aiAnalysis.pitchAnalysis?.confidence || 'N/A'}</div>
                  <div className="text-sm text-muted-foreground">Pitch Confidence</div>
                </CardContent>
              </Card>
            </div>

            {/* Preview with basic overlay */}
            <div className="border rounded-lg overflow-hidden max-w-[640px]">
              <img 
                src={imageData.image} 
                alt="Detection preview" 
                className="w-full h-auto"
              />
            </div>

            <Button onClick={calculateMeasurements} disabled={loading} size="lg">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Calculating...
                </>
              ) : (
                <>
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Calculate Measurements
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Final Results */}
      {step === 4 && measurements && imageData && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                </div>
                Measurement Complete
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <Card className="bg-primary/5">
                  <CardContent className="pt-4 text-center">
                    <div className="text-3xl font-bold text-primary">{measurements.summary?.totalRoofAreaSqft?.toFixed(0) || 0}</div>
                    <div className="text-sm text-muted-foreground">Total Sq Ft</div>
                  </CardContent>
                </Card>
                <Card className="bg-green-500/5">
                  <CardContent className="pt-4 text-center">
                    <div className="text-3xl font-bold text-green-600">{measurements.summary?.totalSquares || 0}</div>
                    <div className="text-sm text-muted-foreground">Squares</div>
                  </CardContent>
                </Card>
                <Card className="bg-orange-500/5">
                  <CardContent className="pt-4 text-center">
                    <div className="text-3xl font-bold text-orange-600">{measurements.summary?.totalFacets || 0}</div>
                    <div className="text-sm text-muted-foreground">Facets</div>
                  </CardContent>
                </Card>
                <Card className="bg-purple-500/5">
                  <CardContent className="pt-4 text-center">
                    <div className="text-3xl font-bold text-purple-600">{measurements.summary?.predominantPitch || '?/12'}</div>
                    <div className="text-sm text-muted-foreground">Pitch</div>
                  </CardContent>
                </Card>
              </div>

              {/* Linear Measurements */}
              <Card className="bg-muted/30 mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Linear Measurements</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Ridge:</span>
                      <span className="font-semibold ml-2">{measurements.linearSummary?.ridgeFeet?.toFixed(0) || 0} ft</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Hip:</span>
                      <span className="font-semibold ml-2">{measurements.linearSummary?.hipFeet?.toFixed(0) || 0} ft</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Valley:</span>
                      <span className="font-semibold ml-2">{measurements.linearSummary?.valleyFeet?.toFixed(0) || 0} ft</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Eave:</span>
                      <span className="font-semibold ml-2">{measurements.linearSummary?.eaveFeet?.toFixed(0) || 0} ft</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Rake:</span>
                      <span className="font-semibold ml-2">{measurements.linearSummary?.rakeFeet?.toFixed(0) || 0} ft</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Interactive Viewer */}
              <MapboxRoofViewer
                imageUrl={imageData.image}
                analysis={{
                  facets: measurements.facets || [],
                  edges: measurements.edges || {}
                }}
                bounds={imageData.bounds}
                dimensions={imageData.dimensions}
              />
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3">
            <Button onClick={handleComplete} size="lg">
              <Download className="h-4 w-4 mr-2" />
              Save Measurement
            </Button>
            <Button variant="outline" onClick={resetWorkflow}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Measure Again
            </Button>
            {onCancel && (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
