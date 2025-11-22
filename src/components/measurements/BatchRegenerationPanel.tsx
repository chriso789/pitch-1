import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, AlertTriangle, CheckCircle2, XCircle, Info, Zap } from 'lucide-react';

interface RegenerationStats {
  total_mismatched: number;
  critical_count: number; // >50m
  high_count: number; // >30m
  medium_count: number; // >0m
}

interface RegenerationResult {
  measurement_id: string;
  status: 'success' | 'failed' | 'error';
  distance_meters: number;
  error?: string;
  new_url?: string;
}

export const BatchRegenerationPanel: React.FC = () => {
  const { toast } = useToast();
  const [stats, setStats] = useState<RegenerationStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<RegenerationResult[]>([]);
  const [severityFilter, setSeverityFilter] = useState<string>('HIGH');
  const [batchSize, setBatchSize] = useState<number>(50);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      // Query measurements with coordinate mismatches
      const { data, error } = await supabase
        .from('measurements')
        .select(`
          id,
          visualization_metadata,
          property_id,
          pipeline_entries!inner(metadata)
        `)
        .not('visualization_metadata', 'is', null)
        .not('mapbox_visualization_url', 'is', null);

      if (error) throw error;

      let critical = 0;
      let high = 0;
      let medium = 0;

      data?.forEach((m: any) => {
        const verifiedLat = m.pipeline_entries?.metadata?.verified_address?.geometry?.location?.lat;
        const verifiedLng = m.pipeline_entries?.metadata?.verified_address?.geometry?.location?.lng;
        const vizLat = m.visualization_metadata?.center?.lat;
        const vizLng = m.visualization_metadata?.center?.lng;

        if (verifiedLat && verifiedLng && vizLat && vizLng) {
          const latDiff = Math.abs(verifiedLat - vizLat);
          const lngDiff = Math.abs(verifiedLng - vizLng);
          const distanceMeters = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000;

          if (distanceMeters > 50) critical++;
          else if (distanceMeters > 30) high++;
          else if (distanceMeters > 0) medium++;
        }
      });

      setStats({
        total_mismatched: critical + high + medium,
        critical_count: critical,
        high_count: high,
        medium_count: medium,
      });

      console.log('📊 Regeneration stats loaded:', { critical, high, medium });
    } catch (error: any) {
      console.error('Failed to load stats:', error);
      toast({
        title: 'Error Loading Statistics',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const startBatchRegeneration = async () => {
    setRegenerating(true);
    setProgress(0);
    setResults([]);

    try {
      toast({
        title: '🚀 Batch Regeneration Started',
        description: `Processing up to ${batchSize} measurements with ${severityFilter} severity...`,
      });

      const { data, error } = await supabase.functions.invoke('batch-regenerate-measurements', {
        body: {
          min_distance_meters: severityFilter === 'CRITICAL' ? 50 : 30,
          max_batch_size: batchSize,
          severity_filter: severityFilter === 'ALL' ? null : severityFilter,
        },
      });

      if (error) throw error;

      if (data?.ok) {
        setResults(data.details || []);
        setProgress(100);

        toast({
          title: '✅ Batch Regeneration Complete',
          description: `${data.regenerated} regenerated, ${data.failed} failed, ${data.skipped} skipped`,
        });

        // Reload stats
        await loadStats();
      } else {
        throw new Error(data?.error || 'Unknown error');
      }
    } catch (error: any) {
      console.error('Batch regeneration error:', error);
      toast({
        title: 'Regeneration Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setRegenerating(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Info className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Batch Measurement Regeneration</h2>
          <p className="text-sm text-muted-foreground">
            Fix historical satellite images with coordinate mismatches
          </p>
        </div>
        <Button onClick={loadStats} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh Stats
        </Button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Mismatched</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.total_mismatched || 0}</div>
            <p className="text-xs text-muted-foreground">Measurements needing fix</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Badge variant="destructive">CRITICAL</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-500">{stats?.critical_count || 0}</div>
            <p className="text-xs text-muted-foreground">&gt; 50 meters offset</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Badge variant="secondary">HIGH</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-500">{stats?.high_count || 0}</div>
            <p className="text-xs text-muted-foreground">30-50 meters offset</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Badge variant="outline">MEDIUM</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-muted-foreground">{stats?.medium_count || 0}</div>
            <p className="text-xs text-muted-foreground">&lt; 30 meters offset</p>
          </CardContent>
        </Card>
      </div>

      {/* Configuration & Action */}
      <Card>
        <CardHeader>
          <CardTitle>Regeneration Configuration</CardTitle>
          <CardDescription>
            Configure batch processing parameters and start regeneration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Severity Filter</label>
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Severities</SelectItem>
                  <SelectItem value="CRITICAL">Critical Only (&gt;50m)</SelectItem>
                  <SelectItem value="HIGH">High Priority (&gt;30m)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Batch Size</label>
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
            </div>
          </div>

          <Alert>
            <Zap className="h-4 w-4" />
            <AlertDescription>
              <strong>What this does:</strong> Regenerates satellite visualizations for measurements
              where the satellite image center differs significantly from the verified property address.
              This fixes historical images showing wrong properties or water instead of houses.
            </AlertDescription>
          </Alert>

          <Button
            onClick={startBatchRegeneration}
            disabled={regenerating || !stats || stats.total_mismatched === 0}
            className="w-full"
            size="lg"
          >
            {regenerating ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Regenerating...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Start Batch Regeneration
              </>
            )}
          </Button>

          {regenerating && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-xs text-center text-muted-foreground">
                Processing measurements...
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Regeneration Results</CardTitle>
            <CardDescription>
              {results.filter((r) => r.status === 'success').length} successful,{' '}
              {results.filter((r) => r.status !== 'success').length} failed
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
                          Measurement {result.measurement_id.slice(0, 8)}...
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {result.distance_meters}m coordinate offset
                        </p>
                        {result.error && (
                          <p className="text-xs text-red-500">{result.error}</p>
                        )}
                      </div>
                    </div>
                    <Badge variant={result.status === 'success' ? 'default' : 'destructive'}>
                      {result.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
