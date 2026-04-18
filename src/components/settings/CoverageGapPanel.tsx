import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, FileWarning, GraduationCap, RefreshCw, BarChart3, Target } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SessionLite {
  id: string;
  verification_status: string | null;
  verification_verdict: string | null;
  has_source_file?: boolean;
  has_diagram?: boolean;
  last_failure_reason?: string | null;
  last_failure_stage?: string | null;
  ai_measurement_id?: string | null;
  vendor_report_id?: string | null;
}

interface Props {
  sessions: SessionLite[];
  tenantId: string | null;
  onRefresh: () => void;
}

export function CoverageGapPanel({ sessions, tenantId, onRefresh }: Props) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    averageAccuracy: number | null;
    processed: number;
  } | null>(null);

  const { failed, noSource, denied, confirmedPairs, failureBuckets } = useMemo(() => {
    const failed = sessions.filter((s) => s.verification_status === 'failed');
    const noSource = sessions.filter((s) => !s.has_source_file && !s.has_diagram);
    const denied = sessions.filter((s) => s.verification_verdict === 'denied');
    const confirmedPairs = sessions.filter(
      (s) => s.verification_verdict === 'confirmed' && s.ai_measurement_id && s.vendor_report_id,
    );

    const buckets: Record<string, number> = {};
    for (const f of failed) {
      const k = f.last_failure_reason || 'unknown';
      buckets[k] = (buckets[k] || 0) + 1;
    }
    return { failed, noSource, denied, confirmedPairs, failureBuckets: buckets };
  }, [sessions]);

  const handleRetryFailed = async () => {
    if (failed.length === 0 || !tenantId) return;
    setIsRetrying(true);
    try {
      // Reset all failed → null so the queue picks them up. Measure function
      // will re-run with fallback imagery chain and write structured failure
      // reasons if they fail again.
      await supabase
        .from('roof_training_sessions')
        .update({
          verification_status: null,
          verification_verdict: null,
          verification_score: null,
          verification_run_at: null,
          verification_feature_breakdown: null,
          last_failure_reason: null,
          last_failure_stage: null,
        } as any)
        .eq('tenant_id', tenantId)
        .eq('verification_status', 'failed');

      // Kick the drain
      await supabase.functions.invoke('measure', {
        body: { action: 'batch-verify-vendor-reports', resetFailed: true, resetStale: true, runToCompletion: true, limit: 5 },
      });
      toast.success(`Re-queued ${failed.length} failed reports — running in background`);
      onRefresh();
    } catch (e: any) {
      toast.error(e?.message || 'Retry failed');
    } finally {
      setIsRetrying(false);
    }
  };

  const handleBatchCompare = async () => {
    if (!tenantId) return;
    setIsComparing(true);
    setBatchResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('compare-accuracy', {
        body: { mode: 'batch', tenantId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Compare failed');
      setBatchResult({
        averageAccuracy: data.averageAccuracy,
        processed: data.processed,
      });
      toast.success(
        `Compared ${data.processed} pairs — AI vs Vendor: ${
          data.averageAccuracy != null ? data.averageAccuracy.toFixed(1) + '%' : 'N/A'
        }`,
      );
    } catch (e: any) {
      toast.error(e?.message || 'Batch compare failed');
    } finally {
      setIsComparing(false);
    }
  };

  const handleExportTraining = async () => {
    setIsExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('export-unet-training-set');
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Export failed');
      toast.success(
        `Exported ${data.data.included_records} training records (${
          data.data.included_records - confirmedPairs.length > 0
            ? `incl. ${data.data.included_records - confirmedPairs.length} corrections`
            : 'vendor matches only'
        })`,
      );
      if (data.data.signed_url) window.open(data.data.signed_url, '_blank');
    } catch (e: any) {
      toast.error(e?.message || 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const totalGap = failed.length + noSource.length;
  const coveragePct = sessions.length > 0
    ? Math.round(((sessions.length - totalGap) / sessions.length) * 100)
    : 0;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Coverage Gap — path to 100%
          </CardTitle>
          <Badge variant={coveragePct >= 95 ? 'default' : 'outline'}>
            {coveragePct}% covered
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Failed bucket */}
        <div className="flex items-center justify-between p-3 rounded-md border bg-card">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="font-medium text-sm">{failed.length} reports failed</span>
            </div>
            {Object.keys(failureBuckets).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {Object.entries(failureBuckets).map(([reason, count]) => (
                  <Badge key={reason} variant="outline" className="text-xs">
                    {reason}: {count}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <Button size="sm" variant="outline" disabled={isRetrying || failed.length === 0} onClick={handleRetryFailed}>
            {isRetrying ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-2" />}
            Retry all
          </Button>
        </div>

        {/* No source bucket */}
        <div className="flex items-center justify-between p-3 rounded-md border bg-card">
          <div className="flex items-center gap-2">
            <FileWarning className="h-4 w-4 text-orange-500" />
            <span className="text-sm">
              <span className="font-medium">{noSource.length} reports</span> missing vendor PDF
            </span>
          </div>
          <Badge variant="outline" className="text-xs">Use Bulk Import to upload</Badge>
        </div>

        {/* Confirmed pairs → batch compare */}
        <div className="flex items-center justify-between p-3 rounded-md border bg-card">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-green-500" />
              <span className="text-sm">
                <span className="font-medium">{confirmedPairs.length} confirmed pairs</span> ready to compare
              </span>
            </div>
            {batchResult && (
              <div className="mt-1 text-xs text-muted-foreground">
                Last batch: {batchResult.processed} compared,{' '}
                <span className="font-semibold text-foreground">
                  {batchResult.averageAccuracy != null ? batchResult.averageAccuracy.toFixed(1) + '%' : '—'}
                </span>{' '}
                avg AI vs Vendor accuracy
              </div>
            )}
          </div>
          <Button size="sm" disabled={isComparing || confirmedPairs.length === 0} onClick={handleBatchCompare}>
            {isComparing ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <BarChart3 className="h-3 w-3 mr-2" />}
            Compare all
          </Button>
        </div>

        {/* Denied → training */}
        <div className="flex items-center justify-between p-3 rounded-md border bg-card">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-blue-500" />
            <span className="text-sm">
              <span className="font-medium">{denied.length} denied</span> ready as correction training data
            </span>
          </div>
          <Button size="sm" variant="outline" disabled={isExporting} onClick={handleExportTraining}>
            {isExporting ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <GraduationCap className="h-3 w-3 mr-2" />}
            Export to U-Net set
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
