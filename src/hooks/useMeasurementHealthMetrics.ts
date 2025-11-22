import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, subDays, format as formatDate } from 'date-fns';

interface QualityMetrics {
  totalMeasurements: number;
  avgCoordinateAccuracy: number;
  visualizationSuccessRate: number;
  manualRegenerationCount: number;
  criticalCount: number;
  highCount: number;
  goodCount: number;
  excellentCount: number;
}

interface AccuracyTrend {
  date: string;
  avgOffset: number;
  count: number;
}

interface QualityDistribution {
  name: string;
  value: number;
  color: string;
}

interface ProblemMeasurement {
  id: string;
  coordinate_mismatch_distance: number;
  created_at: string;
  property_id: string;
  address: string;
  city: string;
}

export function useMeasurementHealthMetrics() {
  const { data: metrics, isLoading: metricsLoading, refetch: refetchMetrics } = useQuery({
    queryKey: ['measurement-health-metrics'],
    queryFn: async () => {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();

      const { data, error } = await supabase
        .from('measurements')
        .select('id, visualization_metadata, mapbox_visualization_url, created_at')
        .gte('created_at', thirtyDaysAgo);

      if (error) throw error;

      const totalMeasurements = data.length;
      const successfulVisualizations = data.filter(m => m.mapbox_visualization_url).length;
      
      // Extract coordinate mismatch from visualization_metadata
      const offsets = data
        .map(m => {
          const metadata = m.visualization_metadata as any;
          return metadata?.coordinate_mismatch_distance || 0;
        })
        .filter(offset => offset > 0);
      
      const avgCoordinateAccuracy = offsets.length > 0 
        ? offsets.reduce((sum, val) => sum + val, 0) / offsets.length 
        : 0;

      const manualRegenerationCount = data.filter(m => {
        const metadata = m.visualization_metadata as any;
        return (metadata?.regeneration_count || 0) > 0;
      }).length;

      const excellentCount = data.filter(m => {
        const metadata = m.visualization_metadata as any;
        return (metadata?.coordinate_mismatch_distance || 0) < 10;
      }).length;

      const goodCount = data.filter(m => {
        const metadata = m.visualization_metadata as any;
        const dist = metadata?.coordinate_mismatch_distance || 0;
        return dist >= 10 && dist < 30;
      }).length;

      const highCount = data.filter(m => {
        const metadata = m.visualization_metadata as any;
        const dist = metadata?.coordinate_mismatch_distance || 0;
        return dist >= 30 && dist <= 50;
      }).length;

      const criticalCount = data.filter(m => {
        const metadata = m.visualization_metadata as any;
        return (metadata?.coordinate_mismatch_distance || 0) > 50;
      }).length;

      return {
        totalMeasurements,
        avgCoordinateAccuracy,
        visualizationSuccessRate: totalMeasurements > 0 ? (successfulVisualizations / totalMeasurements) * 100 : 0,
        manualRegenerationCount,
        criticalCount,
        highCount,
        goodCount,
        excellentCount,
      } as QualityMetrics;
    },
    refetchInterval: 60000, // Auto-refresh every 60 seconds
  });

  const { data: accuracyTrend, isLoading: trendLoading } = useQuery({
    queryKey: ['measurement-accuracy-trend'],
    queryFn: async () => {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();

      const { data, error } = await supabase
        .from('measurements')
        .select('visualization_metadata, created_at')
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Group by day
      const dailyData: Record<string, { sum: number; count: number }> = {};
      
      data.forEach(m => {
        const day = formatDate(startOfDay(new Date(m.created_at)), 'yyyy-MM-dd');
        if (!dailyData[day]) {
          dailyData[day] = { sum: 0, count: 0 };
        }
        const metadata = m.visualization_metadata as any;
        const distance = metadata?.coordinate_mismatch_distance || 0;
        if (distance > 0) {
          dailyData[day].sum += distance;
          dailyData[day].count += 1;
        }
      });

      return Object.entries(dailyData).map(([date, stats]) => ({
        date: formatDate(new Date(date), 'MMM d'),
        avgOffset: stats.count > 0 ? stats.sum / stats.count : 0,
        count: stats.count,
      })) as AccuracyTrend[];
    },
    refetchInterval: 60000,
  });

  const { data: qualityDistribution, isLoading: distributionLoading } = useQuery({
    queryKey: ['measurement-quality-distribution'],
    queryFn: async () => {
      if (!metrics) return [];

      return [
        { name: 'Excellent (<10m)', value: metrics.excellentCount, color: 'hsl(var(--chart-1))' },
        { name: 'Good (10-30m)', value: metrics.goodCount, color: 'hsl(var(--chart-2))' },
        { name: 'Acceptable (30-50m)', value: metrics.highCount, color: 'hsl(var(--chart-3))' },
        { name: 'Poor (>50m)', value: metrics.criticalCount, color: 'hsl(var(--chart-4))' },
      ].filter(item => item.value > 0) as QualityDistribution[];
    },
    enabled: !!metrics,
  });

  const { data: problemMeasurements, isLoading: problemsLoading, refetch: refetchProblems } = useQuery({
    queryKey: ['problem-measurements'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('measurements')
        .select(`
          id,
          visualization_metadata,
          created_at,
          property_id,
          pipeline_entries!inner(
            metadata
          )
        `)
        .order('created_at', { ascending: false })
        .limit(100); // Get more and filter in memory

      if (error) throw error;

      // Filter for problems and sort by distance
      const problems = data
        .map(m => {
          const metadata = m.visualization_metadata as any;
          const distance = metadata?.coordinate_mismatch_distance || 0;
          return {
            id: m.id,
            coordinate_mismatch_distance: distance,
            created_at: m.created_at,
            property_id: m.property_id,
            address: (m.pipeline_entries as any)?.metadata?.address_street || 'Unknown',
            city: (m.pipeline_entries as any)?.metadata?.address_city || '',
          };
        })
        .filter(m => m.coordinate_mismatch_distance > 30)
        .sort((a, b) => b.coordinate_mismatch_distance - a.coordinate_mismatch_distance)
        .slice(0, 20);

      return problems as ProblemMeasurement[];
    },
    refetchInterval: 60000,
  });

  const exportMetrics = (format: 'csv' | 'json') => {
    if (!metrics || !accuracyTrend || !problemMeasurements) return;

    const exportData = {
      summary: metrics,
      accuracyTrend,
      problemMeasurements,
      exportedAt: new Date().toISOString(),
    };

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `measurement-health-${formatDate(new Date(), 'yyyy-MM-dd-HHmmss')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // CSV format
      const csvRows = [
        'Metric,Value',
        `Total Measurements,${metrics.totalMeasurements}`,
        `Avg Coordinate Accuracy (m),${metrics.avgCoordinateAccuracy.toFixed(2)}`,
        `Visualization Success Rate (%),${metrics.visualizationSuccessRate.toFixed(2)}`,
        `Manual Regenerations,${metrics.manualRegenerationCount}`,
        `Excellent (<10m),${metrics.excellentCount}`,
        `Good (10-30m),${metrics.goodCount}`,
        `Acceptable (30-50m),${metrics.highCount}`,
        `Poor (>50m),${metrics.criticalCount}`,
      ];

      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `measurement-health-${formatDate(new Date(), 'yyyy-MM-dd-HHmmss')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return {
    metrics,
    accuracyTrend,
    qualityDistribution,
    problemMeasurements,
    isLoading: metricsLoading || trendLoading || distributionLoading || problemsLoading,
    refetchMetrics,
    refetchProblems,
    exportMetrics,
  };
}
