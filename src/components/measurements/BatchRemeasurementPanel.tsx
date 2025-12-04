import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Calendar, AlertTriangle, CheckCircle2, XCircle, Clock, Zap, TrendingUp, TrendingDown } from 'lucide-react';

interface RemeasureStats {
  total_old: number;
  by_age: {
    over_5_years: number;
    over_3_years: number;
    over_1_year: number;
  };
  total_remeasured: number;
  pending: number;
}

interface RemeasureResult {
  pipeline_entry_id: string;
  status: 'success' | 'failed' | 'skipped';
  original_imagery_date?: string;
  new_imagery_date?: string;
  original_area?: number;
  new_area?: number;
  variance_pct?: number;
  error?: string;
}

export function BatchRemeasurementPanel() {
  const { toast } = useToast();
  const [stats, setStats] = useState<RemeasureStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<RemeasureResult[]>([]);
  const [maxAge, setMaxAge] = useState(5);
  const [batchSize, setBatchSize] = useState(25);

  useEffect(() => {
    loadStats();
  }, [maxAge]);

  const loadStats = async () => {
    setLoading(true);
    try {
      // Calculate cutoff dates
      const now = new Date();
      const cutoff5Years = new Date(now);
      cutoff5Years.setFullYear(now.getFullYear() - 5);
      const cutoff3Years = new Date(now);
      cutoff3Years.setFullYear(now.getFullYear() - 3);
      const cutoff1Year = new Date(now);
      cutoff1Year.setFullYear(now.getFullYear() - 1);
      const cutoffSelected = new Date(now);
      cutoffSelected.setFullYear(now.getFullYear() - maxAge);

      // Query measurements with old imagery
      const { data: measurements, error } = await supabase
        .from('measurements')
        .select('id, imagery_date')
        .eq('is_active', true)
        .not('imagery_date', 'is', null);

      if (error) throw error;

      let over5 = 0, over3 = 0, over1 = 0;
      measurements?.forEach((m: any) => {
        const imageryDate = new Date(m.imagery_date);
        if (imageryDate < cutoff5Years) over5++;
        if (imageryDate < cutoff3Years) over3++;
        if (imageryDate < cutoff1Year) over1++;
      });

      // Get remeasure log stats
      const { data: logData } = await supabase
        .from('measurement_remeasure_log')
        .select('status')
        .eq('status', 'success');

      setStats({
        total_old: over5,
        by_age: {
          over_5_years: over5,
          over_3_years: over3,
          over_1_year: over1
        },
        total_remeasured: logData?.length || 0,
        pending: over5 - (logData?.length || 0)
      });
    } catch (error) {
      console.error('Failed to load stats:', error);
      toast({
        title: 'Error',
        description: 'Failed to load remeasurement statistics',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const startBatchRemeasure = async () => {
    setProcessing(true);
    setProgress(0);
    setResults([]);

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();

      toast({
        title: '🚀 Batch Re-measurement Started',
        description: `Processing up to ${batchSize} measurements with imagery older than ${maxAge} years...`
      });

      const { data, error } = await supabase.functions.invoke('batch-remeasure', {
        body: {
          max_imagery_age_years: maxAge,
          max_batch_size: batchSize,
          triggered_by: user?.id
        }
      });

      if (error || !data?.ok) {
        throw new Error(error?.message || data?.error || 'Batch remeasure failed');
      }

      setResults(data.results || []);
      setProgress(100);

      const successCount = data.results?.filter((r: RemeasureResult) => r.status === 'success').length || 0;
      const failedCount = data.results?.filter((r: RemeasureResult) => r.status === 'failed').length || 0;
      
      toast({
        title: '✅ Batch Complete',
        description: `${successCount} re-measured, ${failedCount} failed, ${data.skipped || 0} skipped`
      });

      // Refresh stats
      await loadStats();

    } catch (error) {
      console.error('Batch remeasure error:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setProcessing(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'skipped':
        return <Clock className="h-4 w-4 text-muted-foreground" />;
      default:
        return null;
    }
  };

  const getVarianceIndicator = (variance?: number) => {
    if (variance === undefined || variance === null) return null;
    
    if (variance > 10) {
      return (
        <Badge variant="destructive" className="text-xs">
          <TrendingUp className="h-3 w-3 mr-1" />
          {variance.toFixed(1)}% change
        </Badge>
      );
    } else if (variance > 5) {
      return (
        <Badge variant="secondary" className="text-xs">
          {variance.toFixed(1)}% change
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline" className="text-xs">
          <TrendingDown className="h-3 w-3 mr-1" />
          {variance.toFixed(1)}% change
        </Badge>
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Batch Re-Measurement</h2>
          <p className="text-sm text-muted-foreground">
            Re-pull measurements for leads with outdated satellite imagery
          </p>
        </div>
        <Button onClick={loadStats} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              &gt;5 Years Old
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-500">
              {stats?.by_age.over_5_years || 0}
            </div>
            <p className="text-xs text-muted-foreground">Critical - needs update</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              &gt;3 Years Old
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-500">
              {stats?.by_age.over_3_years || 0}
            </div>
            <p className="text-xs text-muted-foreground">High priority</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Re-measured
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-500">
              {stats?.total_remeasured || 0}
            </div>
            <p className="text-xs text-muted-foreground">Successfully updated</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats?.pending || 0}
            </div>
            <p className="text-xs text-muted-foreground">Awaiting re-measurement</p>
          </CardContent>
        </Card>
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Re-measurement Configuration</CardTitle>
          <CardDescription>
            Configure which measurements to re-pull based on imagery age
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Maximum Imagery Age: {maxAge} years</Label>
                <Slider
                  value={[maxAge]}
                  onValueChange={(v) => setMaxAge(v[0])}
                  min={1}
                  max={10}
                  step={1}
                />
                <p className="text-xs text-muted-foreground">
                  Re-measure properties with imagery older than this
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Batch Size</Label>
                <Select value={batchSize.toString()} onValueChange={(v) => setBatchSize(parseInt(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 measurements</SelectItem>
                    <SelectItem value="25">25 measurements</SelectItem>
                    <SelectItem value="50">50 measurements</SelectItem>
                    <SelectItem value="100">100 measurements</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Process this many measurements per batch
                </p>
              </div>
            </div>
          </div>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>What this does:</strong> Re-pulls measurements from Google Solar API for properties
              with satellite imagery older than {maxAge} years. This ensures measurements are based on 
              current satellite data and may reveal recent roof changes, new construction, or tree growth.
            </AlertDescription>
          </Alert>

          <Button
            onClick={startBatchRemeasure}
            disabled={processing || !stats || stats.pending === 0}
            className="w-full"
            size="lg"
          >
            {processing ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Start Batch Re-measurement ({Math.min(batchSize, stats?.pending || 0)} leads)
              </>
            )}
          </Button>

          {processing && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-xs text-center text-muted-foreground">
                Re-pulling measurements from Google Solar API...
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Re-measurement Results</CardTitle>
            <CardDescription>
              {results.filter(r => r.status === 'success').length} successful,{' '}
              {results.filter(r => r.status === 'failed').length} failed,{' '}
              {results.filter(r => r.status === 'skipped').length} skipped
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {results.map((result, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between p-3 rounded-lg border bg-card"
                  >
                    <div className="flex items-start gap-3">
                      {getStatusIcon(result.status)}
                      <div className="space-y-1">
                        <p className="text-sm font-medium">
                          Lead {result.pipeline_entry_id.slice(0, 8)}...
                        </p>
                        {result.original_imagery_date && (
                          <p className="text-xs text-muted-foreground">
                            {result.original_imagery_date} → {result.new_imagery_date || 'current'}
                          </p>
                        )}
                        {result.original_area && result.new_area && (
                          <p className="text-xs text-muted-foreground">
                            {result.original_area.toFixed(0)} → {result.new_area.toFixed(0)} sq ft
                          </p>
                        )}
                        {result.error && (
                          <p className="text-xs text-red-500">{result.error}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={
                        result.status === 'success' ? 'default' : 
                        result.status === 'failed' ? 'destructive' : 'secondary'
                      }>
                        {result.status}
                      </Badge>
                      {getVarianceIndicator(result.variance_pct)}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}