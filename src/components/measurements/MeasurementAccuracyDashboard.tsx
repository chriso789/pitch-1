import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, TrendingUp, TrendingDown, Target, Award, AlertTriangle, CheckCircle2, BarChart3 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

interface AccuracyStats {
  total_verified: number;
  avg_accuracy_score: number | null;
  avg_area_variance: number | null;
  avg_linear_variance: number | null;
  trend: Array<{
    date: string;
    count: number;
    avg_accuracy: number;
  }>;
  recent_records: Array<{
    id: string;
    measurement_id: string;
    overall_accuracy_score: number;
    area_variance_pct: number;
    ridge_variance_pct: number | null;
    hip_variance_pct: number | null;
    valley_variance_pct: number | null;
    verified_at: string;
  }>;
}

export function MeasurementAccuracyDashboard() {
  const { toast } = useToast();
  const [stats, setStats] = useState<AccuracyStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeRange, setTimeRange] = useState('30');

  useEffect(() => {
    loadStats();
  }, [timeRange]);

  const loadStats = async () => {
    setLoading(true);
    try {
      // Get current user's tenant
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      const { data, error } = await supabase.functions.invoke('track-measurement-accuracy', {
        body: {
          action: 'stats',
          data: {
            tenant_id: profile.tenant_id,
            days: parseInt(timeRange)
          }
        }
      });

      if (error || !data?.ok) {
        throw new Error(error?.message || data?.error || 'Failed to load stats');
      }

      setStats(data.data);
    } catch (error) {
      console.error('Failed to load accuracy stats:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load accuracy statistics',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const getAccuracyColor = (score: number) => {
    if (score >= 95) return 'text-green-500';
    if (score >= 90) return 'text-emerald-500';
    if (score >= 85) return 'text-yellow-500';
    if (score >= 80) return 'text-orange-500';
    return 'text-red-500';
  };

  const getAccuracyBadge = (score: number) => {
    if (score >= 95) return <Badge className="bg-green-500">Excellent</Badge>;
    if (score >= 90) return <Badge className="bg-emerald-500">Good</Badge>;
    if (score >= 85) return <Badge className="bg-yellow-500">Acceptable</Badge>;
    if (score >= 80) return <Badge className="bg-orange-500">Poor</Badge>;
    return <Badge variant="destructive">Critical</Badge>;
  };

  const formatVariance = (variance: number | null) => {
    if (variance === null || variance === undefined) return 'N/A';
    return `${variance.toFixed(1)}%`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Measurement Accuracy</h2>
          <p className="text-sm text-muted-foreground">
            Track AI measurement accuracy against manually-verified values
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={loadStats} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              Overall Accuracy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${stats?.avg_accuracy_score ? getAccuracyColor(stats.avg_accuracy_score) : ''}`}>
              {stats?.avg_accuracy_score !== null ? `${stats.avg_accuracy_score.toFixed(1)}%` : 'N/A'}
            </div>
            {stats?.avg_accuracy_score && getAccuracyBadge(stats.avg_accuracy_score)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              Area Variance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatVariance(stats?.avg_area_variance || null)}
            </div>
            <p className="text-xs text-muted-foreground">Average sq ft difference</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Linear Variance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatVariance(stats?.avg_linear_variance || null)}
            </div>
            <p className="text-xs text-muted-foreground">Ridge/Hip/Valley avg</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Award className="h-4 w-4 text-muted-foreground" />
              Verified
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats?.total_verified || 0}
            </div>
            <p className="text-xs text-muted-foreground">Measurements verified</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      {stats?.trend && stats.trend.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Accuracy Trend</CardTitle>
            <CardDescription>
              Daily average accuracy score over time
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.trend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis 
                    domain={[70, 100]} 
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <Tooltip 
                    formatter={(value: number) => [`${value.toFixed(1)}%`, 'Accuracy']}
                    labelFormatter={(label) => new Date(label).toLocaleDateString()}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="avg_accuracy" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--primary))' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Verifications */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Verifications</CardTitle>
          <CardDescription>
            Latest AI vs manual measurement comparisons
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stats?.recent_records && stats.recent_records.length > 0 ? (
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {stats.recent_records.map((record) => (
                  <div
                    key={record.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card"
                  >
                    <div className="flex items-center gap-3">
                      {record.overall_accuracy_score >= 90 ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : record.overall_accuracy_score >= 80 ? (
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-red-500" />
                      )}
                      <div>
                        <p className="text-sm font-medium">
                          Measurement {record.measurement_id.slice(0, 8)}...
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(record.verified_at).toLocaleDateString()} at{' '}
                          {new Date(record.verified_at).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Area</p>
                        <Badge variant="outline">{record.area_variance_pct.toFixed(1)}%</Badge>
                      </div>
                      {record.ridge_variance_pct !== null && (
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Ridge</p>
                          <Badge variant="outline">{record.ridge_variance_pct.toFixed(1)}%</Badge>
                        </div>
                      )}
                      {record.valley_variance_pct !== null && (
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Valley</p>
                          <Badge variant="outline">{record.valley_variance_pct.toFixed(1)}%</Badge>
                        </div>
                      )}
                      <div className="min-w-[80px] text-right">
                        <p className={`text-lg font-bold ${getAccuracyColor(record.overall_accuracy_score)}`}>
                          {record.overall_accuracy_score.toFixed(0)}%
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No accuracy data yet</p>
              <p className="text-sm">Verify measurements to start tracking accuracy</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}