import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Cpu, Eye, TrendingUp, TrendingDown, Activity, Target } from 'lucide-react';

interface TrainingVerificationMetricsProps {
  engineUsed: string | null;
  deviations: Array<{
    featureType: string;
    avgDeviationFt: number;
    alignmentScore: number;
    needsCorrection: boolean;
  }>;
  beforeAccuracy?: number;
  afterAccuracy?: number;
  missingFeatures?: number;
  correctedFeatures?: number;
}

export function TrainingVerificationMetrics({
  engineUsed,
  deviations,
  beforeAccuracy,
  afterAccuracy,
  missingFeatures = 0,
  correctedFeatures = 0,
}: TrainingVerificationMetricsProps) {
  // Calculate deviation stats by feature type
  const deviationsByType = deviations.reduce((acc, d) => {
    if (!acc[d.featureType]) {
      acc[d.featureType] = { total: 0, count: 0, needsCorrection: 0 };
    }
    acc[d.featureType].total += d.avgDeviationFt;
    acc[d.featureType].count += 1;
    if (d.needsCorrection) acc[d.featureType].needsCorrection += 1;
    return acc;
  }, {} as Record<string, { total: number; count: number; needsCorrection: number }>);

  const avgDeviationByType = Object.entries(deviationsByType).map(([type, data]) => ({
    type,
    avgDeviation: data.total / data.count,
    needsCorrection: data.needsCorrection,
    count: data.count,
  }));

  // Calculate improvement if before/after available
  const improvement = beforeAccuracy && afterAccuracy 
    ? afterAccuracy - beforeAccuracy 
    : null;

  return (
    <Card className="border-muted bg-muted/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4" />
          Training Verification Metrics
        </CardTitle>
        <CardDescription className="text-xs">
          Debug information for AI training pipeline
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Engine Used */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">AI Engine:</span>
          <Badge 
            variant="outline" 
            className={engineUsed === 'vision' 
              ? 'bg-blue-50 text-blue-700 border-blue-200' 
              : 'bg-gray-50 text-gray-700 border-gray-200'
            }
          >
            {engineUsed === 'vision' ? (
              <><Eye className="h-3 w-3 mr-1" /> Vision (AI)</>
            ) : engineUsed === 'skeleton' ? (
              <><Cpu className="h-3 w-3 mr-1" /> Skeleton (Geometric)</>
            ) : (
              'Not yet run'
            )}
          </Badge>
        </div>

        {/* Before/After Improvement */}
        {improvement !== null && (
          <div className="flex items-center justify-between p-2 rounded bg-background">
            <span className="text-sm">Improvement:</span>
            <div className="flex items-center gap-2">
              {improvement > 0 ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : improvement < 0 ? (
                <TrendingDown className="h-4 w-4 text-red-500" />
              ) : null}
              <span className={`font-medium ${improvement > 0 ? 'text-green-600' : improvement < 0 ? 'text-red-600' : ''}`}>
                {improvement > 0 ? '+' : ''}{improvement.toFixed(1)}%
              </span>
            </div>
          </div>
        )}

        {/* Deviation by Feature Type */}
        {avgDeviationByType.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">Avg Deviation by Type:</span>
            <div className="grid grid-cols-2 gap-2">
              {avgDeviationByType.map(({ type, avgDeviation, needsCorrection, count }) => (
                <div 
                  key={type} 
                  className={`p-2 rounded text-xs ${
                    needsCorrection > 0 ? 'bg-orange-50 border border-orange-200' : 'bg-green-50 border border-green-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{type}</span>
                    <Target className={`h-3 w-3 ${needsCorrection > 0 ? 'text-orange-500' : 'text-green-500'}`} />
                  </div>
                  <div className="text-muted-foreground">
                    {avgDeviation.toFixed(1)} ft avg
                  </div>
                  {needsCorrection > 0 && (
                    <div className="text-orange-600 text-[10px]">
                      {needsCorrection}/{count} need fix
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary Stats */}
        <div className="flex items-center justify-between text-xs border-t pt-3">
          <div className="flex gap-4">
            {missingFeatures > 0 && (
              <span className="text-red-600">
                {missingFeatures} missing
              </span>
            )}
            {correctedFeatures > 0 && (
              <span className="text-green-600">
                {correctedFeatures} corrected
              </span>
            )}
          </div>
          <span className="text-muted-foreground">
            {deviations.length} features evaluated
          </span>
        </div>

        {/* Overall Progress */}
        {deviations.length > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span>Features matching (0ft tolerance):</span>
              <span className="font-medium">
                {deviations.filter(d => !d.needsCorrection).length}/{deviations.length}
              </span>
            </div>
            <Progress 
              value={(deviations.filter(d => !d.needsCorrection).length / deviations.length) * 100} 
              className="h-2"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
