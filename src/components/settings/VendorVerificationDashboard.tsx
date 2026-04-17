import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, XCircle, Loader2, AlertTriangle, ChevronDown, ChevronRight, Edit2, Save, Clock, Zap, FileWarning, Download, Play, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { RoofDiagramRenderer } from '@/components/measurements/RoofDiagramRenderer';
import { VendorDiagramParsedCanvas, type ParsedDiagram } from './VendorDiagramParsedCanvas';
import { cleanAiDiagram } from './lib/cleanAiDiagram';

interface VendorReportMeta {
  provider: string | null;
  file_bucket: string | null;
  file_path: string | null;
  file_url: string | null;
  diagram_image_url: string | null;
  has_file: boolean;
  has_diagram: boolean;
}

interface AiMeasurementPreview {
  vendor_report_id: string | null;
  vector_diagram_svg: string | null;
  linear_features_wkt: Array<Record<string, any>> | null;
  perimeter_wkt: string | null;
  target_lat: number | null;
  target_lng: number | null;
  predominant_pitch: string | null;
  total_area_adjusted_sqft: number | null;
}

interface VerificationSession {
  id: string;
  property_address: string | null;
  verification_verdict: string | null;
  verification_score: number | null;
  verification_notes: string | null;
  verification_run_at: string | null;
  verification_status: string | null;
  verification_feature_breakdown: Record<string, { vendor: number; ai: number; accuracy: number; variance_pct: number }> | null;
  traced_totals: Record<string, number> | null;
  ai_totals: Record<string, number> | null;
  ground_truth_source: string | null;
  vendor_report_id: string | null;
  vendor_provider?: string | null;
  has_source_file?: boolean;
  has_diagram?: boolean;
  source_file_url?: string | null;
  vendor_diagram_url?: string | null;
  ai_diagram_svg?: string | null;
  ai_linear_features?: Array<Record<string, any>> | null;
  ai_perimeter_wkt?: string | null;
  ai_coordinates?: { lat: number; lng: number } | null;
  ai_pitch?: string | null;
  ai_total_area?: number | null;
}

