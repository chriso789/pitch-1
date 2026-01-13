import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Zap, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

// Flexible interface to handle varying response shapes from the edge function
interface LineDeviation {
  // Original expected fields
  aiLineId?: string;
  traceLineId?: string;
  lineType?: string;
  aiWkt?: string;
  traceWkt?: string;
  deviationFt?: number;
  deviationPct?: number;
  autoCorrection?: {
    suggestedWkt: string;
    confidence: number;
  };
  // Alternative fields from evaluator
  featureId?: string;
  featureType?: string;
  avgDeviationFt?: number;
  maxDeviationFt?: number;
  alignmentScore?: number;
  needsCorrection?: boolean;
  correctedWkt?: string;
  // Missing feature detection fields
  isMissingFeature?: boolean;
  tracedLengthFt?: number;
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
  aiLinearFeatures,
  manualTraces,
  centerLat,
  centerLng,
  zoom,
  onCorrectionsApplied,
}: DeviationAnalysisCardProps) {
  // Ensure arrays are always defined - handle undefined/null props
  const safeAiFeatures = Array.isArray(aiLinearFeatures) ? aiLinearFeatures : [];
  const safeManualTraces = Array.isArray(manualTraces) ? manualTraces : [];
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<DeviationAnalysisResult | null>(null);
  const [isStoringCorrections, setIsStoringCorrections] = useState(false);

  // Normalize analysis result to prevent .length crashes on undefined arrays
  const safeResult: DeviationAnalysisResult | null = analysisResult ? {
    overallScore: typeof analysisResult.overallScore === 'number' ? analysisResult.overallScore : 0,
    deviations: Array.isArray(analysisResult.deviations) ? analysisResult.deviations : [],
    unmatchedAiLines: Array.isArray(analysisResult.unmatchedAiLines) ? analysisResult.unmatchedAiLines : [],
    unmatchedTraces: Array.isArray(analysisResult.unmatchedTraces) ? analysisResult.unmatchedTraces : [],
    autoCorrectionsAvailable: typeof analysisResult.autoCorrectionsAvailable === 'number' ? analysisResult.autoCorrectionsAvailable : 0,
  } : null;

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      // Convert canvas points to WKT for comparison
      const traceFeaturesWithWkt = safeManualTraces.map(trace => {
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

      // Ensure AI features have IDs for proper matching
      const aiWithIds = safeAiFeatures.map((f, idx) => ({
        ...f,
        id: f.id || `ai-${f.type}-${idx}`,
      }));

      // Log what we're sending for debugging
      console.log('[DeviationAnalysis] Sending to evaluate-overlay:', {
        aiFeatureCount: aiWithIds.length,
        aiFeatureTypes: [...new Set(aiWithIds.map(f => f.type))],
        traceCount: traceFeaturesWithWkt.length,
        traceTypes: [...new Set(traceFeaturesWithWkt.map((t: any) => t?.type))],
      });

      const { data, error } = await supabase.functions.invoke('measure', {
        body: {
          action: 'evaluate-overlay',
          aiFeatures: aiWithIds,  // Use aiWithIds to ensure all have IDs
          userTraces: traceFeaturesWithWkt,
          sessionId,
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Analysis failed');

      // Safely set the result - normalize to expected shape
      const rawData = data.data || {};
      setAnalysisResult({
        overallScore: typeof rawData.overallScore === 'number' ? rawData.overallScore : 0,
        deviations: Array.isArray(rawData.deviations) ? rawData.deviations : [],
        unmatchedAiLines: Array.isArray(rawData.unmatchedAiLines) ? rawData.unmatchedAiLines : [],
        unmatchedTraces: Array.isArray(rawData.unmatchedTraces) ? rawData.unmatchedTraces : [],
        autoCorrectionsAvailable: typeof rawData.autoCorrectionsAvailable === 'number' ? rawData.autoCorrectionsAvailable : 0,
      });
      toast.success('Deviation analysis complete');
    } catch (err: any) {
      console.error('Deviation analysis error:', err);
      toast.error(err.message || 'Failed to analyze deviations');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleStoreCorrections = async () => {
    if (!safeResult) return;

    setIsStoringCorrections(true);
    try {
      // Build corrections from deviations, handling both old and new field names
      // Include ALL deviations that need correction - especially MISSING features
      const corrections = safeResult.deviations
        .filter(d => {
          const deviationFt = d.deviationFt || d.avgDeviationFt || 0;
          // Detect missing features: featureId starts with 'missing-' OR (no aiWkt but has traceWkt)
          const isMissing = d.featureId?.startsWith('missing-') || 
                           ((!d.aiWkt || d.aiWkt === '') && (d.traceWkt || d.correctedWkt));
          const hasDeviation = deviationFt > 0;
          const needsCorrection = d.needsCorrection === true;
          
          console.log('[Filter] Checking deviation:', {
            featureId: d.featureId,
            lineType: d.lineType || d.featureType,
            isMissing,
            hasDeviation,
            needsCorrection,
            included: hasDeviation || needsCorrection || isMissing,
          });
          
          // Include if: has deviation, needs correction, OR is a missing feature
          return hasDeviation || needsCorrection || isMissing;
        })
        .map(d => {
          const deviationFt = d.deviationFt || d.avgDeviationFt || 0;
          const correctedWkt = d.traceWkt || d.correctedWkt || '';
          // Detect missing features
          const isMissing = d.featureId?.startsWith('missing-') || 
                           ((!d.aiWkt || d.aiWkt === '') && correctedWkt);
          
          return {
            original_line_wkt: d.aiWkt || '', // Empty for missing features → triggers is_feature_injection
            original_line_type: d.lineType || d.featureType || 'unknown',
            corrected_line_wkt: correctedWkt,
            // For missing features, use the traced length (stored in maxDeviationFt) as deviation
            deviation_ft: isMissing ? (d.maxDeviationFt || deviationFt || 0) : deviationFt,
            deviation_pct: d.deviationPct || (d.alignmentScore != null ? (1 - d.alignmentScore) * 100 : 0),
            correction_source: isMissing ? 'feature_injection' : 'user_trace',
            is_feature_injection: isMissing, // Explicitly flag feature injections
          };
        })
        .filter(c => c.corrected_line_wkt); // Only include if we have a corrected WKT

      if (corrections.length === 0) {
        toast.info('No corrections to store - all features matched or missing corrected WKT data');
        console.warn('Store corrections: No valid corrections found', {
          totalDeviations: safeResult.deviations.length,
          sampleDeviation: safeResult.deviations[0],
        });
        setIsStoringCorrections(false);
        return;
      }

      // Show summary toast before storing
      const featureInjections = corrections.filter(c => c.is_feature_injection).length;
      const lineCorrections = corrections.filter(c => !c.is_feature_injection).length;
      toast.info(`Storing ${corrections.length} corrections: ${featureInjections} feature injections, ${lineCorrections} line corrections`);

      console.log('[StoreCorrections] Storing corrections:', {
        count: corrections.length,
        featureInjections,
        lineCorrections,
        types: corrections.map(c => c.original_line_type),
        samples: corrections.slice(0, 3),
      });

      const { data, error } = await supabase.functions.invoke('measure', {
        body: {
          action: 'store-corrections',
          sessionId,
          corrections,
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Failed to store corrections');

      // Display detailed results
      const result = data.data;
      const stored = result?.stored || 0;
      const failed = result?.failed || 0;
      const skipped = result?.skipped || 0;

      if (stored > 0) {
        toast.success(`Stored ${stored} corrections for AI learning${failed > 0 ? ` (${failed} failed)` : ''}${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
      } else if (failed > 0 || skipped > 0) {
        toast.warning(`No corrections stored. Failed: ${failed}, Skipped: ${skipped}`);
        console.warn('Store corrections result:', result);
      } else {
        toast.info('No corrections were stored');
      }

      // Log detailed failure/skip reasons if any
      if (result?.failureReasons?.length > 0) {
        console.warn('Correction failures:', result.failureReasons);
      }
      if (result?.skippedReasons?.length > 0) {
        console.info('Corrections skipped:', result.skippedReasons);
      }

      onCorrectionsApplied?.(corrections);
    } catch (err: any) {
      console.error('Store corrections error:', err);
      toast.error(err.message || 'Failed to store corrections');
    } finally {
      setIsStoringCorrections(false);
    }
  };

  // 0ft tolerance: ONLY show Accurate badge when deviation is exactly 0
  const getDeviationBadge = (deviationFt: number, pct: number, isMissing: boolean = false) => {
    // If AI produced nothing (missing feature), show MISSING badge
    if (isMissing) return <Badge variant="destructive">MISSING</Badge>;
    
    // 0ft tolerance: must be exactly 0 to be "Accurate"
    if (deviationFt === 0) return <Badge className="bg-green-500 text-white">Accurate</Badge>;
    
    // Any deviation > 0 needs correction
    if (deviationFt <= 2) return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Close ({deviationFt.toFixed(1)}ft)</Badge>;
    return <Badge variant="destructive">Off ({Math.round(deviationFt)}ft)</Badge>;
  };

  const getScoreColor = (score: number) => {
    if (score >= 95) return 'text-green-500'; // Only 95%+ is green (very strict)
    if (score >= 80) return 'text-yellow-500';
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
        {!safeResult ? (
          <Button
            onClick={handleAnalyze}
            disabled={isAnalyzing || safeAiFeatures.length === 0 || safeManualTraces.length === 0}
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
              <span className={`text-2xl font-bold ${getScoreColor(safeResult.overallScore)}`}>
                {safeResult.overallScore.toFixed(1)}%
              </span>
            </div>
            <Progress value={safeResult.overallScore} className="h-2" />

            {/* Deviation Details */}
            {safeResult.deviations.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {safeResult.deviations.map((dev, idx) => {
                  const deviationFt = dev.deviationFt || dev.avgDeviationFt || 0;
                  const tracedLength = dev.tracedLengthFt || dev.maxDeviationFt || deviationFt;
                  
                  // FIXED: Check if this is a MISSING feature using explicit backend flag
                  const isMissing: boolean = Boolean(
                    dev.isMissingFeature ||  // Explicit flag from backend
                    dev.featureId?.startsWith('missing-') ||
                    dev.featureId?.startsWith('injected-') ||
                    (!dev.aiWkt && dev.traceWkt) ||  // AI had nothing but user traced
                    (!dev.aiWkt && dev.correctedWkt) ||  // Same check with correctedWkt
                    (dev.alignmentScore === 0 && deviationFt > 50)  // Zero alignment + high deviation
                  );
                  
                  // Debug log to verify detection
                  if (idx === 0) {
                    console.log('[DeviationAnalysisCard] First deviation:', {
                      featureId: dev.featureId,
                      lineType: dev.lineType,
                      isMissingFeature: dev.isMissingFeature,
                      aiWkt: dev.aiWkt?.substring(0, 30),
                      traceWkt: dev.traceWkt?.substring(0, 30),
                      correctedWkt: dev.correctedWkt?.substring(0, 30),
                      alignmentScore: dev.alignmentScore,
                      deviationFt,
                      computed_isMissing: isMissing,
                    });
                  }
                  
                  return (
                    <div
                      key={idx}
                      className={`flex items-center justify-between p-2 rounded text-sm ${isMissing ? 'bg-destructive/10 border border-destructive/30' : 'bg-muted/50'}`}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant={isMissing ? "destructive" : "outline"} className="capitalize">
                          {dev.lineType || dev.featureType || 'unknown'}
                        </Badge>
                        <span className={isMissing ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                          {isMissing 
                            ? `MISSING - AI: 0ft, You: ${Math.round(tracedLength)}ft` 
                            : `${Math.round(deviationFt)}ft off`}
                        </span>
                      </div>
                      {getDeviationBadge(deviationFt, dev.deviationPct || 0, isMissing)}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Unmatched Lines */}
            {(safeResult.unmatchedAiLines.length > 0 || safeResult.unmatchedTraces.length > 0) && (
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                {safeResult.unmatchedAiLines.length > 0 && (
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                    {safeResult.unmatchedAiLines.length} AI lines unmatched
                  </div>
                )}
                {safeResult.unmatchedTraces.length > 0 && (
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                    {safeResult.unmatchedTraces.length} traces unmatched
                  </div>
                )}
              </div>
            )}

            {/* Store Corrections Button */}
            <div className="flex gap-2">
              <Button
                onClick={handleStoreCorrections}
                disabled={isStoringCorrections || safeResult.deviations.length === 0}
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
                    Store {safeResult.deviations.length} Corrections
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={handleAnalyze}>
                Re-analyze
              </Button>
            </div>

            {safeResult.autoCorrectionsAvailable > 0 && (
              <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 p-2 rounded">
                <CheckCircle className="h-4 w-4" />
                {safeResult.autoCorrectionsAvailable} auto-corrections available
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
