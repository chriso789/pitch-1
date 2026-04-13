import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, XCircle, Loader2, Play, AlertTriangle, ChevronDown, ChevronRight, Edit2, Save } from 'lucide-react';
import { toast } from 'sonner';

interface VerificationSession {
  id: string;
  property_address: string | null;
  verification_verdict: string | null;
  verification_score: number | null;
  verification_notes: string | null;
  verification_run_at: string | null;
  verification_feature_breakdown: Record<string, { vendor: number; ai: number; accuracy: number; variance_pct: number }> | null;
  traced_totals: Record<string, number> | null;
  ai_totals: Record<string, number> | null;
  ground_truth_source: string | null;
  vendor_report_id: string | null;
}

export function VendorVerificationDashboard() {
  const { activeCompanyId } = useCompanySwitcher();
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['vendor-verification-sessions', activeCompanyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roof_training_sessions')
        .select('id, property_address, verification_verdict, verification_score, verification_notes, verification_run_at, verification_feature_breakdown, traced_totals, ai_totals, ground_truth_source, vendor_report_id')
        .eq('tenant_id', activeCompanyId!)
        .eq('ground_truth_source', 'vendor_report')
        .not('traced_totals', 'is', null)
        .order('verification_run_at', { ascending: false, nullsFirst: true });

      if (error) throw error;
      return (data || []) as unknown as VerificationSession[];
    },
    enabled: !!activeCompanyId,
  });

  const stats = {
    total: sessions.length,
    confirmed: sessions.filter(s => s.verification_verdict === 'confirmed').length,
    denied: sessions.filter(s => s.verification_verdict === 'denied').length,
    pending: sessions.filter(s => !s.verification_verdict).length,
  };

  const handleRunBatch = async () => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('measure', {
        body: { action: 'batch-verify-vendor-reports', limit: 3 },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Verification failed');

      const msg = `Verified ${data.processed} sessions: ${data.confirmed} confirmed, ${data.denied} denied` +
        (data.skipped > 0 ? `, ${data.skipped} skipped` : '');
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Vendor Report Verification</h2>
          <p className="text-sm text-muted-foreground">
            Compare AI measurements against paid vendor reports (EagleView/Roofr)
          </p>
        </div>
        <Button onClick={handleRunBatch} disabled={isRunning || stats.pending === 0}>
          {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          {isRunning ? 'Verifying...' : `Verify ${stats.pending} Pending`}
        </Button>
      </div>

      {isRunning && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Processing batch verification...</p>
          <Progress value={undefined} className="h-2" />
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
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
              No vendor report sessions found. Import reports first.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Ridge Δ</TableHead>
                  <TableHead>Hip Δ</TableHead>
                  <TableHead>Valley Δ</TableHead>
                  <TableHead>Eave Δ</TableHead>
                  <TableHead>Rake Δ</TableHead>
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
                          {session.verification_score != null ? (
                            <span className={session.verification_score >= 85 ? 'text-green-500 font-semibold' : 'text-destructive font-semibold'}>
                              {session.verification_score.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {['ridge', 'hip', 'valley', 'eave', 'rake'].map(type => (
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
                          {!session.verification_verdict && (
                            <Badge variant="outline">
                              <AlertTriangle className="h-3 w-3 mr-1" /> Pending
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
                          <TableCell colSpan={10} className="bg-muted/30">
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
