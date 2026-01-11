import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Zap, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

interface LineDeviation {
  aiLineId: string;
  traceLineId: string;
  lineType: string;
  aiWkt: string;
  traceWkt: string;
  deviationFt: number;
  deviationPct: number;
  autoCorrection?: {
    suggestedWkt: string;
    confidence: number;
  };
}

interface DeviationAnalysisResult {
  overallScore: number;
  deviations: LineDeviation[];
  unmatchedAiLines: string[];
  unmatchedTraces: string[];
  autoCorrectionsAvailable: number;
}

interface DeviationAnalysisCardProps {
  sessionId: string;
  aiLinearFeatures: {
    id?: string;
    type: string;
    wkt: string;
    length_ft: number;
  }[];
  manualTraces: {
    id: string;
    trace_type: string;
    length_ft: number;
    canvas_points: { x: number; y: number }[];
  }[];
  centerLat: number;
  centerLng: number;
  zoom: number;
  onCorrectionsApplied?: (corrections: any[]) => void;
}

export function DeviationAnalysisCard({
  sessionId,
  aiLinearFeatures = [],
  manualTraces = [],
  centerLat,
  centerLng,
  zoom,
  onCorrectionsApplied,
}: DeviationAnalysisCardProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<DeviationAnalysisResult | null>(null);
  const [isStoringCorrections, setIsStoringCorrections] = useState(false);

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      // Convert canvas points to WKT for comparison
      const traceFeaturesWithWkt = (Array.isArray(manualTraces) ? manualTraces : []).map(trace => {
        // Ensure canvas_points exists and is an array
        const points = Array.isArray(trace?.canvas_points) ? trace.canvas_points : [];
        if (points.length < 2) return null;
        
        // Convert canvas points to geo coordinates
        const geoPoints = canvasToGeo(points, centerLat, centerLng, 900, 700, zoom);
        const wkt = `LINESTRING(${geoPoints.map(p => `${p.lng} ${p.lat}`).join(', ')})`;
        
        return {
          id: trace.id,
          type: trace.trace_type,
          wkt,
          length_ft: trace.length_ft,
        };
      }).filter(Boolean);

      const { data, error } = await supabase.functions.invoke('measure', {
        body: {
          action: 'evaluate-overlay',
          aiFeatures: aiLinearFeatures,
          userTraces: traceFeaturesWithWkt,
          sessionId,
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Analysis failed');

      setAnalysisResult(data.data);
      toast.success('Deviation analysis complete');
    } catch (err: any) {
      console.error('Deviation analysis error:', err);
      toast.error(err.message || 'Failed to analyze deviations');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleStoreCorrections = async () => {
    if (!analysisResult) return;

    setIsStoringCorrections(true);
    try {
      const corrections = analysisResult.deviations
        .filter(d => d.deviationFt > 0)
        .map(d => ({
          original_line_wkt: d.aiWkt,
          original_line_type: d.lineType,
          corrected_line_wkt: d.traceWkt,
          deviation_ft: d.deviationFt,
          deviation_pct: d.deviationPct,
          correction_source: 'user_trace',
        }));

      const { data, error } = await supabase.functions.invoke('measure', {
        body: {
          action: 'store-corrections',
          sessionId,
          corrections,
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Failed to store corrections');

      toast.success(`Stored ${corrections.length} corrections for AI learning`);
      onCorrectionsApplied?.(corrections);
    } catch (err: any) {
      console.error('Store corrections error:', err);
      toast.error(err.message || 'Failed to store corrections');
    } finally {
      setIsStoringCorrections(false);
    }
  };

  const getDeviationBadge = (pct: number) => {
    const abs = Math.abs(pct);
    if (abs < 5) return <Badge className="bg-green-500 text-white">Accurate</Badge>;
    if (abs < 15) return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Minor</Badge>;
    return <Badge variant="destructive">Significant</Badge>;
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-500';
    if (score >= 70) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4" />
          Line-by-Line Deviation Analysis
        </CardTitle>
        <CardDescription>
          Compare each traced line against AI-generated lines to identify specific corrections
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!analysisResult ? (
          <Button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !aiLinearFeatures?.length || !manualTraces?.length}
            className="w-full"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Run Deviation Analysis
              </>
            )}
          </Button>
        ) : (
          <div className="space-y-4">
            {/* Overall Score */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Line-Level Accuracy</span>
              <span className={`text-2xl font-bold ${getScoreColor(analysisResult.overallScore)}`}>
                {analysisResult.overallScore.toFixed(1)}%
              </span>
            </div>
            <Progress value={analysisResult.overallScore} className="h-2" />

            {/* Deviation Details */}
            {analysisResult.deviations.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {analysisResult.deviations.map((dev, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">{dev.lineType}</Badge>
                      <span className="text-muted-foreground">
                        {Math.round(dev.deviationFt)}ft off
                      </span>
                    </div>
                    {getDeviationBadge(dev.deviationPct)}
                  </div>
                ))}
              </div>
            )}

            {/* Unmatched Lines */}
            {(analysisResult.unmatchedAiLines.length > 0 || analysisResult.unmatchedTraces.length > 0) && (
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                {analysisResult.unmatchedAiLines.length > 0 && (
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                    {analysisResult.unmatchedAiLines.length} AI lines unmatched
                  </div>
                )}
                {analysisResult.unmatchedTraces.length > 0 && (
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                    {analysisResult.unmatchedTraces.length} traces unmatched
                  </div>
                )}
              </div>
            )}

            {/* Store Corrections Button */}
            <div className="flex gap-2">
              <Button
                onClick={handleStoreCorrections}
                disabled={isStoringCorrections || analysisResult.deviations.length === 0}
                className="flex-1"
              >
                {isStoringCorrections ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Storing...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Store {analysisResult.deviations.length} Corrections
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={handleAnalyze}>
                Re-analyze
              </Button>
            </div>

            {analysisResult.autoCorrectionsAvailable > 0 && (
              <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 p-2 rounded">
                <CheckCircle className="h-4 w-4" />
                {analysisResult.autoCorrectionsAvailable} auto-corrections available
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Helper: Convert canvas coordinates to geographic coordinates
function canvasToGeo(
  points: { x: number; y: number }[],
  centerLat: number,
  centerLng: number,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number
): { lat: number; lng: number }[] {
  const ORIGINAL_IMAGE_SIZE = 640;
  const baseMetersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
  
  const scaleX = canvasWidth / ORIGINAL_IMAGE_SIZE;
  const scaleY = canvasHeight / ORIGINAL_IMAGE_SIZE;
  
  const metersPerPixelX = baseMetersPerPixel / scaleX;
  const metersPerPixelY = baseMetersPerPixel / scaleY;
  
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);

  return points.map(point => {
    const dX = point.x - canvasWidth / 2;
    const dY = -(point.y - canvasHeight / 2); // Invert Y
    
    const dMetersX = dX * metersPerPixelX;
    const dMetersY = dY * metersPerPixelY;
    
    return {
      lng: centerLng + dMetersX / metersPerDegLng,
      lat: centerLat + dMetersY / metersPerDegLat,
    };
  });
}
