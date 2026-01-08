import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, RefreshCw, TrendingUp, TrendingDown, Minus, Brain, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface CorrectionFactor {
  id: string;
  feature_type: string;
  correction_multiplier: number;
  sample_count: number;
  confidence: number;
  total_ai_ft: number;
  total_manual_ft: number;
  avg_variance_pct: number;
  last_updated: string;
}

interface TrainingStats {
  total_sessions: number;
  completed_sessions: number;
  total_traces: number;
  feature_variances: {
    feature_type: string;
    ai_total: number;
    manual_total: number;
    variance_pct: number;
    sample_count: number;
  }[];
}

export function TrainingAnalyticsDashboard() {
  const queryClient = useQueryClient();
  const [isRecalculating, setIsRecalculating] = useState(false);

  // Fetch current correction factors
  const { data: correctionFactors, isLoading: loadingFactors } = useQuery({
    queryKey: ['correction-factors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('measurement_correction_factors')
        .select('*')
        .order('feature_type');
      if (error) throw error;
      return data as CorrectionFactor[];
    },
  });

  // Fetch training statistics
  const { data: trainingStats, isLoading: loadingStats } = useQuery({
    queryKey: ['training-stats'],
    queryFn: async () => {
      // Get session counts - cast to any to avoid type issues with new columns
      const { data: sessionsRaw, error: sessionsError } = await supabase
        .from('roof_training_sessions')
        .select('id, status, ai_measurement_id, ai_totals, traced_totals') as { data: any[] | null; error: any };
      
      if (sessionsError) throw sessionsError;

      const sessions = sessionsRaw || [];

      // Get trace count
      const { count: traceCount, error: tracesError } = await supabase
        .from('roof_training_traces')
        .select('id', { count: 'exact', head: true });
      
      if (tracesError) throw tracesError;

      const completedSessions = sessions.filter((s: any) => s.status === 'completed');
      
      // Calculate feature variances from completed sessions
      const featureVariances: Record<string, { ai_total: number; manual_total: number; count: number }> = {
        ridge: { ai_total: 0, manual_total: 0, count: 0 },
        hip: { ai_total: 0, manual_total: 0, count: 0 },
        valley: { ai_total: 0, manual_total: 0, count: 0 },
        eave: { ai_total: 0, manual_total: 0, count: 0 },
        rake: { ai_total: 0, manual_total: 0, count: 0 },
      };

      completedSessions.forEach((session: any) => {
        const aiTotals = session.ai_totals as Record<string, number> | null;
        const tracedTotals = session.traced_totals as Record<string, number> | null;
        
        if (aiTotals && tracedTotals) {
          Object.keys(featureVariances).forEach(feature => {
            const aiVal = aiTotals[feature] || aiTotals[`${feature}_ft`] || 0;
            const manualVal = tracedTotals[feature] || tracedTotals[`${feature}_ft`] || 0;
            
            if (manualVal > 0) {
              featureVariances[feature].ai_total += aiVal;
              featureVariances[feature].manual_total += manualVal;
              featureVariances[feature].count++;
            }
          });
        }
      });

      const stats: TrainingStats = {
        total_sessions: sessions.length,
        completed_sessions: completedSessions.length,
        total_traces: traceCount || 0,
        feature_variances: Object.entries(featureVariances).map(([type, data]) => ({
          feature_type: type,
          ai_total: data.ai_total,
          manual_total: data.manual_total,
          variance_pct: data.manual_total > 0 
            ? ((data.ai_total - data.manual_total) / data.manual_total) * 100 
            : 0,
          sample_count: data.count,
        })),
      };

      return stats;
    },
  });

  // Recalculate corrections mutation
  const recalculateMutation = useMutation({
    mutationFn: async () => {
      setIsRecalculating(true);
      const { data, error } = await supabase.functions.invoke('calculate-measurement-corrections');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Corrections recalculated from ${data.sessions_analyzed} sessions`);
      queryClient.invalidateQueries({ queryKey: ['correction-factors'] });
      setIsRecalculating(false);
    },
    onError: (error) => {
      toast.error('Failed to recalculate corrections: ' + (error as Error).message);
      setIsRecalculating(false);
    },
  });

  const getVarianceIcon = (variance: number) => {
    if (Math.abs(variance) < 3) return <Minus className="h-4 w-4 text-muted-foreground" />;
    if (variance > 0) return <TrendingUp className="h-4 w-4 text-destructive" />;
    return <TrendingDown className="h-4 w-4 text-yellow-500" />;
  };

  const getVarianceBadge = (variance: number) => {
    const absVariance = Math.abs(variance);
    if (absVariance < 3) return <Badge variant="secondary">Accurate</Badge>;
    if (absVariance < 10) return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Minor Bias</Badge>;
    return <Badge variant="destructive">Significant Bias</Badge>;
  };

  const getConfidenceBadge = (confidence: number, sampleCount: number) => {
    if (sampleCount < 3) return <Badge variant="outline">Low Data</Badge>;
    if (confidence > 0.8) return <Badge className="bg-green-600">High</Badge>;
    if (confidence > 0.5) return <Badge variant="secondary">Medium</Badge>;
    return <Badge variant="outline">Low</Badge>;
  };

  const featureLabels: Record<string, string> = {
    ridge: 'Ridge',
    hip: 'Hip',
    valley: 'Valley',
    eave: 'Eave',
    rake: 'Rake',
  };

  if (loadingFactors || loadingStats) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasCorrections = correctionFactors && correctionFactors.length > 0;
  const hasTrainingData = trainingStats && trainingStats.completed_sessions > 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Training Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{trainingStats?.total_sessions || 0}</div>
            <p className="text-xs text-muted-foreground">
              {trainingStats?.completed_sessions || 0} completed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Traces</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{trainingStats?.total_traces || 0}</div>
            <p className="text-xs text-muted-foreground">Ground truth segments</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">AI Learning Status</CardTitle>
          </CardHeader>
          <CardContent>
            {hasCorrections ? (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="font-medium text-green-600">Active</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                <span className="font-medium text-yellow-600">Not Trained</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {hasCorrections ? 'Corrections applied to measurements' : 'Complete training sessions to enable'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Retrain AI</CardTitle>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={() => recalculateMutation.mutate()}
              disabled={isRecalculating || !hasTrainingData}
              size="sm"
              className="w-full"
            >
              {isRecalculating ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Brain className="h-4 w-4 mr-2" />
              )}
              Recalculate
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              {hasTrainingData 
                ? 'Update corrections from latest training data'
                : 'Complete training sessions first'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Feature Variance Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            AI vs Manual Variance Analysis
          </CardTitle>
          <CardDescription>
            Shows how AI measurements compare to your traced ground truth data
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!hasTrainingData ? (
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No training data available yet.</p>
              <p className="text-sm">Complete training sessions to see variance analysis.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {trainingStats?.feature_variances.map((feature) => (
                <div key={feature.feature_type} className="flex items-center gap-4">
                  <div className="w-16 font-medium">{featureLabels[feature.feature_type]}</div>
                  
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-muted-foreground">
                        AI: {feature.ai_total.toFixed(0)}ft | Manual: {feature.manual_total.toFixed(0)}ft
                      </span>
                      <div className="flex items-center gap-2">
                        {getVarianceIcon(feature.variance_pct)}
                        <span className={`text-sm font-medium ${
                          feature.variance_pct > 0 ? 'text-destructive' : 
                          feature.variance_pct < 0 ? 'text-yellow-600' : ''
                        }`}>
                          {feature.variance_pct > 0 ? '+' : ''}{feature.variance_pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <Progress 
                      value={50 + Math.min(Math.max(feature.variance_pct, -50), 50)} 
                      className="h-2"
                    />
                  </div>
                  
                  <div className="w-28 text-right">
                    {getVarianceBadge(feature.variance_pct)}
                  </div>
                  
                  <div className="w-24 text-right text-sm text-muted-foreground">
                    {feature.sample_count} samples
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Correction Factors */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Active Correction Factors
            </CardTitle>
            <CardDescription>
              Learned multipliers applied to AI measurements
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {!hasCorrections ? (
            <div className="text-center py-8 text-muted-foreground">
              <RefreshCw className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No correction factors calculated yet.</p>
              <p className="text-sm">Click "Recalculate" after completing training sessions.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {correctionFactors?.map((factor) => (
                <div key={factor.id} className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                  <div className="w-16 font-medium">{featureLabels[factor.feature_type]}</div>
                  
                  <div className="flex-1 flex items-center gap-4">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Multiplier: </span>
                      <span className={`font-mono font-bold ${
                        factor.correction_multiplier > 1 ? 'text-green-600' :
                        factor.correction_multiplier < 1 ? 'text-yellow-600' : ''
                      }`}>
                        {factor.correction_multiplier.toFixed(4)}×
                      </span>
                    </div>
                    
                    <div className="text-sm text-muted-foreground">
                      Avg variance: {factor.avg_variance_pct?.toFixed(1) || 0}%
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {getConfidenceBadge(factor.confidence, factor.sample_count)}
                    <span className="text-xs text-muted-foreground">
                      ({factor.sample_count} samples)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
