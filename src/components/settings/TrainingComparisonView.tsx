import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, AlertTriangle, BarChart2, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
interface TrainingComparisonViewProps {
  sessionId: string;
  aiMeasurementId?: string;
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

export function TrainingComparisonView({ sessionId, aiMeasurementId, manualTotals }: TrainingComparisonViewProps) {
  const [isRetraining, setIsRetraining] = useState(false);

  const handleRetrainAI = async () => {
    setIsRetraining(true);
    try {
      const { data, error } = await supabase.functions.invoke('calculate-measurement-corrections');
      
      if (error) throw error;
      
      const sessionsAnalyzed = data?.sessions_analyzed || 0;
      const factorsUpdated = data?.corrections?.length || 0;
      
      toast.success(`AI Retrained! Analyzed ${sessionsAnalyzed} sessions, updated ${factorsUpdated} correction factors.`);
    } catch (err: any) {
      console.error('Failed to retrain AI:', err);
      toast.error(err.message || 'Failed to recalculate corrections');
    } finally {
      setIsRetraining(false);
    }
  };

  // Retrain AI button component - rendered in all states
  const RetrainAICard = () => (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Retrain AI with Your Traces</p>
            <p className="text-sm text-muted-foreground">
              Apply your manual corrections to improve future AI measurements
            </p>
          </div>
          <Button onClick={handleRetrainAI} disabled={isRetraining}>
            {isRetraining ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {isRetraining ? 'Retraining...' : 'Retrain AI'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
  // Fetch AI measurement data if available
  const { data: aiMeasurement } = useQuery({
    queryKey: ['ai-measurement', aiMeasurementId],
    queryFn: async () => {
      if (!aiMeasurementId) return null;
      
      const { data, error } = await supabase
        .from('roof_measurements')
        .select('*')
        .eq('id', aiMeasurementId)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!aiMeasurementId,
  });

  // Calculate comparison data - use correct column names from schema
  const aiTotals = {
    ridge: (aiMeasurement as any)?.ridge_length_ft || 0,
    hip: (aiMeasurement as any)?.hip_length_ft || 0,
    valley: (aiMeasurement as any)?.valley_length_ft || 0,
    eave: (aiMeasurement as any)?.eave_length_ft || 0,
    rake: (aiMeasurement as any)?.rake_length_ft || 0,
    perimeter: (aiMeasurement as any)?.perimeter_ft || 0,
  };

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

  const getVarianceColor = (pct: number) => {
    const absPct = Math.abs(pct);
    if (absPct <= 5) return 'text-green-500';
    if (absPct <= 15) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getVarianceIcon = (pct: number) => {
    const absPct = Math.abs(pct);
    if (absPct <= 5) return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (absPct <= 15) return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <XCircle className="h-4 w-4 text-red-500" />;
  };

  if (!aiMeasurementId) {
    return (
      <div className="space-y-6">
        <RetrainAICard />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BarChart2 className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">No AI Measurement Available</p>
            <p className="text-muted-foreground text-center max-w-md">
              This lead doesn't have an AI measurement to compare against. 
              Run the AI measurement first to enable comparison.
            </p>
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
            {activeRows.map((row) => (
              <div key={row.label} className="grid grid-cols-5 gap-4 items-center py-2 border-b border-dashed last:border-0">
                <div className="font-medium">{row.label}</div>
                <div className="text-right">{Math.round(row.manual)}</div>
                <div className="text-right">{Math.round(row.ai)}</div>
                <div className={`text-right font-medium ${getVarianceColor(row.variancePct)}`}>
                  {row.variancePct > 0 ? '+' : ''}{row.variancePct.toFixed(1)}%
                  <span className="text-xs text-muted-foreground ml-1">
                    ({row.variance > 0 ? '+' : ''}{Math.round(row.variance)} ft)
                  </span>
                </div>
                <div className="flex justify-end">
                  {getVarianceIcon(row.variancePct)}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Within 5% (Excellent)</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span>5-15% (Acceptable)</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span>15%+ (Needs Review)</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
