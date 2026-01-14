import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, XCircle, AlertTriangle, BarChart2, RefreshCw, Loader2, Zap, RotateCcw, Sparkles, Brain, Eye, Settings2, Cpu } from 'lucide-react';
import { toast } from 'sonner';
import { TrainingOverlayComparison } from './TrainingOverlayComparison';
import { DeviationAnalysisCard } from './training/DeviationAnalysisCard';
import { TrainingVerificationMetrics } from './training/TrainingVerificationMetrics';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [viewMode, setViewMode] = useState<'original' | 'corrected'>('original');
  
  // Phase 1: Engine selection - 'skeleton' (fast, geometric) or 'vision' (accurate, AI-based)
  const [selectedEngine, setSelectedEngine] = useState<'skeleton' | 'vision'>('vision');
  const [lastEngineUsed, setLastEngineUsed] = useState<string | null>(null);

  // Fetch session data for lat/lng/address when running AI measure
  const { data: session } = useQuery({
    queryKey: ['training-session-for-measure', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roof_training_sessions')
        .select('id, lat, lng, property_address, ai_measurement_id, pipeline_entry_id, original_ai_measurement_id, corrected_ai_measurement_id')
        .eq('id', sessionId)
        .single();
      
      if (error) throw error;
      return data as typeof data & { 
        original_ai_measurement_id?: string | null; 
        corrected_ai_measurement_id?: string | null; 
      };
    },
  });

  // Use ORIGINAL AI measurement for comparison (before any training overrides)
  // Fall back to ai_measurement_id for backwards compatibility
  const originalAiMeasurementId = session?.original_ai_measurement_id || currentAiMeasurementId || session?.ai_measurement_id;
  const correctedAiMeasurementId = session?.corrected_ai_measurement_id;
  
  // For display, respect viewMode: show original for comparison or corrected to verify training worked
  const effectiveAiMeasurementId = viewMode === 'corrected' && correctedAiMeasurementId
    ? correctedAiMeasurementId
    : originalAiMeasurementId;

  // Handler for running fresh AI measurement (no corrections)
  // This generates an independent AI measurement for comparison
  const handleRunAIMeasure = async () => {
    if (!session?.lat || !session?.lng) {
      toast.error('No coordinates available for this property');
      return;
    }

    const propertyId = session.pipeline_entry_id;
    if (!propertyId) {
      toast.error('No linked property found for this training session');
      return;
    }

    setIsRunningAIMeasure(true);
    try {
      toast.info(`Running AI measurement using ${selectedEngine.toUpperCase()} engine...`);

      // Call measure function with engine selection
      const { data, error } = await supabase.functions.invoke('measure', {
        body: {
          action: 'pull',
          propertyId,
          lat: session.lat,
          lng: session.lng,
          address: session.property_address || undefined,
          engine: selectedEngine, // Phase 1: Use selected engine (vision or skeleton)
        },
      });

      if (error) throw error;

      if (!data?.ok) {
        throw new Error(data?.error || 'AI measurement failed');
      }
      
      // Track which engine was actually used (may fallback)
      const engineUsed = data?.data?.engine_used || selectedEngine;
      setLastEngineUsed(engineUsed);

      if (!data?.ok) {
        throw new Error(data?.error || 'AI measurement failed');
      }

      const measurement = data?.data?.measurement;
      const measurementId = measurement?.id;
      if (!measurementId) {
        throw new Error('AI measurement did not return an ID');
      }

      const summary = measurement?.summary || {};

      // Store as ORIGINAL AI measurement - this is the baseline for comparison
      // Only update original_ai_measurement_id if it's currently NULL (corrupted session)
      // Otherwise update both for fresh sessions
      const updatePayload: Record<string, unknown> = {
        original_ai_measurement_id: measurementId,
        ai_totals: {
          ridge: summary?.ridge_ft || 0,
          hip: summary?.hip_ft || 0,
          valley: summary?.valley_ft || 0,
          eave: summary?.eave_ft || 0,
          rake: summary?.rake_ft || 0,
        }
      };

      // If this is a fresh session (no existing ai_measurement_id), also set it
      // For corrupted sessions, ONLY set original_ai_measurement_id to preserve the corrupted one
      if (!session?.ai_measurement_id) {
        updatePayload.ai_measurement_id = measurementId;
      }

      const { error: updateError } = await supabase
        .from('roof_training_sessions')
        .update(updatePayload as any)
        .eq('id', sessionId);

      if (updateError) throw updateError;

      // Update local state to trigger comparison with fresh AI data
      setCurrentAiMeasurementId(measurementId);

      queryClient.invalidateQueries({ queryKey: ['ai-measurement'] });
      queryClient.invalidateQueries({ queryKey: ['training-session-for-measure', sessionId] });

      const facetCount = measurement?.faces?.length || 0;
      const totalArea = Math.round(summary?.total_area_sqft || 0);
      toast.success(`Fresh AI Measurement complete! Found ${facetCount} facets, ${totalArea} sqft. Now showing original AI vs your traces.`);
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

  // Handler for LEARNING from traces (adjusts AI, doesn't copy)
  // This creates an ADJUSTED measurement where AI learns from user traces
  const handleLearnFromTraces = async () => {
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
      toast.info('AI is learning from your traces (adjusting, not copying)...');

      // Call measure WITH training_session_id - this triggers AI learning
      const { data, error } = await supabase.functions.invoke('measure', {
        body: {
          action: 'pull',
          propertyId,
          lat: session.lat,
          lng: session.lng,
          address: session.property_address || undefined,
          apply_corrections: true,
          training_session_id: sessionId, // Triggers AI learning pipeline
        },
      });

      if (error) throw error;

      if (!data?.ok) {
        throw new Error(data?.error || 'Learning failed');
      }

      const measurement = data?.data?.measurement;
      const measurementId = measurement?.id;
      const originalMeasurementId = data?.data?.original_measurement_id;
      const learningMetrics = data?.data?.learning_metrics;
      
      if (measurementId) {
        const updatePayload: Record<string, unknown> = {
          corrected_ai_measurement_id: measurementId,
        };

        if (originalMeasurementId) {
          updatePayload.original_ai_measurement_id = originalMeasurementId;
          setCurrentAiMeasurementId(originalMeasurementId);
        }

        await supabase
          .from('roof_training_sessions')
          .update(updatePayload as any)
          .eq('id', sessionId);
      }

      queryClient.invalidateQueries({ queryKey: ['ai-measurement'] });
      queryClient.invalidateQueries({ queryKey: ['training-session-for-measure', sessionId] });

      setViewMode('corrected');

      // Show learning metrics if available
      if (learningMetrics) {
        toast.success(`AI learned! Score: ${learningMetrics.evaluationScore}%, Adjusted: ${learningMetrics.featuresAdjusted}, Injected: ${learningMetrics.featuresInjected}`);
      } else {
        toast.success('AI learned from your traces! Features adjusted (not copied).');
      }
    } catch (err: any) {
      console.error('Failed to learn from traces:', err);
      toast.error(err.message || 'Failed to learn from traces');
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

  // NEW: Fetch authoritative WKT data from roof_measurements table
  // This is the source of truth for diagram rendering - matches Project "AI Measurements" view
  const { data: roofMeasurement } = useQuery({
    queryKey: ['roof-measurement-wkt', effectiveAiMeasurementId],
    queryFn: async () => {
      if (!effectiveAiMeasurementId) return null;
      
      const { data, error } = await supabase
        .from('roof_measurements')
        .select(`
          id,
          linear_features_wkt,
          perimeter_wkt,
          footprint_vertices_geo,
          gps_coordinates,
          target_lat,
          target_lng,
          facet_count,
          total_area_adjusted_sqft,
          predominant_pitch,
          footprint_source,
          footprint_confidence,
          footprint_requires_review,
          detection_method
        `)
        .eq('id', effectiveAiMeasurementId)
        .maybeSingle();
      
      if (error) {
        console.log('No roof_measurements found for ID:', effectiveAiMeasurementId);
        return null;
      }
      
      if (data) {
        console.log('📐 Loaded roof_measurements WKT:', {
          id: data.id,
          wkt_features: (data.linear_features_wkt as any[])?.length || 0,
          vertices: (data.footprint_vertices_geo as any[])?.length || 0,
          source: data.footprint_source,
        });
      }
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

  // Calculate overall accuracy - EXCLUDE PERIMETER from accuracy calculation
  // Perimeter is often auto-calculated (eave + rake) and creates misleading variance
  const coreFeatureRows = activeRows.filter(row => row.label !== 'Perimeter');
  const totalManual = coreFeatureRows.reduce((sum, row) => sum + row.manual, 0);
  const totalAI = coreFeatureRows.reduce((sum, row) => sum + row.ai, 0);
  const overallVariancePct = totalManual > 0 ? Math.abs(((totalAI - totalManual) / totalManual) * 100) : 0;
  const overallAccuracy = Math.max(0, 100 - overallVariancePct);
  
  // Detect corrupted session where original AI data was overwritten
  const isDataCorrupted = !session?.original_ai_measurement_id && 
    session?.ai_measurement_id && 
    coreFeatureRows.every(row => Math.abs(row.variancePct) < 0.1);

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
  // Shows different buttons based on session state
  const hasOriginalAI = !!session?.original_ai_measurement_id;
  
  const RetrainAICard = () => (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="py-4">
        <div className="flex flex-col gap-4">
          {/* Engine Selection */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">AI Engine:</span>
              <Select value={selectedEngine} onValueChange={(v) => setSelectedEngine(v as 'skeleton' | 'vision')}>
                <SelectTrigger className="w-[180px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vision">
                    <div className="flex items-center gap-2">
                      <Eye className="h-3 w-3" />
                      <span>Vision (Recommended)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="skeleton">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-3 w-3" />
                      <span>Skeleton (Fast)</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              {lastEngineUsed && (
                <Badge variant="outline" className="text-xs">
                  Last: {lastEngineUsed}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedEngine === 'vision' 
                ? 'AI analyzes satellite imagery to detect roof lines (more accurate)' 
                : 'Uses geometric algorithm from footprint (faster, less accurate)'}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="font-medium">Train AI with Your Traces</p>
              <p className="text-sm text-muted-foreground">
                {!hasOriginalAI 
                  ? 'First, generate AI baseline to compare against your traces'
                  : 'Apply your manual corrections to create a corrected measurement'
                }
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Step 1: Run AI Measure */}
              <Button 
                onClick={handleRunAIMeasure} 
                disabled={isRunningAIMeasure || !session?.lat}
                variant={!hasOriginalAI ? "default" : "outline"}
              >
                {isRunningAIMeasure ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : selectedEngine === 'vision' ? (
                  <Eye className="h-4 w-4 mr-2" />
                ) : (
                  <Cpu className="h-4 w-4 mr-2" />
                )}
                {isRunningAIMeasure ? 'Generating...' : hasOriginalAI ? 'Regenerate AI' : 'Generate AI Baseline'}
              </Button>
            
            {/* Step 2: Retrain AI (recalculate correction factors) */}
            <Button onClick={handleRetrainAI} disabled={isRetraining} variant={hasOriginalAI ? "default" : "outline"}>
              {isRetraining ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {isRetraining ? 'Retraining...' : 'Retrain AI'}
            </Button>
            
            {/* Step 3: Learn from traces - adjusts AI toward user traces (not copy) */}
            {(retrainComplete || hasOriginalAI) && (
              <Button 
                onClick={handleLearnFromTraces} 
                disabled={isRemeasuring || !session?.lat}
                variant="outline"
                className="border-green-500 text-green-600 hover:bg-green-50"
              >
                {isRemeasuring ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Brain className="h-4 w-4 mr-2" />
                )}
                {isRemeasuring ? 'Learning...' : 'Learn from Traces'}
              </Button>
            )}
            </div>
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
        <RetrainAICard />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Sparkles className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">No AI Measurement Available</p>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              Click "Generate AI Baseline" above to run the AI skeleton detection algorithm.
              This creates an independent measurement you can compare against your traces.
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
      {/* Data Corruption Warning - Original AI data was overwritten */}
      {isDataCorrupted && (
        <Alert variant="destructive" className="border-orange-300 bg-orange-50 text-orange-800">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="text-orange-800">Original AI Data Missing</AlertTitle>
          <AlertDescription className="text-orange-700">
            <p className="mb-2">
              The original AI skeleton measurement was overwritten. The "AI Measurements" panel 
              currently shows your traced lines, not the AI's independent detection. This makes 
              accuracy comparison meaningless (0% variance).
            </p>
            <p className="mb-3">
              Click below to generate a fresh AI skeleton measurement. This will run the geometric 
              detection algorithm again WITHOUT any corrections, so you can see where the AI places 
              ridge, hip, valley lines independently.
            </p>
            <Button 
              onClick={handleRunAIMeasure} 
              disabled={isRunningAIMeasure || !session?.lat}
              variant="secondary"
              size="sm"
              className="bg-orange-100 hover:bg-orange-200 border-orange-300"
            >
              {isRunningAIMeasure ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {isRunningAIMeasure ? 'Generating fresh AI skeleton...' : 'Generate Fresh AI Measurement'}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* View Mode Toggle - Switch between Original AI and Corrected AI */}
      {correctedAiMeasurementId && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="py-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <Zap className="h-4 w-4 text-blue-600" />
                <span className="text-blue-700 font-medium">
                  {viewMode === 'corrected' 
                    ? 'Showing CORRECTED Measurement (your traces applied)'
                    : 'Showing ORIGINAL AI (independent skeleton detection)'
                  }
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={viewMode === 'original' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('original')}
                >
                  <Brain className="h-3 w-3 mr-1" />
                  Original AI
                </Button>
                <Button
                  variant={viewMode === 'corrected' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('corrected')}
                  className={viewMode === 'corrected' ? 'bg-green-600 hover:bg-green-700' : 'border-green-500 text-green-600 hover:bg-green-50'}
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Corrected
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Show original AI indicator when no corrected version exists */}
      {session?.original_ai_measurement_id && !correctedAiMeasurementId && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-blue-600" />
              <span className="text-blue-700 font-medium">
                Showing ORIGINAL AI Measurement (independent detection, not trained)
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Retrain AI Button */}
      <RetrainAICard />
      
      {/* Learned Corrections Summary */}
      <LearnedCorrectionsCard />

      {/* Verification Metrics (Phase 4) */}
      {(lastEngineUsed || activeRows.length > 0) && (
        <TrainingVerificationMetrics
          engineUsed={lastEngineUsed}
          deviations={activeRows.map(row => ({
            featureType: row.label.toLowerCase(),
            avgDeviationFt: Math.abs(row.variance),
            alignmentScore: row.variancePct === 0 ? 1 : Math.max(0, 1 - Math.abs(row.variancePct) / 100),
            needsCorrection: Math.abs(row.variancePct) > 0,
          }))}
          beforeAccuracy={undefined}
          afterAccuracy={viewMode === 'corrected' ? overallAccuracy : undefined}
          missingFeatures={activeRows.filter(r => r.ai === 0 && r.manual > 0).length}
          correctedFeatures={viewMode === 'corrected' ? activeRows.filter(r => Math.abs(r.variancePct) < 5).length : 0}
        />
      )}

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
          viewMode={viewMode}
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
