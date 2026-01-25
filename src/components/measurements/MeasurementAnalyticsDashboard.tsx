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
        .select('id, created_at, measurement_confidence, detection_confidence, quality_score, image_source, validation_status')
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

      return {
        totalMeasurements,
        avgConfidence,
        avgQualityScore,
        approvalRate,
        bySource,
        tiers,
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
    </div>
  );
}
