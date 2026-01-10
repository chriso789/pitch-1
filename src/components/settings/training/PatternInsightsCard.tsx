import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Lightbulb, TrendingUp, TrendingDown, Building2, Loader2 } from 'lucide-react';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';

interface LearnedPattern {
  building_shape: string;
  roof_type: string;
  line_type: string;
  avg_correction_offset: number;
  confidence_boost: number;
  sample_count: number;
}

interface ErrorPattern {
  pattern: string;
  avg_deviation: number;
  correction_count: number;
  suggested_adjustment: string;
}

export function PatternInsightsCard() {
  const { activeCompanyId } = useCompanySwitcher();

  // Fetch learned patterns from measurement_corrections
  const { data: patterns, isLoading } = useQuery({
    queryKey: ['learned-patterns', activeCompanyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('measurement_corrections')
        .select('building_shape, roof_type, original_line_type, deviation_ft, deviation_pct')
        .eq('tenant_id', activeCompanyId!)
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      // Aggregate patterns
      const patternMap = new Map<string, {
        count: number;
        totalDeviation: number;
        totalPct: number;
      }>();

      (data || []).forEach((row: any) => {
        const key = `${row.building_shape || 'unknown'}|${row.roof_type || 'unknown'}|${row.original_line_type || 'unknown'}`;
        const existing = patternMap.get(key) || { count: 0, totalDeviation: 0, totalPct: 0 };
        patternMap.set(key, {
          count: existing.count + 1,
          totalDeviation: existing.totalDeviation + (row.deviation_ft || 0),
          totalPct: existing.totalPct + Math.abs(row.deviation_pct || 0),
        });
      });

      const learned: LearnedPattern[] = [];
      patternMap.forEach((value, key) => {
        const [buildingShape, roofType, lineType] = key.split('|');
        if (value.count >= 3) { // Minimum 3 samples for confidence
          learned.push({
            building_shape: buildingShape,
            roof_type: roofType,
            line_type: lineType,
            avg_correction_offset: value.totalDeviation / value.count,
            confidence_boost: Math.min(0.15, value.count * 0.01), // Up to 15% boost
            sample_count: value.count,
          });
        }
      });

      return learned.sort((a, b) => b.sample_count - a.sample_count).slice(0, 10);
    },
    enabled: !!activeCompanyId,
  });

  // Fetch error patterns (most common deviations)
  const { data: errorPatterns } = useQuery({
    queryKey: ['error-patterns', activeCompanyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('measurement_corrections')
        .select('building_shape, roof_type, original_line_type, deviation_ft')
        .eq('tenant_id', activeCompanyId!)
        .gt('deviation_ft', 2) // Only significant deviations
        .order('deviation_ft', { ascending: false })
        .limit(100);

      if (error) throw error;

      // Group by line type to find common errors
      const errorMap = new Map<string, { count: number; totalDev: number }>();
      (data || []).forEach((row: any) => {
        const key = `${row.original_line_type}|${row.building_shape || 'any'}`;
        const existing = errorMap.get(key) || { count: 0, totalDev: 0 };
        errorMap.set(key, {
          count: existing.count + 1,
          totalDev: existing.totalDev + (row.deviation_ft || 0),
        });
      });

      const errors: ErrorPattern[] = [];
      errorMap.forEach((value, key) => {
        const [lineType, buildingShape] = key.split('|');
        if (value.count >= 2) {
          const avgDev = value.totalDev / value.count;
          errors.push({
            pattern: `${lineType} on ${buildingShape} roofs`,
            avg_deviation: avgDev,
            correction_count: value.count,
            suggested_adjustment: avgDev > 0 
              ? `AI typically places ${lineType} ${Math.abs(avgDev).toFixed(1)}ft too long`
              : `AI typically places ${lineType} ${Math.abs(avgDev).toFixed(1)}ft too short`,
          });
        }
      });

      return errors.sort((a, b) => b.correction_count - a.correction_count).slice(0, 5);
    },
    enabled: !!activeCompanyId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const hasPatterns = patterns && patterns.length > 0;
  const hasErrors = errorPatterns && errorPatterns.length > 0;

  if (!hasPatterns && !hasErrors) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lightbulb className="h-4 w-4" />
            Pattern Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground">
            <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No patterns learned yet.</p>
            <p className="text-xs">Complete more training sessions to see insights.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-4 w-4" />
          Pattern Insights
        </CardTitle>
        <CardDescription>
          AI has learned these patterns from your training sessions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Learned Patterns */}
        {hasPatterns && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5 text-green-500" />
              Learned Adjustments
            </h4>
            <div className="space-y-2">
              {patterns?.map((pattern, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 bg-green-50 dark:bg-green-950/20 rounded text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">{pattern.line_type}</Badge>
                    <span className="text-muted-foreground text-xs">
                      {pattern.building_shape} / {pattern.roof_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {pattern.sample_count} samples
                    </span>
                    <Badge className="bg-green-500 text-white text-xs">
                      +{(pattern.confidence_boost * 100).toFixed(0)}% confidence
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Common Errors */}
        {hasErrors && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1">
              <TrendingDown className="h-3.5 w-3.5 text-yellow-500" />
              Common Error Patterns
            </h4>
            <div className="space-y-2">
              {errorPatterns?.map((error, idx) => (
                <div
                  key={idx}
                  className="p-2 bg-yellow-50 dark:bg-yellow-950/20 rounded text-sm"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium capitalize">{error.pattern}</span>
                    <Badge variant="outline" className="text-xs">
                      {error.correction_count} corrections
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {error.suggested_adjustment}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Overall Stats */}
        {hasPatterns && (
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total patterns learned</span>
              <span className="font-medium">{patterns?.length || 0}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Avg confidence boost</span>
              <span className="font-medium text-green-600">
                +{((patterns?.reduce((s, p) => s + p.confidence_boost, 0) || 0) / (patterns?.length || 1) * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
