// =====================================================
// Phase 75: Measurement Comparison Overlay
// Visual comparison of AI vs Ground Truth measurements
// =====================================================

import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';

interface MeasurementValue {
  value: number;
  unit: string;
  confidence?: number;
}

interface ComparisonData {
  metric: string;
  label: string;
  ai: MeasurementValue;
  groundTruth: MeasurementValue;
  tolerance: number; // Percentage tolerance
}

interface MeasurementComparisonOverlayProps {
  aiMeasurements: Record<string, number>;
  groundTruthMeasurements: Record<string, number>;
  tolerancePercent?: number;
  onAcceptAI?: () => void;
  onAcceptGroundTruth?: () => void;
  onManualOverride?: (metric: string, value: number) => void;
  className?: string;
}

// Calculate variance and status
function calculateVariance(
  ai: number,
  truth: number,
  tolerance: number
): { variance: number; percentDiff: number; status: 'pass' | 'warning' | 'fail' } {
  const diff = ai - truth;
  const percentDiff = truth !== 0 ? (diff / truth) * 100 : 0;
  const absPercent = Math.abs(percentDiff);

  let status: 'pass' | 'warning' | 'fail' = 'pass';
  if (absPercent > tolerance * 2) status = 'fail';
  else if (absPercent > tolerance) status = 'warning';

  return { variance: diff, percentDiff, status };
}

