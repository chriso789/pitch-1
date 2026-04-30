import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  BarChart3, TrendingUp, Clock, Target, 
  CheckCircle2, Users, Zap
} from 'lucide-react';

interface MeasurementRecord {
  id: string;
  created_at: string;
  measurement_confidence: number | null;
  detection_confidence: number | null;
  quality_score: number | null;
  image_source: string | null;
  validation_status: string | null;
  total_ridge_length: number | null;
  total_hip_length: number | null;
  total_valley_length: number | null;
  total_eave_length: number | null;
  total_rake_length: number | null;
  total_area_flat_sqft: number | null;
  geometry_report_json: any | null;
}

export function MeasurementAnalyticsDashboard() {
  // Fetch measurement analytics
  const { data: analytics, isLoading } = useQuery({
    queryKey: ['measurement-analytics'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;

      // Get recent measurements for this tenant
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: rawMeasurements } = await supabase
        .from('roof_measurements')
        .select('id, created_at, measurement_confidence, detection_confidence, quality_score, image_source, validation_status, total_ridge_length, total_hip_length, total_valley_length, total_eave_length, total_rake_length, total_area_flat_sqft, geometry_report_json')
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: false });

      // Cast to our interface to avoid type issues
      const measurements = (rawMeasurements || []) as unknown as MeasurementRecord[];

      const { data: approvals } = await supabase
        .from('measurement_approvals')
        .select('id, approved_at, saved_tags')
        .gte('approved_at', thirtyDaysAgo.toISOString());

      // Calculate metrics
      const totalMeasurements = measurements?.length || 0;
      const avgConfidence = measurements?.length 
        ? measurements.reduce((sum, m) => sum + (m.measurement_confidence || m.detection_confidence || 0), 0) / measurements.length 
        : 0;
      const avgQualityScore = measurements?.length
        ? measurements.reduce((sum, m) => sum + (m.quality_score || 0), 0) / measurements.length
        : 0;
      const approvalRate = measurements?.length 
        ? ((approvals?.length || 0) / measurements.length) * 100 
        : 0;

      // Group by source
      const bySource = measurements?.reduce((acc, m) => {
        const source = m.image_source || 'unknown';
        acc[source] = (acc[source] || 0) + 1;
        return acc;
      }, {} as Record<string, number>) || {};

      // Accuracy tiers based on measurement_confidence
      const getConfidence = (m: MeasurementRecord) => m.measurement_confidence || m.detection_confidence || 0;
      const tiers = {
        diamond: measurements?.filter(m => getConfidence(m) >= 98).length || 0,
        platinum: measurements?.filter(m => getConfidence(m) >= 95 && getConfidence(m) < 98).length || 0,
        gold: measurements?.filter(m => getConfidence(m) >= 90 && getConfidence(m) < 95).length || 0,
        silver: measurements?.filter(m => getConfidence(m) >= 80 && getConfidence(m) < 90).length || 0,
        bronze: measurements?.filter(m => getConfidence(m) < 80).length || 0,
      };

      // Edge-count totals (linear feet) by type across last 30 days
      const edgeTotals = (measurements || []).reduce(
        (acc, m) => {
          acc.ridge += Number(m.total_ridge_length || 0);
          acc.hip += Number(m.total_hip_length || 0);
          acc.valley += Number(m.total_valley_length || 0);
          acc.eave += Number(m.total_eave_length || 0);
          acc.rake += Number(m.total_rake_length || 0);
          return acc;
        },
        { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0 },
      );

      // Solar-vs-measured area comparison (per measurement, where both exist)
      const solarComparison = (measurements || [])
        .map((m) => {
          const grj = m.geometry_report_json || {};
          const solarArea = Number(
            grj.google_solar_area_sqft ?? grj.solar_area_sqft ?? grj.solar?.area_sqft ?? 0,
          );
          const measured = Number(m.total_area_flat_sqft || 0);
          if (!solarArea || !measured) return null;
          const deltaPct = ((measured - solarArea) / solarArea) * 100;
          return { id: m.id, solar: solarArea, measured, deltaPct };
        })
        .filter(Boolean) as { id: string; solar: number; measured: number; deltaPct: number }[];

      const solarStats = solarComparison.length
        ? {
            count: solarComparison.length,
            meanAbsDeltaPct:
              solarComparison.reduce((s, r) => s + Math.abs(r.deltaPct), 0) / solarComparison.length,
            within5Pct: solarComparison.filter((r) => Math.abs(r.deltaPct) <= 5).length,
            within10Pct: solarComparison.filter((r) => Math.abs(r.deltaPct) <= 10).length,
          }
        : null;

      return {
        totalMeasurements,
        avgConfidence,
        avgQualityScore,
        approvalRate,
        bySource,
        tiers,
        edgeTotals,
        solarComparison,
        solarStats,
        recentMeasurements: measurements?.slice(0, 10) || [],
      };
    },
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const tierColors = {
    diamond: 'bg-blue-500',
    platinum: 'bg-purple-500',
    gold: 'bg-yellow-500',
    silver: 'bg-gray-400',
    bronze: 'bg-orange-600',
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Measurement Analytics</h2>
          <p className="text-muted-foreground">Last 30 days performance metrics</p>
        </div>
        <Badge variant="secondary" className="text-sm">
          <BarChart3 className="h-4 w-4 mr-1" />
          {analytics?.totalMeasurements || 0} Total Measurements
        </Badge>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              Avg Confidence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics?.avgConfidence?.toFixed(1) || 0}%
            </div>
            <Progress value={analytics?.avgConfidence || 0} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Avg Quality Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics?.avgQualityScore?.toFixed(1) || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Image & detection quality
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              Approval Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics?.approvalRate?.toFixed(0) || 0}%
            </div>
            <Progress value={analytics?.approvalRate || 0} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4 text-warning" />
              AI Measurements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics?.bySource?.['google'] || analytics?.bySource?.['solar'] || analytics?.bySource?.['mapbox'] || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              AI-generated measurements
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Accuracy Tiers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Accuracy Distribution
          </CardTitle>
          <CardDescription>
            Diamond Certification tiers based on confidence scores
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-4">
            {Object.entries(analytics?.tiers || {}).map(([tier, count]) => (
              <div key={tier} className="text-center">
                <div className={`rounded-lg ${tierColors[tier as keyof typeof tierColors]} flex items-end justify-center p-2`}
                     style={{ height: `${Math.max(40, ((count as number) / (analytics?.totalMeasurements || 1)) * 150)}px` }}>
                  <span className="text-white font-bold text-lg">{count as number}</span>
                </div>
                <p className="text-sm font-medium mt-2 capitalize">{tier}</p>
                <p className="text-xs text-muted-foreground">
                  {tier === 'diamond' && '98%+'}
                  {tier === 'platinum' && '95-98%'}
                  {tier === 'gold' && '90-95%'}
                  {tier === 'silver' && '80-90%'}
                  {tier === 'bronze' && '<80%'}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Source Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Measurement Sources
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {Object.entries(analytics?.bySource || {}).map(([source, count]) => (
              <Badge key={source} variant="secondary" className="text-sm py-1 px-3">
                {source.replace(/_/g, ' ')}: {count as number}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Edge-count histogram by type (linear feet) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Edge Detection by Type
          </CardTitle>
          <CardDescription>
            Total linear feet of each edge type detected over the last 30 days. Use to spot under-detection of hips/valleys.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            const totals = analytics?.edgeTotals || { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0 };
            const max = Math.max(1, ...Object.values(totals));
            const colors: Record<string, string> = {
              ridge: 'bg-red-500',
              hip: 'bg-orange-500',
              valley: 'bg-blue-500',
              eave: 'bg-green-500',
              rake: 'bg-purple-500',
            };
            return (
              <div className="grid grid-cols-5 gap-4 items-end" style={{ minHeight: 180 }}>
                {Object.entries(totals).map(([type, lf]) => (
                  <div key={type} className="flex flex-col items-center justify-end h-full">
                    <div className="text-xs font-mono mb-1">{Math.round(lf as number).toLocaleString()} ft</div>
                    <div
                      className={`w-full rounded-t ${colors[type]} transition-all`}
                      style={{ height: `${Math.max(8, ((lf as number) / max) * 140)}px` }}
                    />
                    <p className="text-sm font-medium mt-2 capitalize">{type}</p>
                  </div>
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Solar-vs-measured area comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Solar vs Measured Area
          </CardTitle>
          <CardDescription>
            Sanity-check measured roof area against Google Solar's reported area. Catches double-counted pitch
            or wrong area basis early.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!analytics?.solarStats ? (
            <p className="text-sm text-muted-foreground">
              No measurements with both Solar API and measured area in this window.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Compared</p>
                  <p className="text-xl font-bold">{analytics.solarStats.count}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Mean |Δ|</p>
                  <p className="text-xl font-bold">{analytics.solarStats.meanAbsDeltaPct.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Within ±5%</p>
                  <p className="text-xl font-bold">
                    {analytics.solarStats.within5Pct}/{analytics.solarStats.count}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Within ±10%</p>
                  <p className="text-xl font-bold">
                    {analytics.solarStats.within10Pct}/{analytics.solarStats.count}
                  </p>
                </div>
              </div>
              {/* Mini scatter: solar (x) vs measured (y) */}
              {(() => {
                const data = analytics.solarComparison || [];
                if (!data.length) return null;
                const all = data.flatMap((d) => [d.solar, d.measured]);
                const max = Math.max(...all) * 1.05;
                const size = 240;
                const pad = 24;
                const sx = (v: number) => pad + (v / max) * (size - pad * 2);
                const sy = (v: number) => size - pad - (v / max) * (size - pad * 2);
                return (
                  <div className="flex items-center justify-center pt-2">
                    <svg width={size} height={size} className="border rounded">
                      {/* y=x reference line */}
                      <line
                        x1={sx(0)}
                        y1={sy(0)}
                        x2={sx(max)}
                        y2={sy(max)}
                        stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="4 3"
                        strokeWidth={1}
                      />
                      {data.map((d) => (
                        <circle
                          key={d.id}
                          cx={sx(d.solar)}
                          cy={sy(d.measured)}
                          r={3}
                          fill={Math.abs(d.deltaPct) <= 10 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'}
                        />
                      ))}
                      <text x={pad} y={size - 4} fontSize="9" fill="currentColor" opacity="0.6">
                        solar (sqft) →
                      </text>
                      <text
                        x={4}
                        y={pad}
                        fontSize="9"
                        fill="currentColor"
                        opacity="0.6"
                      >
                        ↑ measured
                      </text>
                    </svg>
                  </div>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
