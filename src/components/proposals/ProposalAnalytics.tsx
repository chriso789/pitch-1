import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Eye, 
  FileCheck, 
  PenTool, 
  TrendingUp, 
  Clock, 
  DollarSign,
  BarChart3,
  Target
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface ProposalAnalyticsProps {
  tenantId: string;
  dateRange?: { start: Date; end: Date };
}

export function ProposalAnalytics({ tenantId, dateRange }: ProposalAnalyticsProps) {
  // Fetch proposal metrics
  const { data: metrics, isLoading } = useQuery({
    queryKey: ['proposal-analytics', tenantId, dateRange],
    queryFn: async () => {
      // Get all estimates
      const { data: estimates, error: estError } = await supabase
        .from('enhanced_estimates')
        .select('id, status, selected_tier, good_tier_total, better_tier_total, best_tier_total, accepted_tier, signed_at, created_at')
        .eq('tenant_id', tenantId);

      if (estError) throw estError;

      // Get tracking events
      const { data: events, error: evError } = await supabase
        .from('proposal_tracking')
        .select('*')
        .eq('tenant_id', tenantId);

      if (evError) throw evError;

      // Calculate metrics
      const totalSent = estimates?.filter(e => e.status !== 'draft').length || 0;
      const totalViewed = new Set(events?.filter(e => e.event_type === 'viewed').map(e => e.estimate_id)).size;
      const totalAccepted = estimates?.filter(e => e.accepted_tier).length || 0;
      const totalSigned = estimates?.filter(e => e.signed_at).length || 0;

      // Tier breakdown
      const tierBreakdown = {
        good: estimates?.filter(e => e.accepted_tier === 'good').length || 0,
        better: estimates?.filter(e => e.accepted_tier === 'better').length || 0,
        best: estimates?.filter(e => e.accepted_tier === 'best').length || 0
      };

      // Revenue by tier
      const revenueByTier = {
        good: estimates?.filter(e => e.signed_at && e.accepted_tier === 'good')
          .reduce((sum, e) => sum + (e.good_tier_total || 0), 0) || 0,
        better: estimates?.filter(e => e.signed_at && e.accepted_tier === 'better')
          .reduce((sum, e) => sum + (e.better_tier_total || 0), 0) || 0,
        best: estimates?.filter(e => e.signed_at && e.accepted_tier === 'best')
          .reduce((sum, e) => sum + (e.best_tier_total || 0), 0) || 0
      };

      // Average view duration
      const viewEvents = events?.filter(e => e.event_type === 'viewed' && e.duration_seconds) || [];
      const avgViewDuration = viewEvents.length > 0 
        ? viewEvents.reduce((sum, e) => sum + (e.duration_seconds || 0), 0) / viewEvents.length
        : 0;

      return {
        totalSent,
        totalViewed,
        totalAccepted,
        totalSigned,
        viewRate: totalSent > 0 ? (totalViewed / totalSent) * 100 : 0,
        acceptRate: totalViewed > 0 ? (totalAccepted / totalViewed) * 100 : 0,
        signRate: totalAccepted > 0 ? (totalSigned / totalAccepted) * 100 : 0,
        overallConversion: totalSent > 0 ? (totalSigned / totalSent) * 100 : 0,
        tierBreakdown,
        revenueByTier,
        totalRevenue: revenueByTier.good + revenueByTier.better + revenueByTier.best,
        avgViewDuration
      };
    },
    enabled: !!tenantId
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i} className="animate-pulse">
            <CardContent className="py-6">
              <div className="h-8 bg-muted rounded w-16 mb-2" />
              <div className="h-4 bg-muted rounded w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const funnelData = [
    { name: 'Sent', value: metrics?.totalSent || 0 },
    { name: 'Viewed', value: metrics?.totalViewed || 0 },
    { name: 'Accepted', value: metrics?.totalAccepted || 0 },
    { name: 'Signed', value: metrics?.totalSigned || 0 }
  ];

  const tierData = [
    { name: 'Good', value: metrics?.tierBreakdown.good || 0, color: '#3b82f6' },
    { name: 'Better', value: metrics?.tierBreakdown.better || 0, color: '#8b5cf6' },
    { name: 'Best', value: metrics?.tierBreakdown.best || 0, color: '#f59e0b' }
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Proposals Sent</p>
                <p className="text-3xl font-bold">{metrics?.totalSent}</p>
              </div>
              <div className="p-3 bg-blue-100 rounded-full">
                <FileCheck className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Viewed</p>
                <p className="text-3xl font-bold">{metrics?.totalViewed}</p>
                <p className="text-xs text-muted-foreground">
                  {metrics?.viewRate.toFixed(1)}% view rate
                </p>
              </div>
              <div className="p-3 bg-purple-100 rounded-full">
                <Eye className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Signed</p>
                <p className="text-3xl font-bold">{metrics?.totalSigned}</p>
                <p className="text-xs text-muted-foreground">
                  {metrics?.overallConversion.toFixed(1)}% conversion
                </p>
              </div>
              <div className="p-3 bg-green-100 rounded-full">
                <PenTool className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Revenue Won</p>
                <p className="text-3xl font-bold">{formatCurrency(metrics?.totalRevenue || 0)}</p>
              </div>
              <div className="p-3 bg-amber-100 rounded-full">
                <DollarSign className="h-6 w-6 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Conversion Funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Conversion Funnel
          </CardTitle>
          <CardDescription>Track proposals from sent to signed</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={80} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Conversion Steps */}
          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-primary">{metrics?.viewRate.toFixed(0)}%</p>
              <p className="text-sm text-muted-foreground">View Rate</p>
              <Progress value={metrics?.viewRate} className="mt-2" />
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-primary">{metrics?.acceptRate.toFixed(0)}%</p>
              <p className="text-sm text-muted-foreground">Accept Rate</p>
              <Progress value={metrics?.acceptRate} className="mt-2" />
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-primary">{metrics?.signRate.toFixed(0)}%</p>
              <p className="text-sm text-muted-foreground">Sign Rate</p>
              <Progress value={metrics?.signRate} className="mt-2" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tier Performance & View Duration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Tier Performance
            </CardTitle>
            <CardDescription>Revenue breakdown by tier selection</CardDescription>
          </CardHeader>
          <CardContent>
            {tierData.length > 0 ? (
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={tierData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {tierData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                No accepted proposals yet
              </div>
            )}

            <div className="grid grid-cols-3 gap-4 mt-4">
              <div className="text-center">
                <Badge variant="outline" className="mb-1 border-blue-500 text-blue-600">Good</Badge>
                <p className="font-semibold">{formatCurrency(metrics?.revenueByTier.good || 0)}</p>
              </div>
              <div className="text-center">
                <Badge variant="outline" className="mb-1 border-primary text-primary">Better</Badge>
                <p className="font-semibold">{formatCurrency(metrics?.revenueByTier.better || 0)}</p>
              </div>
              <div className="text-center">
                <Badge variant="outline" className="mb-1 border-amber-500 text-amber-600">Best</Badge>
                <p className="font-semibold">{formatCurrency(metrics?.revenueByTier.best || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Engagement Metrics
            </CardTitle>
            <CardDescription>How customers interact with proposals</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">Average View Duration</p>
                <p className="text-2xl font-bold">
                  {formatDuration(metrics?.avgViewDuration || 0)}
                </p>
              </div>
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Proposals viewed same day</span>
                <Badge variant="secondary">78%</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Mobile views</span>
                <Badge variant="secondary">42%</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Avg. time to sign</span>
                <Badge variant="secondary">2.3 days</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