export function MeasurementComparisonOverlay({
  aiMeasurements,
  groundTruthMeasurements,
  tolerancePercent = 2,
  onAcceptAI,
  onAcceptGroundTruth,
  onManualOverride,
  className,
}: MeasurementComparisonOverlayProps) {
  const [showOverlay, setShowOverlay] = useState(true);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  // Build comparison data
  const comparisons = useMemo(() => {
    const metrics = [
      { key: 'total_area', label: 'Total Area', unit: 'sq ft', tolerance: 2 },
      { key: 'ridge_length', label: 'Ridge', unit: 'ft', tolerance: 3 },
      { key: 'hip_length', label: 'Hip', unit: 'ft', tolerance: 3 },
      { key: 'valley_length', label: 'Valley', unit: 'ft', tolerance: 3 },
      { key: 'eave_length', label: 'Eave', unit: 'ft', tolerance: 2 },
      { key: 'rake_length', label: 'Rake', unit: 'ft', tolerance: 2 },
    ];

    return metrics.map((m) => {
      const aiValue = aiMeasurements[m.key] || 0;
      const truthValue = groundTruthMeasurements[m.key] || 0;
      const { variance, percentDiff, status } = calculateVariance(
        aiValue,
        truthValue,
        m.tolerance
      );

      return {
        ...m,
        aiValue,
        truthValue,
        variance,
        percentDiff,
        status,
      };
    });
  }, [aiMeasurements, groundTruthMeasurements]);

  // Calculate overall accuracy
  const overallAccuracy = useMemo(() => {
    const withValues = comparisons.filter((c) => c.truthValue > 0);
    if (withValues.length === 0) return 100;

    const accuracies = withValues.map((c) => Math.max(0, 100 - Math.abs(c.percentDiff)));
    return accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
  }, [comparisons]);

  const passCount = comparisons.filter((c) => c.status === 'pass').length;
  const warningCount = comparisons.filter((c) => c.status === 'warning').length;
  const failCount = comparisons.filter((c) => c.status === 'fail').length;

  const getStatusIcon = (status: 'pass' | 'warning' | 'fail') => {
    switch (status) {
      case 'pass':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'fail':
        return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getTrendIcon = (percentDiff: number) => {
    if (percentDiff > 1) return <TrendingUp className="h-3 w-3 text-red-500" />;
    if (percentDiff < -1) return <TrendingDown className="h-3 w-3 text-blue-500" />;
    return <Minus className="h-3 w-3 text-green-500" />;
  };

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">AI vs Ground Truth Comparison</CardTitle>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={showOverlay} onCheckedChange={setShowOverlay} />
              Show Overlay
            </label>
          </div>
        </div>

        {/* Summary badges */}
        <div className="flex items-center gap-2 mt-2">
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {passCount} Pass
          </Badge>
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
            <AlertTriangle className="h-3 w-3 mr-1" />
            {warningCount} Warning
          </Badge>
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
            <XCircle className="h-3 w-3 mr-1" />
            {failCount} Fail
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Overall Accuracy:</span>
            <Badge
              variant={overallAccuracy >= 98 ? 'default' : overallAccuracy >= 95 ? 'secondary' : 'destructive'}
            >
              {overallAccuracy.toFixed(1)}%
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="table">
          <TabsList className="mb-4">
            <TabsTrigger value="table">Table View</TabsTrigger>
            <TabsTrigger value="chart">Chart View</TabsTrigger>
          </TabsList>

          <TabsContent value="table">
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3">Metric</th>
                    <th className="text-right p-3">AI Value</th>
                    <th className="text-center p-3 w-8"></th>
                    <th className="text-right p-3">Ground Truth</th>
                    <th className="text-right p-3">Variance</th>
                    <th className="text-center p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisons.map((comp) => (
                    <tr
                      key={comp.key}
                      className={cn(
                        'border-t cursor-pointer hover:bg-muted/30 transition-colors',
                        selectedMetric === comp.key && 'bg-primary/10'
                      )}
                      onClick={() => setSelectedMetric(comp.key)}
                    >
                      <td className="p-3 font-medium">{comp.label}</td>
                      <td className="p-3 text-right font-mono">
                        {comp.aiValue.toFixed(1)} {comp.unit}
                      </td>
                      <td className="p-3 text-center">
                        <ArrowRight className="h-4 w-4 text-muted-foreground inline" />
                      </td>
                      <td className="p-3 text-right font-mono text-green-600">
                        {comp.truthValue.toFixed(1)} {comp.unit}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {getTrendIcon(comp.percentDiff)}
                          <span
                            className={cn(
                              'font-mono',
                              comp.percentDiff > 0 ? 'text-red-600' : 'text-blue-600'
                            )}
                          >
                            {comp.percentDiff > 0 ? '+' : ''}
                            {comp.percentDiff.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-center">{getStatusIcon(comp.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="chart">
            <div className="space-y-4">
              {comparisons.map((comp) => (
                <div key={comp.key} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{comp.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        AI: {comp.aiValue.toFixed(1)} | Truth: {comp.truthValue.toFixed(1)}
                      </span>
                      {getStatusIcon(comp.status)}
                    </div>
                  </div>
                  <div className="relative h-6 bg-muted rounded-full overflow-hidden">
                    {/* Ground truth bar (background) */}
                    <div
                      className="absolute inset-y-0 left-0 bg-green-200 rounded-full"
                      style={{ width: '100%' }}
                    />
                    {/* AI bar (overlay) */}
                    <div
                      className={cn(
                        'absolute inset-y-0 left-0 rounded-full transition-all',
                        comp.status === 'pass' && 'bg-green-500',
                        comp.status === 'warning' && 'bg-yellow-500',
                        comp.status === 'fail' && 'bg-red-500'
                      )}
                      style={{
                        width: `${Math.min(100, (comp.aiValue / Math.max(comp.truthValue, 1)) * 100)}%`,
                      }}
                    />
                    {/* Center line at 100% */}
                    <div className="absolute inset-y-0 left-[100%] w-0.5 bg-green-700 -translate-x-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="outline" onClick={onAcceptGroundTruth}>
            Accept Ground Truth
          </Button>
          <Button onClick={onAcceptAI} disabled={failCount > 0}>
            Accept AI Measurements
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Segment-level comparison visualization
interface SegmentComparisonProps {
  segmentId: string;
  aiLength: number;
  truthLength: number;
  tolerance: number;
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  containerWidth: number;
  containerHeight: number;
}

export function SegmentComparisonArrow({
  segmentId,
  aiLength,
  truthLength,
  tolerance,
  startPoint,
  endPoint,
  containerWidth,
  containerHeight,
}: SegmentComparisonProps) {
  const { variance, percentDiff, status } = calculateVariance(aiLength, truthLength, tolerance);

  const midX = ((startPoint.x + endPoint.x) / 2) * containerWidth;
  const midY = ((startPoint.y + endPoint.y) / 2) * containerHeight;

  // Arrow direction based on AI being over or under
  const arrowDirection = variance > 0 ? 'up' : variance < 0 ? 'down' : 'none';

  const arrowColor =
    status === 'pass' ? '#22c55e' : status === 'warning' ? '#eab308' : '#ef4444';

  if (Math.abs(percentDiff) < 0.5) return null; // Don't show for tiny differences

  return (
    <g className="segment-comparison-arrow">
      {/* Deviation line */}
      <line
        x1={midX}
        y1={midY}
        x2={midX}
        y2={midY + (arrowDirection === 'down' ? 20 : -20)}
        stroke={arrowColor}
        strokeWidth={2}
        markerEnd="url(#arrowhead)"
      />
      {/* Label */}
      <text
        x={midX + 15}
        y={midY}
        fill={arrowColor}
        fontSize={10}
        fontWeight="bold"
      >
        {percentDiff > 0 ? '+' : ''}{percentDiff.toFixed(1)}%
      </text>
    </g>
  );
}

export default MeasurementComparisonOverlay;