export function VendorVerificationDashboard() {
  const activeCompanyId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');
  const [runningOneId, setRunningOneId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isCheckingCoverage, setIsCheckingCoverage] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [isFixingDiagrams, setIsFixingDiagrams] = useState(false);
  const [coverageReport, setCoverageReport] = useState<{
    total: number;
    withAi: number;
    missing: number;
    queued: number;
  } | null>(null);
  const [diagramFixReport, setDiagramFixReport] = useState<{
    scanned: number;
    cleaned: number;
    requeued: number;
    segmentsRemoved: number;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['vendor-verification-sessions', activeCompanyId],
    queryFn: async () => {
      // Query sessions with vendor report join for metadata
      const { data, error } = await supabase
        .from('roof_training_sessions')
        .select(`
          id, property_address, verification_verdict, verification_score,
          verification_notes, verification_run_at, verification_status,
          verification_feature_breakdown, traced_totals, ai_totals,
          ground_truth_source, vendor_report_id, ai_measurement_id, lat, lng
        `)
        .eq('tenant_id', activeCompanyId!)
        .eq('ground_truth_source', 'vendor_report')
        .not('vendor_report_id', 'is', null)
        .order('verification_run_at', { ascending: false, nullsFirst: true });

      if (error) {
        console.error('Verification sessions query error:', error);
        throw error;
      }

      // Fetch vendor report metadata for all sessions
      const reportIds = (data || [])
        .map(s => s.vendor_report_id)
        .filter((id): id is string => !!id);

      let reportMap: Record<string, VendorReportMeta> = {};
      if (reportIds.length > 0) {
        const { data: reports, error: reportsError } = await supabase
          .from('roof_vendor_reports')
          .select('id, provider, file_bucket, file_path, file_url, diagram_image_url')
          .in('id', reportIds);

        if (reportsError) {
          throw reportsError;
        }

        if (reports) {
          for (const r of reports) {
            reportMap[r.id] = {
              provider: r.provider,
              file_bucket: r.file_bucket,
              file_path: r.file_path,
              file_url: r.file_url,
              diagram_image_url: r.diagram_image_url,
              has_file: !!(r.file_path || r.file_url),
              has_diagram: !!r.diagram_image_url,
            };
          }
        }
      }

      let measurementMap: Record<string, AiMeasurementPreview> = {};

      // Strategy 1: Look up measurements by ai_measurement_id from training sessions
      const aiMeasIds = (data || [])
        .map(s => (s as any).ai_measurement_id)
        .filter((id): id is string => !!id);

      if (aiMeasIds.length > 0) {
        const { data: measByIds } = await supabase
          .from('roof_measurements')
          .select('id, vendor_report_id, vector_diagram_svg, linear_features_wkt, perimeter_wkt, target_lat, target_lng, predominant_pitch, total_area_adjusted_sqft, created_at')
          .in('id', aiMeasIds);

        if (measByIds) {
          // Build a reverse map: session's vendor_report_id -> measurement
          const aiMeasIdToMeas: Record<string, any> = {};
          for (const m of measByIds) {
            aiMeasIdToMeas[m.id] = m;
          }
          for (const s of (data || [])) {
            const mid = (s as any).ai_measurement_id;
            if (mid && aiMeasIdToMeas[mid] && s.vendor_report_id) {
              measurementMap[s.vendor_report_id] = aiMeasIdToMeas[mid] as AiMeasurementPreview;
            }
          }
        }
      }

      // Strategy 2: Fallback - look up measurements by vendor_report_id
      const missingReportIds = reportIds.filter(id => !measurementMap[id]);
      if (missingReportIds.length > 0) {
        const { data: measByVendor } = await supabase
          .from('roof_measurements')
          .select('vendor_report_id, vector_diagram_svg, linear_features_wkt, perimeter_wkt, target_lat, target_lng, predominant_pitch, total_area_adjusted_sqft, created_at')
          .in('vendor_report_id', missingReportIds)
          .order('created_at', { ascending: false });

        if (measByVendor) {
          for (const measurement of measByVendor) {
            if (!measurement.vendor_report_id || measurementMap[measurement.vendor_report_id]) continue;
            measurementMap[measurement.vendor_report_id] = measurement as AiMeasurementPreview;
          }
        }
      }

      // Strategy 3: Fallback - look up measurements by lat/lng coordinates
      const sessionsWithoutMeas = (data || []).filter(s => s.vendor_report_id && !measurementMap[s.vendor_report_id!] && (s as any).lat && (s as any).lng);
      for (const s of sessionsWithoutMeas.slice(0, 20)) {
        const { data: measByCoords } = await supabase
          .from('roof_measurements')
          .select('id, vendor_report_id, vector_diagram_svg, linear_features_wkt, perimeter_wkt, target_lat, target_lng, predominant_pitch, total_area_adjusted_sqft, created_at')
          .eq('target_lat', (s as any).lat)
          .eq('target_lng', (s as any).lng)
          .order('created_at', { ascending: false })
          .limit(1);

        if (measByCoords?.[0] && s.vendor_report_id) {
          measurementMap[s.vendor_report_id] = measByCoords[0] as AiMeasurementPreview;
        }
      }

      return (data || []).map(s => ({
        ...s,
        vendor_provider: s.vendor_report_id ? reportMap[s.vendor_report_id]?.provider : null,
        has_source_file: s.vendor_report_id ? reportMap[s.vendor_report_id]?.has_file ?? false : false,
        has_diagram: s.vendor_report_id ? reportMap[s.vendor_report_id]?.has_diagram ?? false : false,
        source_file_url: s.vendor_report_id ? reportMap[s.vendor_report_id]?.file_url ?? null : null,
        vendor_diagram_url: s.vendor_report_id ? reportMap[s.vendor_report_id]?.diagram_image_url ?? null : null,
        ai_diagram_svg: s.vendor_report_id ? measurementMap[s.vendor_report_id]?.vector_diagram_svg ?? null : null,
        ai_linear_features: s.vendor_report_id ? measurementMap[s.vendor_report_id]?.linear_features_wkt ?? null : null,
        ai_perimeter_wkt: s.vendor_report_id ? measurementMap[s.vendor_report_id]?.perimeter_wkt ?? null : null,
        ai_coordinates: s.vendor_report_id && measurementMap[s.vendor_report_id]?.target_lat != null && measurementMap[s.vendor_report_id]?.target_lng != null
          ? {
              lat: measurementMap[s.vendor_report_id]!.target_lat!,
              lng: measurementMap[s.vendor_report_id]!.target_lng!,
            }
          : (s as any).lat && (s as any).lng ? { lat: (s as any).lat, lng: (s as any).lng } : null,
        ai_pitch: s.vendor_report_id ? measurementMap[s.vendor_report_id]?.predominant_pitch ?? null : null,
        ai_total_area: s.vendor_report_id ? measurementMap[s.vendor_report_id]?.total_area_adjusted_sqft ?? null : null,
      })) as unknown as VerificationSession[];
    },
    enabled: !!activeCompanyId,
  });

  // Poll while running to show live progress
  useEffect(() => {
    if (isRunning) {
      pollRef.current = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions'] });
      }, 5000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isRunning, queryClient]);



  const stats = {
    total: sessions.length,
    confirmed: sessions.filter(s => s.verification_verdict === 'confirmed').length,
    denied: sessions.filter(s => s.verification_verdict === 'denied').length,
    pending: sessions.filter(s => !s.verification_verdict && s.verification_status !== 'failed' && s.verification_status !== 'skipped').length,
    failed: sessions.filter(s => s.verification_status === 'failed').length,
    processing: sessions.filter(s => s.verification_status === 'processing' || s.verification_status === 'queued').length,
    missingSource: sessions.filter(s => !s.has_source_file && !s.has_diagram).length,
  };

  const progressPct = stats.total > 0 ? ((stats.confirmed + stats.denied + stats.failed) / stats.total) * 100 : 0;

  const handleRelinkDiagrams = async () => {
    setIsRunning(true);
    try {
      // Reset all confirmed/denied sessions so they re-verify with the new linking logic
      const { error: resetError } = await supabase
        .from('roof_training_sessions')
        .update({
          verification_status: null,
          verification_verdict: null,
          verification_notes: null,
          verification_run_at: null,
          verification_feature_breakdown: null,
          ai_totals: null,
          ai_measurement_id: null,
        })
        .eq('tenant_id', activeCompanyId!)
        .eq('ground_truth_source', 'vendor_report')
        .not('vendor_report_id', 'is', null);

      if (resetError) throw resetError;

      toast.info('Reset all sessions — now re-verifying with diagram linking...');
      await queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions', activeCompanyId] });

      // Now run the batch verification which will re-link diagrams
      setIsRunning(false);
      await handleRunBatch();
    } catch (err: any) {
      console.error('Re-link error:', err);
      toast.error(err?.message || 'Failed to re-link diagrams');
      setIsRunning(false);
    }
  };

  const handleRunBatch = async () => {
    setIsRunning(true);
    const CHUNK_SIZE = 5;
    const MAX_BATCH_CALLS = 200;
    let totalProcessed = 0, totalConfirmed = 0, totalDenied = 0, totalFailed = 0, totalSkipped = 0;
    let hasMore = true;
    let batchCalls = 0;
    let consecutiveEmpty = 0;

    try {
      // Reset stale processing/queued AND previously failed sessions so they get retried
      await supabase.functions.invoke('measure', {
        body: { action: 'batch-verify-vendor-reports', resetFailed: true, resetStale: true, limit: 0 },
      });

      // Process in small chunks to avoid edge function timeouts
      while (hasMore && batchCalls < MAX_BATCH_CALLS) {
        batchCalls += 1;
        const { data, error } = await supabase.functions.invoke('measure', {
          body: { action: 'batch-verify-vendor-reports', limit: CHUNK_SIZE },
        });

        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || 'Verification failed');

        totalProcessed += (data.processed || 0);
        totalConfirmed += (data.confirmed || 0);
        totalDenied += (data.denied || 0);
        totalFailed += (data.failed || 0);
        totalSkipped += (data.skipped || 0);

        // Refresh UI between chunks
        await queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions', activeCompanyId] });

        const chunkWorkCount = (data.processed || 0) + (data.failed || 0);
        const remaining = data.remaining ?? -1;
        
        // Stop if no remaining or no work done consecutively
        if (remaining === 0) {
          hasMore = false;
        } else if (chunkWorkCount === 0) {
          consecutiveEmpty++;
          hasMore = consecutiveEmpty < 5; // More tolerance before stopping
        } else {
          consecutiveEmpty = 0;
          hasMore = true;
        }

        if (hasMore) {
          toast.info(`Batch ${batchCalls}: ${totalProcessed} verified, ${totalFailed} failed, ~${remaining > 0 ? remaining : '?'} remaining...`);
          await new Promise(r => setTimeout(r, 500));
        }
      }

      const msg = `Done! ${totalProcessed} verified: ${totalConfirmed} confirmed, ${totalDenied} denied` +
        (totalFailed > 0 ? `, ${totalFailed} failed` : '') +
        (totalSkipped > 0 ? `, ${totalSkipped} skipped (no vendor data)` : '');
      toast.success(msg);
      await queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions', activeCompanyId] });
    } catch (err: any) {
      console.error('Batch verification error:', err);
      toast.error(err?.message || 'Batch verification failed — check edge function logs');
    } finally {
      setIsRunning(false);
    }
  };

  const handleToggleVerdict = async (sessionId: string, currentVerdict: string | null) => {
    const newVerdict = currentVerdict === 'confirmed' ? 'denied' : 'confirmed';
    const { error } = await supabase
      .from('roof_training_sessions')
      .update({ verification_verdict: newVerdict, verification_run_at: new Date().toISOString() } as any)
      .eq('id', sessionId);

    if (error) {
      toast.error('Failed to update verdict');
      return;
    }
    toast.success(`Verdict changed to ${newVerdict}`);
    queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions', activeCompanyId] });
  };

  const handleSaveNotes = async (sessionId: string) => {
    const { error } = await supabase
      .from('roof_training_sessions')
      .update({ verification_notes: notesText } as any)
      .eq('id', sessionId);

    if (error) {
      toast.error('Failed to save notes');
      return;
    }
    setEditingNotes(null);
    queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions', activeCompanyId] });
  };

  const handleRunOne = async (sessionId: string) => {
    setRunningOneId(sessionId);
    try {
      // Reset this single session and clear stale AI links so the clicked row is forced
      // through a fresh measurement + diagram persistence pass.
      const { error: resetErr } = await supabase
        .from('roof_training_sessions')
        .update({
          verification_status: null,
          verification_verdict: null,
          verification_notes: null,
          verification_run_at: null,
          verification_feature_breakdown: null,
          ai_totals: null,
          ai_measurement_id: null,
          original_ai_measurement_id: null,
        } as any)
        .eq('id', sessionId);
      if (resetErr) throw resetErr;

      // Run the exact row the user clicked.
      const { data, error } = await supabase.functions.invoke('measure', {
        body: { action: 'batch-verify-vendor-reports', limit: 1, sessionId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Run failed');

      const detail = Array.isArray(data.details) ? data.details[0] : null;
      if ((data.failed || 0) > 0) {
        toast.error(detail?.reason ? `Run failed — ${detail.reason}` : 'Run failed for this report');
      } else if ((data.processed || 0) > 0) {
        toast.success(
          `Run complete — ${data.confirmed || 0} confirmed, ${data.denied || 0} denied`,
        );
      } else {
        toast.info(data.message || 'This report was not eligible to run');
      }

      await queryClient.invalidateQueries({
        queryKey: ['vendor-verification-sessions', activeCompanyId],
      });
    } catch (err: any) {
      console.error('Run one error:', err);
      toast.error(err?.message || 'Failed to run AI measurement');
    } finally {
      setRunningOneId(null);
    }
  };

  const handleVerifyCoverage = async () => {
    setIsCheckingCoverage(true);
    setCoverageReport(null);
    try {
      // 1. Pull every paid vendor report for this tenant
      const { data: reports, error: reportsErr } = await supabase
        .from('roof_vendor_reports')
        .select('id')
        .eq('tenant_id', activeCompanyId!);
      if (reportsErr) throw reportsErr;

      const allReports = reports || [];
      const reportIds = allReports.map(r => r.id);

      // 2. Find which ones already have a linked AI measurement
      let linkedReportIds = new Set<string>();
      if (reportIds.length > 0) {
        const { data: linked } = await supabase
          .from('roof_measurements')
          .select('vendor_report_id')
          .in('vendor_report_id', reportIds)
          .not('vendor_report_id', 'is', null);
        for (const m of linked || []) {
          if (m.vendor_report_id) linkedReportIds.add(m.vendor_report_id);
        }
      }

      const missing = allReports.filter(r => !linkedReportIds.has(r.id));

      // 3. Queue AI measurements for the missing ones via the measure edge function
      let queued = 0;
      if (missing.length > 0) {
        const { data: queueRes, error: queueErr } = await supabase.functions.invoke('measure', {
          body: {
            action: 'queue-missing-ai-measurements',
            vendor_report_ids: missing.map(r => r.id),
          },
        });
        if (queueErr) {
          console.warn('Queue missing AI failed:', queueErr);
          toast.warning(`Coverage checked but queueing failed: ${queueErr.message}`);
        } else {
          queued = queueRes?.queued ?? 0;
        }
      }

      const report = {
        total: allReports.length,
        withAi: linkedReportIds.size,
        missing: missing.length,
        queued,
      };
      setCoverageReport(report);

      if (missing.length === 0) {
        toast.success(`All ${report.total} paid reports have an AI measurement linked ✓`);
      } else {
        toast.info(`${report.withAi}/${report.total} covered. Queued ${queued} for AI generation.`);
      }

      await queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions', activeCompanyId] });
    } catch (err: any) {
      console.error('Coverage check error:', err);
      toast.error(err?.message || 'Coverage check failed');
    } finally {
      setIsCheckingCoverage(false);
    }
  };

  const handleCompareAndTrain = async () => {
    setIsTraining(true);
    const CHUNK_SIZE = 5;
    const MAX_BATCH_CALLS = 200;
    let totalProcessed = 0, totalConfirmed = 0, totalDenied = 0, totalFailed = 0;
    let hasMore = true;
    let batchCalls = 0;
    let consecutiveEmpty = 0;

    try {
      // Reset stale processing/queued and previously failed sessions so they all re-train
      await supabase.functions.invoke('measure', {
        body: { action: 'batch-verify-vendor-reports', resetFailed: true, resetStale: true, limit: 0 },
      });

      while (hasMore && batchCalls < MAX_BATCH_CALLS) {
        batchCalls += 1;
        const { data, error } = await supabase.functions.invoke('measure', {
          body: {
            action: 'batch-verify-vendor-reports',
            limit: CHUNK_SIZE,
            useVendorAsGroundTruth: true,
            trainingMode: true,
          },
        });

        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || 'Compare & train failed');

        totalProcessed += (data.processed || 0);
        totalConfirmed += (data.confirmed || 0);
        totalDenied += (data.denied || 0);
        totalFailed += (data.failed || 0);

        await queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions', activeCompanyId] });

        const chunkWorkCount = (data.processed || 0) + (data.failed || 0);
        const remaining = data.remaining ?? -1;

        if (remaining === 0) {
          hasMore = false;
        } else if (chunkWorkCount === 0) {
          consecutiveEmpty++;
          hasMore = consecutiveEmpty < 5;
        } else {
          consecutiveEmpty = 0;
          hasMore = true;
        }

        if (hasMore) {
          toast.info(`Training batch ${batchCalls}: ${totalProcessed} compared, ${totalFailed} failed, ~${remaining > 0 ? remaining : '?'} remaining`);
          await new Promise(r => setTimeout(r, 500));
        }
      }

      toast.success(
        `Training complete — ${totalProcessed} compared (${totalConfirmed} matched vendor, ${totalDenied} diverged${totalFailed > 0 ? `, ${totalFailed} failed` : ''})`
      );
      await queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions', activeCompanyId] });
    } catch (err: any) {
      console.error('Compare & train error:', err);
      toast.error(err?.message || 'Compare & train failed');
    } finally {
      setIsTraining(false);
    }
  };

  const handleExportTrainingSet = async () => {
    setIsExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'export-unet-training-set',
        { body: {} },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Export failed');

      toast.success(
        `Exported ${data.data.included_records} training records (${data.data.skipped} skipped)`,
      );

      // Open signed URL in a new tab so the user can download the JSONL
      if (data.data.signed_url) {
        window.open(data.data.signed_url, '_blank', 'noopener');
      }
    } catch (err: any) {
      console.error('Export training set error:', err);
      toast.error(err?.message || 'Failed to export training set');
    } finally {
      setIsExporting(false);
    }
  };

  const getVarianceColor = (pct: number) => {
    const abs = Math.abs(pct);
    if (abs < 5) return 'text-green-500';
    if (abs < 15) return 'text-yellow-500';
    return 'text-destructive';
  };

  const getVarianceBg = (pct: number) => {
    const abs = Math.abs(pct);
    if (abs < 5) return 'bg-green-500';
    if (abs < 15) return 'bg-yellow-500';
    return 'bg-destructive';
  };

  const getStatusIcon = (session: VerificationSession) => {
    if (session.verification_status === 'processing' || session.verification_status === 'queued') {
      return <Loader2 className="h-3 w-3 animate-spin text-blue-500" />;
    }
    if (session.verification_status === 'failed') {
      return <XCircle className="h-3 w-3 text-destructive" />;
    }
    if (session.verification_verdict === 'confirmed') {
      return <CheckCircle className="h-3 w-3 text-green-500" />;
    }
    if (session.verification_verdict === 'denied') {
      return <XCircle className="h-3 w-3 text-destructive" />;
    }
    return <Clock className="h-3 w-3 text-muted-foreground" />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Vendor Report Verification</h2>
          <p className="text-sm text-muted-foreground">
            AI generates diagrams for each house, then verifies against paid vendor reports
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleVerifyCoverage}
            disabled={isCheckingCoverage || isTraining || isRunning}
          >
            {isCheckingCoverage ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            Verify AI Coverage
          </Button>
          <Button
            onClick={handleCompareAndTrain}
            disabled={isTraining || isCheckingCoverage || isRunning}
            size="lg"
          >
            {isTraining ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            {isTraining ? 'Comparing & Training...' : 'Compare & Train from Vendor Reports'}
          </Button>
        </div>
      </div>

      {coverageReport && (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">{coverageReport.total}</p>
                <p className="text-xs text-muted-foreground">Paid Reports</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-500">{coverageReport.withAi}</p>
                <p className="text-xs text-muted-foreground">With AI Measurement</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-orange-500">{coverageReport.missing}</p>
                <p className="text-xs text-muted-foreground">Missing AI</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-500">{coverageReport.queued}</p>
                <p className="text-xs text-muted-foreground">Queued for Generation</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress bar */}
      {isRunning && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Processing houses...</span>
            <span>{Math.round(progressPct)}% complete</span>
          </div>
          <Progress value={progressPct} className="h-2" />
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-sm text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-green-500">{stats.confirmed}</p>
            <p className="text-sm text-muted-foreground">Confirmed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-destructive">{stats.denied}</p>
            <p className="text-sm text-muted-foreground">Denied</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-yellow-500">{stats.pending}</p>
            <p className="text-sm text-muted-foreground">Pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-destructive/70">{stats.failed}</p>
            <p className="text-sm text-muted-foreground">Failed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-orange-500">{stats.missingSource}</p>
            <p className="text-sm text-muted-foreground">No Source</p>
          </CardContent>
        </Card>
      </div>

      {/* Results Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verification Results</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No vendor report sessions found. Import reports first via Bulk Import.
            </p>
          ) : (
            <Table className="min-w-[1280px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 whitespace-nowrap"></TableHead>
                  <TableHead className="whitespace-nowrap">Address</TableHead>
                  <TableHead className="whitespace-nowrap">Provider</TableHead>
                  <TableHead className="whitespace-nowrap">Source</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="whitespace-nowrap">Score</TableHead>
                  <TableHead className="whitespace-nowrap">Ridge Δ</TableHead>
                  <TableHead className="whitespace-nowrap">Hip Δ</TableHead>
                  <TableHead className="whitespace-nowrap">Valley Δ</TableHead>
                  <TableHead className="whitespace-nowrap">Verdict</TableHead>
                  <TableHead className="w-20 whitespace-nowrap">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map(session => {
                  const fb = session.verification_feature_breakdown;
                  const isExpanded = expandedRow === session.id;
                  const hasAiDrawing = !!(
                    session.ai_diagram_svg ||
                    session.ai_perimeter_wkt ||
                    (session.ai_linear_features && session.ai_linear_features.length > 0)
                  );

                  return (
                    <>
                      <TableRow
                        key={session.id}
                        className="cursor-pointer"
                        onClick={() => setExpandedRow(isExpanded ? null : session.id)}
                      >
                        <TableCell>
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-medium text-sm">
                          {session.property_address || 'Unknown address'}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground capitalize">
                            {session.vendor_provider || '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {session.has_source_file ? (
                            <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">PDF</Badge>
                          ) : session.has_diagram ? (
                            <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600">Diagram</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-600">
                              <FileWarning className="h-3 w-3 mr-1" />Data only
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {getStatusIcon(session)}
                            <span className="text-xs capitalize text-muted-foreground">
                              {session.verification_status || 'pending'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {session.verification_score != null ? (
                            <span className={session.verification_score >= 85 ? 'text-green-500 font-semibold' : 'text-destructive font-semibold'}>
                              {session.verification_score.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {['ridge', 'hip', 'valley'].map(type => (
                          <TableCell key={type}>
                            {fb?.[type] ? (
                              <span className={getVarianceColor(fb[type].variance_pct)}>
                                {fb[type].variance_pct > 0 ? '+' : ''}{fb[type].variance_pct.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        ))}
                        <TableCell>
                          {session.verification_verdict === 'confirmed' && (
                            <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                              <CheckCircle className="h-3 w-3 mr-1" /> Confirmed
                            </Badge>
                          )}
                          {session.verification_verdict === 'denied' && (
                            <Badge variant="destructive">
                              <XCircle className="h-3 w-3 mr-1" /> Denied
                            </Badge>
                          )}
                          {session.verification_status === 'failed' && !session.verification_verdict && (
                            <Badge variant="destructive" className="opacity-70">
                              <AlertTriangle className="h-3 w-3 mr-1" /> Failed
                            </Badge>
                          )}
                          {!session.verification_verdict && session.verification_status !== 'failed' && (
                            <Badge variant="outline">
                              {session.verification_status === 'processing' || session.verification_status === 'queued'
                                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Running</>
                                : <><AlertTriangle className="h-3 w-3 mr-1" /> Pending</>
                              }
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Run AI measurement for this property"
                              disabled={runningOneId === session.id || isRunning}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRunOne(session.id);
                              }}
                            >
                              {runningOneId === session.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Play className="h-3 w-3" />
                              )}
                            </Button>
                            {session.verification_verdict && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleVerdict(session.id, session.verification_verdict);
                                }}
                              >
                                Flip
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow key={`${session.id}-detail`}>
                          <TableCell colSpan={11} className="bg-muted/30">
                            <div className="p-4 space-y-4">
                              {(fb || (session.ai_totals && session.traced_totals)) && (
                                <div className="space-y-2">
                                  <p className="text-sm font-medium">AI vs Vendor Comparison</p>
                                  {(fb ? Object.entries(fb) : Object.entries(session.traced_totals || {}).map(([type, vendor]) => [type, {
                                    ai: session.ai_totals?.[type] ?? 0,
                                    vendor: vendor as number,
                                    accuracy: vendor ? Math.min(100, ((session.ai_totals?.[type] ?? 0) / (vendor as number)) * 100) : 0,
                                    variance_pct: vendor ? (((session.ai_totals?.[type] ?? 0) - (vendor as number)) / (vendor as number)) * 100 : 0,
                                  }])).map(([type, data]) => (
                                    <div key={type as string} className="space-y-1">
                                      <div className="flex items-center justify-between text-sm">
                                        <span className="capitalize font-medium">{type as string}</span>
                                        <span className="text-muted-foreground">
                                          AI: {(data as any).ai.toFixed(1)}ft | Vendor: {(data as any).vendor.toFixed(1)}ft | Accuracy: {(data as any).accuracy.toFixed(1)}%
                                        </span>
                                      </div>
                                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                                        <div
                                          className={`h-full rounded-full transition-all ${getVarianceBg((data as any).variance_pct)}`}
                                          style={{ width: `${Math.min(100, (data as any).accuracy)}%` }}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {session.verification_status === 'failed' && session.verification_notes && (
                                <div className="p-3 bg-destructive/10 rounded-md border border-destructive/20">
                                  <p className="text-sm text-destructive font-medium">Failure Reason</p>
                                  <p className="text-sm text-destructive/80 mt-1">{session.verification_notes}</p>
                                </div>
                              )}

                              <div className="grid gap-4 lg:grid-cols-2">
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-sm font-medium">AI drawing</p>
                                      {!hasAiDrawing && (
                                        <span className="text-xs text-muted-foreground">Not generated yet</span>
                                      )}
                                    </div>

                                    {session.ai_diagram_svg ? (
                                      <div className="overflow-hidden rounded-md border bg-background p-2">
                                        <img
                                          src={`data:image/svg+xml;utf8,${encodeURIComponent(session.ai_diagram_svg)}`}
                                          alt={`AI roof drawing for ${session.property_address || 'property'}`}
                                          className="h-auto w-full"
                                          loading="lazy"
                                        />
                                      </div>
                                    ) : hasAiDrawing ? (
                                      <div className="overflow-hidden rounded-md border bg-background p-3">
                                        <RoofDiagramRenderer
                                          measurement={{
                                            perimeter_wkt: session.ai_perimeter_wkt,
                                            linear_features_wkt: session.ai_linear_features || [],
                                            summary: session.ai_total_area ? { total_area_sqft: session.ai_total_area } : undefined,
                                            predominant_pitch: session.ai_pitch,
                                          }}
                                          tags={{}}
                                          width={420}
                                          height={320}
                                          showLabels={false}
                                          showLengthLabels={false}
                                          showAreaLabels={false}
                                          showPitchLabels={false}
                                          showFacetOverlay={false}
                                        />
                                      </div>
                                    ) : (
                                      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                                        No AI roof drawing is attached to this session yet.
                                      </div>
                                    )}
                                  </div>

                                  <VendorEvidencePanel session={session} />
                                </div>

                              <div className="pt-2 border-t">
                                {editingNotes === session.id ? (
                                  <div className="space-y-2">
                                    <Textarea
                                      value={notesText}
                                      onChange={(e) => setNotesText(e.target.value)}
                                      placeholder="Add verification notes..."
                                      rows={3}
                                    />
                                    <div className="flex gap-2">
                                      <Button size="sm" onClick={() => handleSaveNotes(session.id)}>
                                        <Save className="h-3 w-3 mr-1" /> Save
                                      </Button>
                                      <Button size="sm" variant="ghost" onClick={() => setEditingNotes(null)}>
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-start justify-between">
                                    <p className="text-sm text-muted-foreground">
                                      {session.verification_notes || 'No notes'}
                                    </p>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => {
                                        setEditingNotes(session.id);
                                        setNotesText(session.verification_notes || '');
                                      }}
                                    >
                                      <Edit2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                )}
                              </div>

                              {session.verification_run_at && (
                                <p className="text-xs text-muted-foreground">
                                  Last verified: {new Date(session.verification_run_at).toLocaleString()}
                                </p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// VendorEvidencePanel
// Renders the parsed vendor diagram (vector segments extracted from the PDF)
// alongside controls/links. Surfaces the parsed length-totals back via local
// state so the parent comparison row could consume them in the future.
// ────────────────────────────────────────────────────────────────────────────
function VendorEvidencePanel({ session }: { session: VerificationSession }) {
  const [parsed, setParsed] = useState<ParsedDiagram | null>(null);
  const url = session.vendor_diagram_url;
  const isImage = url ? /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url) : false;
  const isPdf = url ? /\.pdf(\?|$)/i.test(url) : false;

  // Per-edge-type comparison: parsed vendor PDF lengths (relative units) vs
  // AI totals (real feet). We can only show the AI side in absolute feet —
  // the vendor parsed lengths are in PDF user units so we display the
  // *proportion* of total vendor linear footage made up by each type. That's
  // still useful: it tells us at a glance whether the AI is finding the same
  // mix of edge types the vendor diagram has.
  const vendorTotal = parsed
    ? Object.values(parsed.lengthsByType).reduce((a, b) => a + b, 0)
    : 0;
  const aiByType: Record<string, number> = {};
  for (const f of session.ai_linear_features || []) {
    const t = ((f as any)?.type || 'unknown').toLowerCase();
    aiByType[t] = (aiByType[t] || 0) + ((f as any)?.length_ft || 0);
  }
  const aiTotal = Object.values(aiByType).reduce((a, b) => a + b, 0);

  const ROWS: Array<{ key: string; label: string }> = [
    { key: 'ridge', label: 'Ridge' },
    { key: 'hip', label: 'Hip' },
    { key: 'valley', label: 'Valley' },
    { key: 'eave', label: 'Eave / Perimeter' },
    { key: 'rake', label: 'Rake' },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Vendor diagram (parsed vectors)</p>
        <div className="flex items-center gap-2 text-xs">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Open report
            </a>
          )}
          {session.source_file_url && session.source_file_url !== url && (
            <a
              href={session.source_file_url}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Source PDF
            </a>
          )}
        </div>
      </div>

      {url ? (
        isPdf ? (
          <VendorDiagramParsedCanvas url={url} width={420} height={320} onParsed={setParsed} />
        ) : isImage ? (
          <img
            src={url}
            alt={`Vendor diagram for ${session.property_address || session.id}`}
            className="h-80 w-full rounded-md border bg-background object-contain"
            loading="lazy"
          />
        ) : (
          <iframe
            src={url}
            title={`Vendor evidence for ${session.property_address || session.id}`}
            className="h-80 w-full rounded-md border bg-background"
          />
        )
      ) : (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No vendor diagram is attached to this report.
        </div>
      )}

      {parsed && vendorTotal > 0 && (
        <div className="rounded-md border bg-background p-2 text-xs">
          <p className="mb-1 font-medium text-muted-foreground">
            Edge-type mix (AI feet vs vendor proportion)
          </p>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5">
            {ROWS.map(({ key, label }) => {
              const vPct = ((parsed.lengthsByType[key] || 0) / vendorTotal) * 100;
              const aiFt = aiByType[key] || 0;
              const aiPct = aiTotal > 0 ? (aiFt / aiTotal) * 100 : 0;
              const delta = Math.abs(vPct - aiPct);
              const tone =
                delta < 5 ? 'text-green-500' : delta < 15 ? 'text-yellow-500' : 'text-destructive';
              return (
                <>
                  <span key={`${key}-l`} className="capitalize">{label}</span>
                  <span key={`${key}-ai`} className="text-muted-foreground">
                    AI {aiFt.toFixed(0)}ft ({aiPct.toFixed(0)}%)
                  </span>
                  <span key={`${key}-v`} className={tone}>
                    Vendor {vPct.toFixed(0)}%
                  </span>
                </>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

