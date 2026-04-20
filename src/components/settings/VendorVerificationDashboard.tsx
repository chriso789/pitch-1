import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, XCircle, Loader2, AlertTriangle, ChevronDown, ChevronRight, Edit2, Save, Clock, Zap, FileWarning, Play, Wand2, MapPin, Settings2, ArrowUpDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { RoofDiagramRenderer } from '@/components/measurements/RoofDiagramRenderer';
import { VendorDiagramParsedCanvas, type ParsedDiagram } from './VendorDiagramParsedCanvas';
import { cleanAiDiagram } from './lib/cleanAiDiagram';
import { CoverageGapPanel } from './CoverageGapPanel';
import { RoofLineOverlayEditor } from '@/components/roof-measurement/RoofLineOverlayEditor';
import { PinConfirmDialog } from './PinConfirmDialog';

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
  id: string;
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
  ai_measurement_id?: string | null;
  last_failure_reason?: string | null;
  last_failure_stage?: string | null;
  imagery_sources_attempted?: string[] | null;
  vendor_provider?: string | null;
  has_source_file?: boolean;
  has_diagram?: boolean;
  source_file_url?: string | null;
  vendor_diagram_url?: string | null;
  ai_diagram_svg?: string | null;
  ai_linear_features?: Array<Record<string, any>> | null;
  ai_perimeter_wkt?: string | null;
  effective_ai_measurement_id?: string | null;
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
  const [isBackfillingAddresses, setIsBackfillingAddresses] = useState(false);
  const [isRunningAllAi, setIsRunningAllAi] = useState(false);
  const [overlayRefreshNonce, setOverlayRefreshNonce] = useState(0);
  const [addressSortDirection, setAddressSortDirection] = useState<'asc' | 'desc'>('asc');
  // Pin-confirm dialog state — opened when the user clicks Play. We require
  // the operator to drop a pin on the correct roof so the AI overlay crops
  // imagery on the actual house instead of a stale/off-parcel centroid.
  const [pinPrompt, setPinPrompt] = useState<{
    sessionId: string;
    lat: number;
    lng: number;
    address: string | null;
  } | null>(null);
  const [runAllAiProgress, setRunAllAiProgress] = useState<{
    backfilled: number;
    processed: number;
    confirmed: number;
    denied: number;
    failed: number;
    remaining: number;
  } | null>(null);
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
          ground_truth_source, vendor_report_id, ai_measurement_id, lat, lng,
          last_failure_reason, last_failure_stage, imagery_sources_attempted
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
          .select('id, vendor_report_id, vector_diagram_svg, linear_features_wkt, perimeter_wkt, target_lat, target_lng, predominant_pitch, total_area_adjusted_sqft, created_at')
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
        effective_ai_measurement_id:
          (s as any).ai_measurement_id ||
          (s.vendor_report_id ? measurementMap[s.vendor_report_id]?.id ?? null : null),
        ai_coordinates: s.vendor_report_id && measurementMap[s.vendor_report_id]?.target_lat != null && measurementMap[s.vendor_report_id]?.target_lng != null
          ? {
              lat: measurementMap[s.vendor_report_id]!.target_lat!,
              lng: measurementMap[s.vendor_report_id]!.target_lng!,
            }
          : (s as any).lat != null && (s as any).lng != null ? { lat: (s as any).lat, lng: (s as any).lng } : null,
        ai_pitch: s.vendor_report_id ? measurementMap[s.vendor_report_id]?.predominant_pitch ?? null : null,
        ai_total_area: s.vendor_report_id ? measurementMap[s.vendor_report_id]?.total_area_adjusted_sqft ?? null : null,
      })) as unknown as VerificationSession[];
    },
    enabled: !!activeCompanyId,
  });

  // Poll while running to show live progress
  useEffect(() => {
    if (isRunning || isRunningAllAi) {
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
  }, [isRunning, isRunningAllAi, queryClient]);

  useEffect(() => {
    if (!isRunningAllAi) return;

    const confirmedCount = sessions.filter((s) => s.verification_verdict === 'confirmed').length;
    const deniedCount = sessions.filter((s) => s.verification_verdict === 'denied').length;
    const failedCount = sessions.filter((s) => s.verification_status === 'failed').length;
    const pendingCount = sessions.filter(
      (s) => !s.verification_verdict && s.verification_status !== 'failed' && s.verification_status !== 'skipped',
    ).length;
    const processingCount = sessions.filter(
      (s) => s.verification_status === 'processing' || s.verification_status === 'queued',
    ).length;
    const completedCount = sessions.filter(
      (s) => !!s.verification_verdict || s.verification_status === 'failed' || s.verification_status === 'skipped',
    ).length;

    setRunAllAiProgress((prev) => prev ? {
      ...prev,
      processed: completedCount,
      confirmed: confirmedCount,
      denied: deniedCount,
      failed: failedCount,
      remaining: pendingCount,
    } : prev);

    if (pendingCount === 0 && processingCount === 0) {
      setIsRunningAllAi(false);
      toast.success('AI measurement batch finished in the background');
    }
  }, [isRunningAllAi, sessions]);

  const sortedSessions = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    return [...sessions].sort((a, b) => {
      const addressCompare = collator.compare(a.property_address?.trim() || '', b.property_address?.trim() || '');
      if (addressCompare !== 0) {
        return addressSortDirection === 'asc' ? addressCompare : -addressCompare;
      }

      return addressSortDirection === 'asc'
        ? a.id.localeCompare(b.id)
        : b.id.localeCompare(a.id);
    });
  }, [sessions, addressSortDirection]);



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
          verification_score: null,
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

  const handleRunOne = async (
    sessionId: string,
    coordOverride?: { lat: number; lng: number },
  ) => {
    setRunningOneId(sessionId);
    try {
      // If the operator confirmed a refined pin, persist it to the session row
      // FIRST so downstream measurement + overlay calls all crop on the right
      // parcel. We update lat/lng on roof_training_sessions (used for imagery
      // re-fetch) and propagate to any existing roof_measurements row.
      if (coordOverride) {
        await supabase
          .from('roof_training_sessions')
          .update({ lat: coordOverride.lat, lng: coordOverride.lng } as any)
          .eq('id', sessionId);
      }
      // Reset this single session and clear stale AI links so the clicked row is forced
      // through a fresh measurement + diagram persistence pass.
      const { error: resetErr } = await supabase
        .from('roof_training_sessions')
        .update({
          verification_status: null,
          verification_verdict: null,
          verification_score: null,
          verification_notes: null,
          verification_run_at: null,
          verification_feature_breakdown: null,
          ai_totals: null,
          ai_measurement_id: null,
          original_ai_measurement_id: null,
        } as any)
        .eq('id', sessionId);
      if (resetErr) throw resetErr;

      // Run the exact row the user clicked, forcing a fresh AI measurement
      // (skip the "reuse existing roof_measurements at these coords" path so
      // we always get a brand-new diagram instead of relinking the old one).
      const { data, error } = await supabase.functions.invoke('measure', {
        body: { action: 'batch-verify-vendor-reports', limit: 1, sessionId, forceRegenerate: true },
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

      // Generate the v28-style roof line overlay so the AI drawing area gets
      // a clean ridge/hip/valley/eave/rake annotation that can be reclassified
      // by hand and used as training data against the paid vendor parsed diagram.
      // Re-read the session row (instead of trusting `detail`) because the
      // measure function doesn't always echo lat/lng/ai_measurement_id back.
      try {
        const { data: refreshed } = await supabase
          .from('roof_training_sessions')
          .select('ai_measurement_id, lat, lng, vendor_report_id')
          .eq('id', sessionId)
          .maybeSingle();

        let lat = (refreshed as any)?.lat ?? detail?.lat ?? detail?.target_lat;
        let lng = (refreshed as any)?.lng ?? detail?.lng ?? detail?.target_lng;
        let measurementId: string | null =
          (refreshed as any)?.ai_measurement_id ||
          detail?.ai_measurement_id ||
          detail?.measurement_id ||
          null;

        // Fallback: find the most recent measurement linked to this vendor report
        if (!measurementId && (refreshed as any)?.vendor_report_id) {
          const { data: m } = await supabase
            .from('roof_measurements')
            .select('id, target_lat, target_lng')
            .eq('vendor_report_id', (refreshed as any).vendor_report_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          measurementId = m?.id || null;
          if (m?.target_lat != null && m?.target_lng != null) {
            lat = m.target_lat;
            lng = m.target_lng;
          }
        } else if (measurementId) {
          const { data: measurementCoords } = await supabase
            .from('roof_measurements')
            .select('target_lat, target_lng')
            .eq('id', measurementId)
            .maybeSingle();

          if (measurementCoords?.target_lat != null && measurementCoords?.target_lng != null) {
            lat = measurementCoords.target_lat;
            lng = measurementCoords.target_lng;
          }
        }

        // Confirmed-pin override always wins — also push it onto the
        // measurement row so future runs and the editor stay aligned.
        if (coordOverride) {
          lat = coordOverride.lat;
          lng = coordOverride.lng;
          if (measurementId) {
            await supabase
              .from('roof_measurements')
              .update({ target_lat: coordOverride.lat, target_lng: coordOverride.lng } as any)
              .eq('id', measurementId);
          }
        }

        if (measurementId && activeCompanyId && lat != null && lng != null) {
          toast.info('Generating roof line overlay…');
          const { error: ovErr } = await supabase.functions.invoke('generate-roof-line-overlay', {
            body: { measurement_id: measurementId, tenant_id: activeCompanyId, lat, lng },
          });
          if (ovErr) {
            const { data: existingOverlay } = await supabase
              .from('roof_line_overlays')
              .select('id, created_at')
              .eq('measurement_id', measurementId)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (existingOverlay) {
              toast.success('Roof line overlay generated');
              setOverlayRefreshNonce((value) => value + 1);
              await queryClient.invalidateQueries({
                queryKey: ['vendor-verification-sessions', activeCompanyId],
              });
            } else {
              console.warn('Overlay generation failed', ovErr);
              toast.error('Roof line overlay failed', { description: ovErr.message });
            }
          } else {
            toast.success('Roof line overlay generated');
            setOverlayRefreshNonce((value) => value + 1);
            await queryClient.invalidateQueries({
              queryKey: ['vendor-verification-sessions', activeCompanyId],
            });
          }
        } else {
          console.warn('Skipping overlay — missing data', { measurementId, lat, lng, sessionId });
          toast.warning(
            !measurementId
              ? 'Overlay skipped — no AI measurement linked yet. Click Run again once the measurement completes.'
              : 'Overlay skipped — measurement coordinates unavailable',
          );
        }
      } catch (ovErr: any) {
        console.warn('Overlay generation invoke failed', ovErr);
        toast.error('Overlay generation failed', { description: ovErr?.message });
      }
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
          queued = (queueRes?.queued ?? 0) + (queueRes?.reset ?? 0);
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
        toast.info(`${report.withAi}/${report.total} covered. Queued ${queued} for AI generation. Now click "Run AI on All Reports".`);
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

  /**
   * Fix tangled AI diagrams across every confirmed-or-better session.
   *
   *  - Stage 1 (cleanup): pull each session's existing AI linear features +
   *    perimeter, run cleanAiDiagram() to snap/dedupe/clip, and write the
   *    sanitized geometry back into roof_measurements. We also null out the
   *    cached vector_diagram_svg so the renderer regenerates from the now-clean
   *    feature list. This fixes the "X-shaped chaos" without re-measuring.
   *  - Stage 2 (re-queue): any session whose verification_score is < 80 (i.e.
   *    the structural deltas are still bad after cleanup) gets reset and
   *    requeued through batch-verify-vendor-reports for a full fresh AI run.
   */
  const handleFixAllDiagrams = async () => {
    setIsFixingDiagrams(true);
    setDiagramFixReport(null);

    let scanned = 0;
    let cleaned = 0;
    let segmentsRemoved = 0;
    let requeued = 0;

    try {
      // Pull all sessions for this tenant that have a vendor_report_id +
      // any AI measurement linked. We only need the AI measurement id +
      // the session's verification score to decide what to do.
      const { data: rows, error: rowsErr } = await supabase
        .from('roof_training_sessions')
        .select('id, verification_score, ai_measurement_id, vendor_report_id')
        .eq('tenant_id', activeCompanyId!)
        .eq('ground_truth_source', 'vendor_report')
        .not('vendor_report_id', 'is', null);
      if (rowsErr) throw rowsErr;

      const sessionRows = rows || [];
      scanned = sessionRows.length;
      if (scanned === 0) {
        toast.info('No vendor-linked sessions to fix.');
        return;
      }

      // Stage 1: cleanup pass on the AI measurement geometry.
      const aiIds = sessionRows
        .map((s) => (s as any).ai_measurement_id)
        .filter((id): id is string => !!id);

      if (aiIds.length > 0) {
        const { data: measurements } = await supabase
          .from('roof_measurements')
          .select('id, perimeter_wkt, linear_features_wkt')
          .in('id', aiIds);

        for (const m of measurements || []) {
          const features = Array.isArray(m.linear_features_wkt)
            ? (m.linear_features_wkt as any[])
            : [];
          if (features.length < 2) continue;

          const result = cleanAiDiagram(features as any, m.perimeter_wkt);
          if (result.removed === 0 && result.snapped === 0) continue;

          const { error: updateErr } = await supabase
            .from('roof_measurements')
            .update({
              linear_features_wkt: result.cleaned as any,
              vector_diagram_svg: null, // force renderer to redraw from clean features
            } as any)
            .eq('id', m.id);

          if (!updateErr) {
            cleaned++;
            segmentsRemoved += result.removed;
          }
        }
      }

      // Stage 2: re-queue sessions whose structural accuracy is still poor.
      const badSessions = sessionRows.filter(
        (s) => typeof s.verification_score === 'number' && s.verification_score < 80,
      );

      if (badSessions.length > 0) {
        const { error: resetErr } = await supabase
          .from('roof_training_sessions')
          .update({
            verification_status: null,
            verification_verdict: null,
            verification_score: null,
            verification_run_at: null,
            verification_feature_breakdown: null,
            ai_totals: null,
            ai_measurement_id: null,
          } as any)
          .in(
            'id',
            badSessions.map((s) => s.id),
          );

        if (!resetErr) {
          requeued = badSessions.length;
          // Kick a single batch run so the worker starts immediately;
          // the existing Compare & Train button can finish the rest.
          await supabase.functions.invoke('measure', {
            body: { action: 'batch-verify-vendor-reports', limit: 5 },
          });
        }
      }

      setDiagramFixReport({ scanned, cleaned, requeued, segmentsRemoved });
      toast.success(
        `Fixed ${cleaned}/${scanned} AI diagrams (${segmentsRemoved} bad segments removed). ${requeued} re-queued for full regeneration.`,
      );
      await queryClient.invalidateQueries({
        queryKey: ['vendor-verification-sessions', activeCompanyId],
      });
    } catch (err: any) {
      console.error('Fix diagrams error:', err);
      toast.error(err?.message || 'Failed to fix diagrams');
    } finally {
      setIsFixingDiagrams(false);
    }
  };

  /**
   * Run AI Measurements on EVERY vendor report.
   * --------------------------------------------
   * Two stages:
   *
   *   1. Backfill: for sessions whose verification already completed but whose
   *      `ai_measurement_id` is NULL (the actual bug behind "0/118 fixed"),
   *      find the most recent roof_measurements row near the session's coords
   *      and link it back. This unblocks the diagram render and the cleanup
   *      pass without re-running the AI engine.
   *
   *   2. Drain queue: loop `batch-verify-vendor-reports` (limit 5 per call so
   *      we don't time out) until `remaining === 0`. Each iteration generates
   *      AI measurements for any pending sessions and writes both `ai_totals`
   *      and `ai_measurement_id` back via the edge function's existing logic.
   *
   * Updates a progress toast / state card as it runs so the user sees the
   * counter tick down from 63 → 0.
   */
  const handleRunAllAiMeasurements = async () => {
    if (!activeCompanyId) {
      toast.error('No active company selected');
      return;
    }
    setIsRunningAllAi(true);
    setRunAllAiProgress({ backfilled: 0, processed: 0, confirmed: 0, denied: 0, failed: 0, remaining: 0 });

    try {
      // ---------- Stage 1: backfill ai_measurement_id by coordinate match ----------
      const { data: orphanSessions } = await supabase
        .from('roof_training_sessions')
        .select('id, lat, lng')
        .eq('tenant_id', activeCompanyId)
        .eq('ground_truth_source', 'vendor_report')
        .not('vendor_report_id', 'is', null)
        .is('ai_measurement_id', null)
        .not('lat', 'is', null)
        .not('lng', 'is', null);

      let backfilled = 0;
      for (const s of orphanSessions || []) {
        if (s.lat == null || s.lng == null) continue;
        const { data: nearby } = await supabase
          .from('roof_measurements')
          .select('id')
          .gte('target_lat', Number(s.lat) - 0.0001)
          .lte('target_lat', Number(s.lat) + 0.0001)
          .gte('target_lng', Number(s.lng) - 0.0001)
          .lte('target_lng', Number(s.lng) + 0.0001)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (nearby?.id) {
          const { error: linkErr } = await supabase
            .from('roof_training_sessions')
            .update({ ai_measurement_id: nearby.id, original_ai_measurement_id: nearby.id } as any)
            .eq('id', s.id);
          if (!linkErr) backfilled++;
        }
      }
      setRunAllAiProgress((p) => ({ ...(p || { processed: 0, confirmed: 0, denied: 0, failed: 0, remaining: 0 }), backfilled }));
      if (backfilled > 0) {
        toast.success(`Backfilled ${backfilled} measurement links`);
      }

      // ---------- Stage 1.5: reset sessions that need (re)processing ----------
      // (a) Old logic permanently marked rows with empty vendor totals as 'skipped'.
      // (b) Many "completed" sessions never actually got an ai_measurement_id written
      //     (legacy bug) — they have a verdict but no diagram. Reset those too so the
      //     batch picks them up and generates the missing AI measurement.
      const { data: unskipped } = await supabase
        .from('roof_training_sessions')
        .update({ verification_status: null, verification_score: null, verification_notes: null } as any)
        .eq('tenant_id', activeCompanyId)
        .eq('ground_truth_source', 'vendor_report')
        .eq('verification_status', 'skipped')
        .select('id');
      if ((unskipped?.length || 0) > 0) {
        toast.success(`Reset ${unskipped!.length} previously-skipped sessions`);
      }

      // Reset "completed" sessions that have no AI measurement linked — they need a re-run
      // so an AI diagram actually gets produced.
      const { data: resetCompleted } = await supabase
        .from('roof_training_sessions')
        .update({
          verification_status: null,
          verification_verdict: null,
          verification_score: null,
          verification_notes: null,
          verification_run_at: null,
          verification_feature_breakdown: null,
        } as any)
        .eq('tenant_id', activeCompanyId)
        .eq('ground_truth_source', 'vendor_report')
        .eq('verification_status', 'completed')
        .is('ai_measurement_id', null)
        .select('id');
      if ((resetCompleted?.length || 0) > 0) {
        toast.success(`Reset ${resetCompleted!.length} completed sessions missing AI diagrams`);
      }

      // Also reset stale processing/queued/failed so a full re-drain picks everything up
      await supabase.functions.invoke('measure', {
        body: { action: 'batch-verify-vendor-reports', resetFailed: true, resetStale: true, limit: 0 },
      });

      const { error: startErr } = await supabase.functions.invoke('measure', {
        body: {
          action: 'batch-verify-vendor-reports',
          runToCompletion: true,
          resetFailed: true,
          resetStale: true,
          limit: 1,
          maxIterations: 300,
        },
      });

      if (startErr) throw startErr;

      setRunAllAiProgress({
        backfilled,
        processed: 0,
        confirmed: stats.confirmed,
        denied: stats.denied,
        failed: stats.failed,
        remaining: stats.pending,
      });

      await queryClient.invalidateQueries({
        queryKey: ['vendor-verification-sessions', activeCompanyId],
      });

      toast.success('AI run started — counter will tick down as the queue drains.');
      // NOTE: do NOT clear isRunningAllAi here. The polling effect (which watches
      // sessions) clears it when pendingCount === 0 && processingCount === 0.
    } catch (err: any) {
      console.error('Run all AI error:', err);
      toast.error(err?.message || 'Failed to run AI measurements');
      setIsRunningAllAi(false);
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
            onClick={handleCompareAndTrain}
            disabled={isTraining || isCheckingCoverage || isRunning || isFixingDiagrams || isRunningAllAi || isBackfillingAddresses}
            size="lg"
          >
            {isTraining ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            {isTraining ? 'Comparing & Training...' : 'Compare & Train from Vendor Reports'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="lg"
                disabled={isTraining || isCheckingCoverage || isRunning || isFixingDiagrams || isRunningAllAi || isBackfillingAddresses}
              >
                <Settings2 className="h-4 w-4 mr-2" />
                Tools
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Maintenance</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleRunAllAiMeasurements} disabled={isRunningAllAi}>
                {isRunningAllAi ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                {isRunningAllAi
                  ? `Running… ${runAllAiProgress?.processed || 0}/${(runAllAiProgress?.processed || 0) + (runAllAiProgress?.remaining || 0)}`
                  : 'Run AI on all reports'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleFixAllDiagrams} disabled={isFixingDiagrams}>
                {isFixingDiagrams ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                Fix all AI diagrams
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Data quality</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleVerifyCoverage} disabled={isCheckingCoverage}>
                {isCheckingCoverage ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                Verify AI coverage
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isBackfillingAddresses}
                onClick={async () => {
                  setIsBackfillingAddresses(true);
                  try {
                    const { data, error } = await supabase.functions.invoke('backfill-verification-addresses', {
                      body: { tenantId: activeCompanyId },
                    });
                    if (error) throw error;
                    toast.success(`Backfilled ${data?.backfilled || 0} of ${data?.scanned || 0} addresses${data?.failed ? ` (${data.failed} unresolved)` : ''}`);
                    await queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions', activeCompanyId] });
                  } catch (err: any) {
                    console.error('Backfill addresses error', err);
                    toast.error(err?.message || 'Address backfill failed');
                  } finally {
                    setIsBackfillingAddresses(false);
                  }
                }}
              >
                {isBackfillingAddresses ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MapPin className="h-4 w-4 mr-2" />}
                Backfill missing addresses
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Coverage Gap — path to 100% */}
      <CoverageGapPanel
        sessions={sessions as any}
        tenantId={activeCompanyId ?? null}
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions', activeCompanyId] })}
      />

      {runAllAiProgress && (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-6 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">{runAllAiProgress.backfilled}</p>
                <p className="text-xs text-muted-foreground">Links Backfilled</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{runAllAiProgress.processed}</p>
                <p className="text-xs text-muted-foreground">Processed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-500">{runAllAiProgress.confirmed}</p>
                <p className="text-xs text-muted-foreground">Confirmed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-orange-500">{runAllAiProgress.denied}</p>
                <p className="text-xs text-muted-foreground">Denied</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-500">{runAllAiProgress.failed}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-500">{runAllAiProgress.remaining}</p>
                <p className="text-xs text-muted-foreground">Remaining</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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

      {diagramFixReport && (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">{diagramFixReport.scanned}</p>
                <p className="text-xs text-muted-foreground">Diagrams scanned</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-500">{diagramFixReport.cleaned}</p>
                <p className="text-xs text-muted-foreground">Cleaned in place</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-orange-500">{diagramFixReport.segmentsRemoved}</p>
                <p className="text-xs text-muted-foreground">Bad segments removed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-500">{diagramFixReport.requeued}</p>
                <p className="text-xs text-muted-foreground">Re-queued (acc &lt; 80%)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
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
                  <TableHead className="whitespace-nowrap">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto px-0 font-medium"
                      onClick={() => setAddressSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
                    >
                      Address
                      <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  </TableHead>
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
                {sortedSessions.map(session => {
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
                                // Require operator to confirm the parcel pin
                                // before running. Resolves cases where the
                                // cached lat/lng points at a neighbor's roof.
                                const lat =
                                  session.ai_coordinates?.lat ??
                                  (session as any).lat ??
                                  null;
                                const lng =
                                  session.ai_coordinates?.lng ??
                                  (session as any).lng ??
                                  null;
                                if (lat == null || lng == null) {
                                  toast.error(
                                    'No coordinates on file — geocode this address first.',
                                  );
                                  return;
                                }
                                setPinPrompt({
                                  sessionId: session.id,
                                  lat,
                                  lng,
                                  address: session.property_address,
                                });
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

                                    {session.effective_ai_measurement_id && (session.ai_coordinates || ((session as any).lat != null && (session as any).lng != null)) && activeCompanyId && (
                                      <div className="pt-2">
                                        <RoofLineOverlayEditor
                                          measurementId={session.effective_ai_measurement_id}
                                          tenantId={activeCompanyId}
                                          lat={Number(session.ai_coordinates?.lat ?? (session as any).lat)}
                                          lng={Number(session.ai_coordinates?.lng ?? (session as any).lng)}
                                          refreshKey={overlayRefreshNonce}
                                        />
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

    <PinConfirmDialog
      open={!!pinPrompt}
      onClose={() => setPinPrompt(null)}
      initialLat={pinPrompt?.lat ?? 0}
      initialLng={pinPrompt?.lng ?? 0}
      address={pinPrompt?.address ?? undefined}
      confirming={!!pinPrompt && runningOneId === pinPrompt.sessionId}
      onConfirm={async (lat, lng) => {
        if (!pinPrompt) return;
        const sessionId = pinPrompt.sessionId;
        // Detect whether the operator actually nudged the pin. If they used
        // the original cached coords, skip the override path entirely.
        const moved =
          Math.abs(lat - pinPrompt.lat) > 1e-7 ||
          Math.abs(lng - pinPrompt.lng) > 1e-7;
        setPinPrompt(null);
        await handleRunOne(sessionId, moved ? { lat, lng } : undefined);
      }}
    />
  </>
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

