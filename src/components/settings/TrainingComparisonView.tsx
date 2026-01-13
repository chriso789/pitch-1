import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { CheckCircle, XCircle, AlertTriangle, BarChart2, RefreshCw, Loader2, Zap, RotateCcw, Sparkles, Brain } from 'lucide-react';
import { toast } from 'sonner';
import { TrainingOverlayComparison } from './TrainingOverlayComparison';
import { DeviationAnalysisCard } from './training/DeviationAnalysisCard';
interface TrainingComparisonViewProps {
  sessionId: string;
  aiMeasurementId?: string;
  satelliteImageUrl?: string;
  manualTraces?: {
    id: string;
    trace_type: string;
    length_ft: number;
    canvas_points: { x: number; y: number }[];
  }[];
  manualTotals: {
    ridge: number;
    hip: number;
    valley: number;
    eave: number;
    rake: number;
    perimeter: number;
  };
}

interface ComparisonRow {
  label: string;
  manual: number;
  ai: number;
  variance: number;
  variancePct: number;
}

interface CorrectionFactor {
  feature_type: string;
  multiplier: number;
  sessions_count: number;
}

export function TrainingComparisonView({ 
  sessionId, 
  aiMeasurementId, 
  satelliteImageUrl,
  manualTraces = [],
  manualTotals 
}: TrainingComparisonViewProps) {
  const queryClient = useQueryClient();
  const [isRetraining, setIsRetraining] = useState(false);
  const [isRunningAIMeasure, setIsRunningAIMeasure] = useState(false);
  const [isRemeasuring, setIsRemeasuring] = useState(false);
  const [currentAiMeasurementId, setCurrentAiMeasurementId] = useState<string | undefined>(aiMeasurementId);
  const [learnedCorrections, setLearnedCorrections] = useState<CorrectionFactor[]>([]);
  const [retrainComplete, setRetrainComplete] = useState(false);
  const [applyToFuture, setApplyToFuture] = useState(true);
  const [correctionsStored, setCorrectionsStored] = useState(false);

  // Fetch session data for lat/lng/address when running AI measure
  const { data: session } = useQuery({
    queryKey: ['training-session-for-measure', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roof_training_sessions')
        .select('id, lat, lng, property_address, ai_measurement_id, pipeline_entry_id')
        .eq('id', sessionId)
        .single();
      
      if (error) throw error;
      return data;
    },
  });

  // Update currentAiMeasurementId when session data changes
  const effectiveAiMeasurementId = currentAiMeasurementId || session?.ai_measurement_id;

  const handleRunAIMeasure = async () => {
    if (!session?.lat || !session?.lng) {
      toast.error('No coordinates available for this property');
      return;
    }

    // Use pipeline_entry_id as propertyId - this is what the measure function expects
    const propertyId = session.pipeline_entry_id;
    if (!propertyId) {
      toast.error('No linked property found for this training session');
      return;
    }

    setIsRunningAIMeasure(true);
    try {
      toast.info('Running AI measurement analysis...');

      // Call the measure edge function with the pipeline_entry_id
      const { data, error } = await supabase.functions.invoke('measure', {
        body: {
          action: 'pull',
          propertyId,
          lat: session.lat,
          lng: session.lng,
          address: session.property_address || undefined,
        },
      });

      if (error) throw error;

      if (!data?.ok) {
        throw new Error(data?.error || 'AI measurement failed');
      }

      // Extract measurement from nested response: data.data.measurement
      const measurement = data?.data?.measurement;
      const measurementId = measurement?.id;
      if (!measurementId) {
        throw new Error('AI measurement did not return an ID');
      }

      const summary = measurement?.summary || {};

      // Update the training session with the AI measurement ID
      const { error: updateError } = await supabase
        .from('roof_training_sessions')
        .update({ 
          ai_measurement_id: measurementId,
          ai_totals: {
            ridge: summary?.ridge_ft || 0,
            hip: summary?.hip_ft || 0,
            valley: summary?.valley_ft || 0,
            eave: summary?.eave_ft || 0,
            rake: summary?.rake_ft || 0,
          }
        } as any)
        .eq('id', sessionId);

      if (updateError) throw updateError;

      // Update local state to trigger comparison
      setCurrentAiMeasurementId(measurementId);

      // Invalidate queries to refetch data
      queryClient.invalidateQueries({ queryKey: ['ai-measurement'] });
      queryClient.invalidateQueries({ queryKey: ['training-session-for-measure', sessionId] });

      const facetCount = measurement?.faces?.length || 0;
      const totalArea = Math.round(summary?.total_area_sqft || 0);
      toast.success(`AI Measurement complete! Found ${facetCount} facets, ${totalArea} sqft`);
    } catch (err: any) {
      console.error('Failed to run AI measurement:', err);
      toast.error(err.message || 'Failed to run AI measurement');
    } finally {
      setIsRunningAIMeasure(false);
    }
  };

  const handleRetrainAI = async () => {
    setIsRetraining(true);
    try {
      const { data, error } = await supabase.functions.invoke('calculate-measurement-corrections');
      
      if (error) throw error;
      
      const sessionsAnalyzed = data?.sessions_analyzed || 0;
      const corrections = data?.corrections || [];
      
      setLearnedCorrections(corrections);
      setRetrainComplete(true);
      
      toast.success(`AI Retrained! Analyzed ${sessionsAnalyzed} sessions, updated ${corrections.length} correction factors.`);
    } catch (err: any) {
      console.error('Failed to retrain AI:', err);
      toast.error(err.message || 'Failed to recalculate corrections');
    } finally {
      setIsRetraining(false);
    }
  };

  const handleRemeasure = async () => {
    if (!session?.lat || !session?.lng) {
      toast.error('No coordinates available for this property');
      return;
    }

    const propertyId = session.pipeline_entry_id;
    if (!propertyId) {
      toast.error('No linked property found for this training session');
      return;
    }

    setIsRemeasuring(true);
    try {
      toast.info('Remeasuring with learned corrections...');

      // Call the measure edge function with apply_corrections flag
      const { data, error } = await supabase.functions.invoke('measure', {
        body: {
          action: 'pull',
          propertyId,
          lat: session.lat,
          lng: session.lng,
          address: session.property_address || undefined,
          apply_corrections: true,
        },
      });

      if (error) throw error;

      if (!data?.ok) {
        throw new Error(data?.error || 'Remeasurement failed');
      }

      const measurement = data?.data?.measurement;
      const measurementId = measurement?.id;
      
      if (measurementId) {
        setCurrentAiMeasurementId(measurementId);
        
        // Update session
        const summary = measurement?.summary || {};
        await supabase
          .from('roof_training_sessions')
          .update({ 
            ai_measurement_id: measurementId,
            ai_totals: {
              ridge: summary?.ridge_ft || 0,
              hip: summary?.hip_ft || 0,
              valley: summary?.valley_ft || 0,
              eave: summary?.eave_ft || 0,
              rake: summary?.rake_ft || 0,
            }
          } as any)
          .eq('id', sessionId);
      }

      queryClient.invalidateQueries({ queryKey: ['ai-measurement'] });
      queryClient.invalidateQueries({ queryKey: ['training-session-for-measure', sessionId] });

      toast.success('Remeasurement complete with corrections applied!');
    } catch (err: any) {
      console.error('Failed to remeasure:', err);
      toast.error(err.message || 'Failed to remeasure');
    } finally {
      setIsRemeasuring(false);
    }
  };

  // Fetch AI measurement data if available - query measurements table (not roof_measurements)
  const { data: aiMeasurement } = useQuery({
    queryKey: ['ai-measurement', effectiveAiMeasurementId],
    queryFn: async () => {
      if (!effectiveAiMeasurementId) return null;
      
      const { data, error } = await supabase
        .from('measurements')
        .select('*')
        .eq('id', effectiveAiMeasurementId)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!effectiveAiMeasurementId,
  });

  // Calculate comparison data - extract from summary JSONB in measurements table
  const summary = (aiMeasurement as any)?.summary || {};
  const aiTotals = {
    ridge: summary?.ridge_ft || 0,
    hip: summary?.hip_ft || 0,
    valley: summary?.valley_ft || 0,
    eave: summary?.eave_ft || 0,
    rake: summary?.rake_ft || 0,
    perimeter: summary?.perimeter_ft || 0,
  };

  // Extract and sanitize AI linear features for overlay
  const rawAiLinearFeatures = (aiMeasurement as any)?.linear_features;
  const aiLinearFeatures = (() => {
    if (!Array.isArray(rawAiLinearFeatures)) return [];
    return rawAiLinearFeatures.filter((f: unknown): f is { type: string; wkt: string; length_ft: number } => {
      if (!f || typeof f !== 'object') {
        console.error('[TrainingComparisonView] Invalid AI feature dropped (not an object):', f);
        return false;
      }
      const feature = f as Record<string, unknown>;
      if (typeof feature.type !== 'string' || !feature.type.trim()) {
        console.error('[TrainingComparisonView] Invalid AI feature dropped (missing type):', feature);
        return false;
      }
      if (typeof feature.wkt !== 'string' || !feature.wkt.trim()) {
        console.error('[TrainingComparisonView] Invalid AI feature dropped (missing wkt):', feature);
        return false;
      }
      // Only accept LINESTRING geometry
      if (!feature.wkt.toUpperCase().startsWith('LINESTRING(')) {
        console.error('[TrainingComparisonView] Invalid AI feature dropped (not LINESTRING):', feature.wkt?.slice?.(0, 30));
        return false;
      }
      return true;
    }).map((f: { type: string; wkt: string; length_ft?: unknown; id?: unknown }) => ({
      id: typeof f.id === 'string' ? f.id : undefined,
      type: f.type,
      wkt: f.wkt,
      length_ft: typeof f.length_ft === 'number' && isFinite(f.length_ft) ? f.length_ft : 0,
    }));
  })();

  const calculateVariance = (manual: number, ai: number): { variance: number; variancePct: number } => {
    if (manual === 0 && ai === 0) return { variance: 0, variancePct: 0 };
    if (manual === 0) return { variance: ai, variancePct: 100 };
    
    const variance = ai - manual;
    const variancePct = (variance / manual) * 100;
    return { variance, variancePct };
  };

  const comparisonData: ComparisonRow[] = [
    { 
      label: 'Ridge', 
      manual: manualTotals.ridge, 
      ai: aiTotals.ridge,
      ...calculateVariance(manualTotals.ridge, aiTotals.ridge)
    },
    { 
      label: 'Hip', 
      manual: manualTotals.hip, 
      ai: aiTotals.hip,
      ...calculateVariance(manualTotals.hip, aiTotals.hip)
    },
    { 
      label: 'Valley', 
      manual: manualTotals.valley, 
      ai: aiTotals.valley,
      ...calculateVariance(manualTotals.valley, aiTotals.valley)
    },
    { 
      label: 'Eave', 
      manual: manualTotals.eave, 
      ai: aiTotals.eave,
      ...calculateVariance(manualTotals.eave, aiTotals.eave)
    },
    { 
      label: 'Rake', 
      manual: manualTotals.rake, 
      ai: aiTotals.rake,
      ...calculateVariance(manualTotals.rake, aiTotals.rake)
    },
    { 
      label: 'Perimeter', 
      manual: manualTotals.perimeter, 
      ai: aiTotals.perimeter,
      ...calculateVariance(manualTotals.perimeter, aiTotals.perimeter)
    },
  ];

  // Filter to rows with data
  const activeRows = comparisonData.filter(row => row.manual > 0 || row.ai > 0);

  // Calculate overall accuracy
  const totalManual = activeRows.reduce((sum, row) => sum + row.manual, 0);
  const totalAI = activeRows.reduce((sum, row) => sum + row.ai, 0);
  const overallVariancePct = totalManual > 0 ? Math.abs(((totalAI - totalManual) / totalManual) * 100) : 0;
  const overallAccuracy = Math.max(0, 100 - overallVariancePct);

  // 0ft tolerance: Only 0% variance is green, everything else needs work
  const getVarianceColor = (pct: number, aiValue: number = 0, manualValue: number = 0) => {
    // If AI has 0 but manual has value, it's MISSING - always red
    if (aiValue === 0 && manualValue > 0) return 'text-red-500';
    const absPct = Math.abs(pct);
    if (absPct === 0) return 'text-green-500'; // Only exact match is green
    if (absPct <= 5) return 'text-yellow-500'; // Small variance is yellow
    return 'text-red-500'; // Anything else is red
  };

  const getVarianceIcon = (pct: number, aiValue: number = 0, manualValue: number = 0) => {
    // If AI has 0 but manual has value, it's MISSING
    if (aiValue === 0 && manualValue > 0) return <XCircle className="h-4 w-4 text-red-500" />;
    const absPct = Math.abs(pct);
    if (absPct === 0) return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (absPct <= 5) return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <XCircle className="h-4 w-4 text-red-500" />;
  };

  // Retrain AI button component - rendered in all states
  const RetrainAICard = ({ showRunAI = false }: { showRunAI?: boolean }) => (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="py-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="font-medium">Train AI with Your Traces</p>
            <p className="text-sm text-muted-foreground">
              Apply your manual corrections to improve future AI measurements
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {showRunAI && (
              <Button 
                onClick={handleRunAIMeasure} 
                disabled={isRunningAIMeasure || !session?.lat}
                variant="secondary"
              >
                {isRunningAIMeasure ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4 mr-2" />
                )}
                {isRunningAIMeasure ? 'Analyzing...' : 'Run AI Measure'}
              </Button>
            )}
            <Button onClick={handleRetrainAI} disabled={isRetraining}>
              {isRetraining ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {isRetraining ? 'Retraining...' : 'Retrain AI'}
            </Button>
            {retrainComplete && (
              <Button 
                onClick={handleRemeasure} 
                disabled={isRemeasuring || !session?.lat}
                variant="outline"
                className="border-green-500 text-green-600 hover:bg-green-50"
              >
                {isRemeasuring ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-2" />
                )}
                {isRemeasuring ? 'Remeasuring...' : 'Remeasure'}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // Learned Corrections Summary
  const LearnedCorrectionsCard = () => {
    if (!retrainComplete || learnedCorrections.length === 0) return null;
    
    return (
      <Card className="border-green-200 bg-green-50/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-green-700">
            <Sparkles className="h-4 w-4" />
            AI Retrained Successfully
          </CardTitle>
          <CardDescription>
            The AI learned the following correction factors from your training sessions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {learnedCorrections.map((correction) => {
              const pctChange = ((correction.multiplier - 1) * 100).toFixed(1);
              const isIncrease = correction.multiplier > 1;
              const isDecrease = correction.multiplier < 1;
              
              return (
                <div key={correction.feature_type} className="p-2 bg-white rounded border">
                  <div className="text-sm font-medium capitalize">{correction.feature_type}</div>
                  <div className={`text-xs ${isIncrease ? 'text-blue-600' : isDecrease ? 'text-orange-600' : 'text-gray-500'}`}>
                    {isIncrease ? `+${pctChange}%` : isDecrease ? `${pctChange}%` : 'No change'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {correction.sessions_count} session(s)
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (!effectiveAiMeasurementId) {
    return (
      <div className="space-y-6">
        <RetrainAICard showRunAI={true} />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Zap className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">No AI Measurement Available</p>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              Click "Run AI Measure" above to analyze this property and generate AI measurements for comparison.
            </p>
            {!session?.lat && (
              <Badge variant="destructive">No coordinates available</Badge>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (activeRows.length === 0) {
    return (
      <div className="space-y-6">
        <RetrainAICard />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BarChart2 className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">No Data to Compare</p>
            <p className="text-muted-foreground text-center max-w-md">
              Trace roof features first, then return here to compare against the AI measurement.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Retrain AI Button */}
      <RetrainAICard />
      
      {/* Learned Corrections Summary */}
      <LearnedCorrectionsCard />

      {/* Line-by-Line Deviation Analysis (Phase 1) */}
      {effectiveAiMeasurementId && session?.lat && session?.lng && manualTraces.length > 0 && Array.isArray(aiLinearFeatures) && aiLinearFeatures.length > 0 && (
        <DeviationAnalysisCard
          sessionId={sessionId}
          aiLinearFeatures={aiLinearFeatures}
          manualTraces={manualTraces}
          centerLat={session.lat}
          centerLng={session.lng}
          zoom={20}
          onCorrectionsApplied={() => setCorrectionsStored(true)}
        />
      )}

      {/* Apply to Future Toggle */}
      {correctionsStored && (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-green-600" />
                <div>
                  <p className="font-medium text-green-700">Corrections Saved</p>
                  <p className="text-sm text-muted-foreground">
                    AI will use these corrections for similar buildings
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="apply-future"
                  checked={applyToFuture}
                  onCheckedChange={setApplyToFuture}
                />
                <Label htmlFor="apply-future" className="text-sm">
                  Apply to future measurements
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Visual Overlay Comparison */}
      {satelliteImageUrl && session?.lat && session?.lng && (
        (Array.isArray(manualTraces) && manualTraces.length > 0) || 
        (Array.isArray(aiLinearFeatures) && aiLinearFeatures.length > 0)
      ) && (
        <TrainingOverlayComparison
          satelliteImageUrl={satelliteImageUrl}
          centerLat={session.lat}
          centerLng={session.lng}
          zoom={20}
          manualTraces={manualTraces}
          aiLinearFeatures={Array.isArray(aiLinearFeatures) ? aiLinearFeatures : []}
          aiMeasurementCenter={(aiMeasurement as any)?.gps_coordinates}
        />
      )}

      {/* Overall Accuracy Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart2 className="h-5 w-5" />
            Overall Accuracy
          </CardTitle>
          <CardDescription>
            How close the AI measurement is to your manual traces
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{overallAccuracy.toFixed(1)}%</span>
              <Badge 
                variant={overallAccuracy >= 95 ? 'default' : overallAccuracy >= 85 ? 'secondary' : 'destructive'}
                className={overallAccuracy >= 95 ? 'bg-green-500' : ''}
              >
                {overallAccuracy >= 95 ? 'Excellent' : overallAccuracy >= 85 ? 'Good' : 'Needs Improvement'}
              </Badge>
            </div>
            <Progress value={overallAccuracy} className="h-3" />
            <p className="text-sm text-muted-foreground">
              Total Manual: {Math.round(totalManual)} ft • Total AI: {Math.round(totalAI)} ft • 
              Variance: {overallVariancePct.toFixed(1)}%
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Comparison Table */}
      <Card>
        <CardHeader>
          <CardTitle>Feature-by-Feature Comparison</CardTitle>
          <CardDescription>
            Compare manual traces vs AI detection for each roof feature type
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Header */}
            <div className="grid grid-cols-5 gap-4 text-sm font-medium text-muted-foreground pb-2 border-b">
              <div>Feature</div>
              <div className="text-right">Manual (ft)</div>
              <div className="text-right">AI (ft)</div>
              <div className="text-right">Variance</div>
              <div className="text-right">Status</div>
            </div>

            {/* Rows */}
            {activeRows.map((row) => {
              const isMissing = row.ai === 0 && row.manual > 0;
              
              return (
                <div key={row.label} className={`grid grid-cols-5 gap-4 items-center py-2 border-b border-dashed last:border-0 ${isMissing ? 'bg-red-50' : ''}`}>
                  <div className="font-medium">{row.label}</div>
                  <div className="text-right">{Math.round(row.manual)}</div>
                  <div className="text-right">
                    {isMissing ? (
                      <span className="text-red-600 font-medium">0 (MISSING)</span>
                    ) : (
                      Math.round(row.ai)
                    )}
                  </div>
                  <div className={`text-right font-medium ${getVarianceColor(row.variancePct, row.ai, row.manual)}`}>
                    {isMissing ? (
                      <span className="text-red-600">AI missed this feature</span>
                    ) : (
                      <>
                        {row.variancePct > 0 ? '+' : ''}{row.variancePct.toFixed(1)}%
                        <span className="text-xs text-muted-foreground ml-1">
                          ({row.variance > 0 ? '+' : ''}{Math.round(row.variance)} ft)
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex justify-end">
                    {getVarianceIcon(row.variancePct, row.ai, row.manual)}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Legend - Updated for 0ft tolerance */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Exact Match (0%)</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span>Close (1-5%)</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span>Needs Correction (5%+) or MISSING</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Using 0ft tolerance: Your traces are ground truth. AI must match exactly.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
