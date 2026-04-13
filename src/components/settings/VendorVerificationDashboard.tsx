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
import { CheckCircle, XCircle, Loader2, AlertTriangle, ChevronDown, ChevronRight, Edit2, Save, Clock, Zap, FileWarning } from 'lucide-react';
import { toast } from 'sonner';

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
}

export function VendorVerificationDashboard() {
  const activeCompanyId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');
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
          ground_truth_source, vendor_report_id
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

      let reportMap: Record<string, { provider: string | null; has_file: boolean; has_diagram: boolean }> = {};
      if (reportIds.length > 0) {
        const { data: reports } = await supabase
          .from('roof_vendor_reports')
          .select('id, provider, file_path, file_url, diagram_image_url')
          .in('id', reportIds);

        if (reports) {
          for (const r of reports) {
            reportMap[r.id] = {
              provider: r.provider,
              has_file: !!(r.file_path || r.file_url),
              has_diagram: !!r.diagram_image_url,
            };
          }
        }
      }

      return (data || []).map(s => ({
        ...s,
        vendor_provider: s.vendor_report_id ? reportMap[s.vendor_report_id]?.provider : null,
        has_source_file: s.vendor_report_id ? reportMap[s.vendor_report_id]?.has_file ?? false : false,
        has_diagram: s.vendor_report_id ? reportMap[s.vendor_report_id]?.has_diagram ?? false : false,
      })) as VerificationSession[];
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
    pending: sessions.filter(s => !s.verification_verdict && s.verification_status !== 'failed').length,
    failed: sessions.filter(s => s.verification_status === 'failed').length,
    processing: sessions.filter(s => s.verification_status === 'processing' || s.verification_status === 'queued').length,
    missingSource: sessions.filter(s => !s.has_source_file && !s.has_diagram).length,
  };

  const progressPct = stats.total > 0 ? ((stats.confirmed + stats.denied + stats.failed) / stats.total) * 100 : 0;

  const handleRunBatch = async () => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('measure', {
        body: { action: 'batch-verify-vendor-reports' },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Verification failed');

      const msg = `Verified ${data.processed} of ${data.total}: ${data.confirmed} confirmed, ${data.denied} denied` +
        (data.failed > 0 ? `, ${data.failed} failed` : '');
      toast.success(msg);
      queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions'] });
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
    queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions'] });
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
    queryClient.invalidateQueries({ queryKey: ['vendor-verification-sessions'] });
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
        <Button onClick={handleRunBatch} disabled={isRunning || stats.pending === 0} size="lg">
          {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
          {isRunning ? `Verifying ${stats.processing} in progress...` : `Verify All ${stats.pending} Pending`}
        </Button>
      </div>

      {/* Progress bar */}
      {(isRunning || stats.processing > 0) && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Processing {stats.processing} houses...</span>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Ridge Δ</TableHead>
                  <TableHead>Hip Δ</TableHead>
                  <TableHead>Valley Δ</TableHead>
                  <TableHead>Verdict</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map(session => {
                  const fb = session.verification_feature_breakdown;
                  const isExpanded = expandedRow === session.id;

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
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow key={`${session.id}-detail`}>
                          <TableCell colSpan={11} className="bg-muted/30">
                            <div className="p-4 space-y-4">
                              {/* Feature breakdown bars */}
                              {fb && Object.entries(fb).map(([type, data]) => (
                                <div key={type} className="space-y-1">
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="capitalize font-medium">{type}</span>
                                    <span className="text-muted-foreground">
                                      AI: {data.ai.toFixed(1)}ft | Vendor: {data.vendor.toFixed(1)}ft | Accuracy: {data.accuracy.toFixed(1)}%
                                    </span>
                                  </div>
                                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${getVarianceBg(data.variance_pct)}`}
                                      style={{ width: `${Math.min(100, data.accuracy)}%` }}
                                    />
                                  </div>
                                </div>
                              ))}

                              {/* Failure reason */}
                              {session.verification_status === 'failed' && session.verification_notes && (
                                <div className="p-3 bg-destructive/10 rounded-md border border-destructive/20">
                                  <p className="text-sm text-destructive font-medium">Failure Reason</p>
                                  <p className="text-sm text-destructive/80 mt-1">{session.verification_notes}</p>
                                </div>
                              )}

                              {/* Missing source warning */}
                              {!session.has_source_file && !session.has_diagram && (
                                <div className="p-3 bg-orange-500/10 rounded-md border border-orange-500/20">
                                  <p className="text-sm text-orange-600 font-medium">Missing Source Evidence</p>
                                  <p className="text-sm text-orange-600/80 mt-1">
                                    This report has parsed data only — no PDF or diagram was saved during import.
                                    Re-import this report to enable full page-by-page verification.
                                  </p>
                                </div>
                              )}

                              {/* Notes */}
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
