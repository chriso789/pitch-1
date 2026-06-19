import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, RefreshCw, Sparkles, AlertTriangle, CheckCircle2, Lock, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  documentId: string;
  tenantId: string;
  onClose?: () => void;
}

interface ExtractionRow {
  id: string;
  document_class: string;
  confidence: number | null;
  extraction_status: string;
  extracted_fields: Record<string, any>;
  normalized_fields: Record<string, any>;
  validation_flags: Array<{ code: string; severity: string; message?: string; reason?: string }>;
  reviewed_at: string | null;
  approved_at: string | null;
  updated_at: string;
  contact_id: string | null;
  lead_id: string | null;
  pipeline_entry_id: string | null;
  job_id: string | null;
  match_metadata: any;
  workflow_metadata: any;
}

interface MatchCandidate {
  target_type: 'contact' | 'lead' | 'pipeline_entry' | 'job';
  target_id: string;
  score: number;
  matched_on: string[];
  display_label: string;
  current_values: Record<string, unknown>;
}

interface WorkflowAction {
  key: string;
  title: string;
  target_table: string | null;
  target_id: string | null;
  current_value: unknown;
  suggested_value: unknown;
  risk: 'low' | 'medium' | 'high';
  default_selected: boolean;
  reason: string;
}

const CLASSES = [
  'signed_contract','roofing_contract','supplier_invoice','customer_invoice','estimate',
  'insurance_scope','permit','notice_to_owner','lien_release','w9',
  'certificate_of_insurance','subcontractor_agreement','unknown',
];

interface ApplyEvent {
  id: string;
  target_table: string;
  target_id: string;
  field_name: string;
  old_value: any;
  new_value: any;
  confidence: number | null;
  action: 'apply' | 'skip' | 'review' | null;
  apply_status: 'pending' | 'applied' | 'skipped' | 'rejected' | 'conflict' | 'failed';
  apply_reason: string | null;
}

const SENSITIVE_FIELDS = new Set([
  'contract_amount','deposit_amount','balance_due','total','subtotal',
  'estimate_total','replacement_cost_value','actual_cash_value','deductible',
  'depreciation','amount_released','amount_claimed','policy_limits',
  'expiration_date','expiration_dates','legal_name','license_number',
  'tin','ssn','ein','tax_classification',
]);

export const DocumentExtractionPanel: React.FC<Props> = ({ documentId }) => {
  const [row, setRow] = useState<ExtractionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [events, setEvents] = useState<ApplyEvent[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [workflow, setWorkflow] = useState<{
    readiness: string; blocking_reasons: string[];
    checklist: Record<string, boolean>;
    suggested_actions: WorkflowAction[];
    duplicate_job_block?: boolean; duplicate_job_reason?: string | null;
  } | null>(null);
  const [actionSel, setActionSel] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('ai_document_extractions')
      .select('*')
      .eq('document_id', documentId)
      .maybeSingle();
    const r = (data as any) ?? null;
    setRow(r);
    if (r?.id) {
      await loadEvents(r.id);
      setCandidates((r.match_metadata?.candidates ?? []) as MatchCandidate[]);
    }
    setLoading(false);
  };

  const loadEvents = async (extractionId: string) => {
    const { data } = await supabase
      .from('ai_document_apply_events' as any)
      .select('*')
      .eq('extraction_id', extractionId)
      .order('created_at', { ascending: true });
    const list = ((data as any[]) ?? []) as ApplyEvent[];
    setEvents(list);
    const pre: Record<string, boolean> = {};
    for (const e of list) pre[e.id] = e.action === 'apply' && e.apply_status === 'pending';
    setSelected(pre);
  };

  useEffect(() => { load(); }, [documentId]);

  const invoke = async (fn: 'classify-document' | 'extract-document-fields', body: Record<string, unknown>) => {
    setBusy(fn);
    try {
      const { error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      toast.success(`${fn === 'classify-document' ? 'Classified' : 'Extracted'} successfully`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Request failed');
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!row) return;
    setBusy('approve');
    try {
      const { error } = await supabase
        .from('ai_document_extractions')
        .update({ approved_at: new Date().toISOString(), reviewed_at: new Date().toISOString() })
        .eq('id', row.id);
      if (error) throw error;
      toast.success('Approved');
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Approve failed');
    } finally { setBusy(null); }
  };

  const overrideClass = async (cls: string) => {
    if (!row) return;
    await supabase.from('ai_document_extractions').update({ document_class: cls }).eq('id', row.id);
    await invoke('extract-document-fields', { document_id: documentId, document_class: cls, force: true });
  };

  const generatePlan = async () => {
    if (!row) return;
    setBusy('plan');
    try {
      const { data, error } = await supabase.functions.invoke('plan-document-apply', { body: { extraction_id: row.id } });
      if (error) throw error;
      toast.success(`Generated ${data?.suggestions?.length ?? 0} suggestion(s)`);
      await loadEvents(row.id);
    } catch (e: any) {
      toast.error(e?.message ?? 'Plan failed');
    } finally { setBusy(null); }
  };

  const applySelected = async (approveConflicts = false) => {
    if (!row) return;
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    if (!ids.length) { toast.info('Select at least one suggestion'); return; }
    setBusy('apply');
    try {
      const { data, error } = await supabase.functions.invoke('apply-document-fields', {
        body: { extraction_id: row.id, apply_event_ids: ids, approve_conflicts: approveConflicts },
      });
      if (error) throw error;
      const applied = (data?.results ?? []).filter((r: any) => r.status === 'applied').length;
      toast.success(`Applied ${applied} field(s)`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Apply failed');
    } finally { setBusy(null); }
  };

  const rejectSelected = async () => {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    if (!ids.length) return;
    await supabase.from('ai_document_apply_events' as any)
      .update({ apply_status: 'rejected', apply_reason: 'user rejected' })
      .in('id', ids);
    toast.success(`Rejected ${ids.length} suggestion(s)`);
    if (row) await loadEvents(row.id);
  };

  const findMatches = async () => {
    if (!row) return;
    setBusy('match');
    try {
      const { data, error } = await supabase.functions.invoke('match-document-crm-records', {
        body: { extraction_id: row.id },
      });
      if (error) throw error;
      setCandidates((data?.candidates ?? []) as MatchCandidate[]);
      if (data?.auto_linked) toast.success(`Auto-linked to ${data.auto_linked.display_label}`);
      else toast.info(`Found ${data?.candidates?.length ?? 0} candidate(s)`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Match failed');
    } finally { setBusy(null); }
  };

  const linkTo = async (cand: MatchCandidate) => {
    if (!row) return;
    setBusy('link');
    try {
      const { error } = await supabase.functions.invoke('link-document-extraction', {
        body: { extraction_id: row.id, target_type: cand.target_type, target_id: cand.target_id },
      });
      if (error) throw error;
      toast.success(`Linked to ${cand.display_label}`);
      await load();
      await generatePlan();
    } catch (e: any) {
      toast.error(e?.message ?? 'Link failed');
    } finally { setBusy(null); }
  };

  const planContractWorkflow = async () => {
    if (!row) return;
    setBusy('plan-workflow');
    try {
      const { data, error } = await supabase.functions.invoke('plan-signed-contract-workflow', {
        body: { extraction_id: row.id },
      });
      if (error) throw error;
      setWorkflow(data);
      const pre: Record<string, boolean> = {};
      for (const a of (data?.suggested_actions ?? []) as WorkflowAction[]) pre[a.key] = !!a.default_selected;
      setActionSel(pre);
      toast.success(`Workflow readiness: ${data?.readiness}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Workflow plan failed');
    } finally { setBusy(null); }
  };

  const executeContractWorkflow = async () => {
    if (!row || !workflow) return;
    const keys = Object.entries(actionSel).filter(([, v]) => v).map(([k]) => k);
    if (!keys.length) { toast.info('Select at least one action'); return; }
    setBusy('exec-workflow');
    try {
      const { data, error } = await supabase.functions.invoke('execute-signed-contract-workflow', {
        body: { extraction_id: row.id, selected_actions: keys },
      });
      if (error) throw error;
      const applied = (data?.results ?? []).filter((r: any) => r.status === 'applied').length;
      toast.success(`Executed ${applied} action(s)`);
      await load();
      await planContractWorkflow();
    } catch (e: any) {
      toast.error(e?.message ?? 'Workflow execution failed');
    } finally { setBusy(null); }
  };


  if (loading) {
    return <Card><CardContent className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading extraction…</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            AI Extraction
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => invoke('classify-document', { document_id: documentId, force: true })}>
              {busy === 'classify-document' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              Re-classify
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => invoke('extract-document-fields', { document_id: documentId, force: true })}>
              {busy === 'extract-document-fields' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              Re-extract
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!row ? (
          <div className="text-sm text-muted-foreground">
            No extraction yet.{' '}
            <Button size="sm" variant="link" className="px-1" disabled={!!busy}
              onClick={() => invoke('classify-document', { document_id: documentId })}>
              Run classification
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{row.document_class}</Badge>
              <Badge variant="outline">{row.extraction_status}</Badge>
              {row.confidence != null && (
                <Badge variant={row.confidence >= 0.85 ? 'default' : 'outline'}>
                  {(row.confidence * 100).toFixed(0)}% confidence
                </Badge>
              )}
              {row.approved_at && <Badge className="bg-green-600 text-white"><CheckCircle2 className="w-3 h-3 mr-1" />Approved</Badge>}
            </div>

            <div className="space-y-2 border rounded p-3 bg-muted/20">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-medium">Linked CRM Record</div>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={findMatches}>
                  {busy === 'match' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                  Find Matching CRM Record
                </Button>
              </div>
              {(row.contact_id || row.pipeline_entry_id || row.job_id || row.lead_id) ? (
                <div className="text-xs space-y-1">
                  {row.contact_id && <div><Badge variant="secondary" className="mr-1">contact</Badge><span className="font-mono">{row.contact_id}</span></div>}
                  {row.pipeline_entry_id && <div><Badge variant="secondary" className="mr-1">pipeline</Badge><span className="font-mono">{row.pipeline_entry_id}</span></div>}
                  {row.job_id && <div><Badge variant="secondary" className="mr-1">job</Badge><span className="font-mono">{row.job_id}</span></div>}
                  {row.match_metadata?.auto_linked && (
                    <div className="text-muted-foreground">
                      Auto-linked · score {(Number(row.match_metadata.score ?? 0) * 100).toFixed(0)}%
                      {Array.isArray(row.match_metadata.matched_on) && row.match_metadata.matched_on.length > 0 && (
                        <span> · {row.match_metadata.matched_on.join(', ')}</span>
                      )}
                    </div>
                  )}
                  {row.match_metadata?.manual_linked && <div className="text-muted-foreground">Manually linked</div>}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No CRM record linked yet.</div>
              )}
              {candidates.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Candidates</div>
                  {candidates.map((c) => (
                    <div key={`${c.target_type}-${c.target_id}`} className="flex items-center justify-between gap-2 text-xs border rounded p-2 bg-background">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 flex-wrap">
                          <Badge variant="outline">{c.target_type}</Badge>
                          <Badge variant={c.score >= 0.85 ? 'default' : 'outline'}>{Math.round(c.score * 100)}%</Badge>
                          {c.matched_on.map((m) => <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>)}
                        </div>
                        <div className="truncate">{c.display_label}</div>
                      </div>
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => linkTo(c)}>Link</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>


            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Override document type</label>
              <div className="flex flex-wrap gap-1">
                {CLASSES.map((c) => (
                  <Button key={c} size="sm" variant={c === row.document_class ? 'default' : 'outline'}
                    disabled={!!busy} onClick={() => overrideClass(c)}>
                    {c}
                  </Button>
                ))}
              </div>
            </div>

            {row.validation_flags?.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Validation flags
                </div>
                {row.validation_flags.map((f, i) => (
                  <div key={i} className="text-xs">
                    <Badge variant={f.severity === 'error' ? 'destructive' : 'outline'} className="mr-2">{f.severity}</Badge>
                    <span className="font-mono">{f.code}</span>
                    {f.message && <span className="text-muted-foreground"> — {f.message}</span>}
                  </div>
                ))}
              </div>
            )}

            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Extracted fields</div>
              <div className="max-h-80 overflow-auto rounded border bg-muted/30 p-2">
                <table className="w-full text-xs">
                  <tbody>
                    {Object.entries(row.normalized_fields ?? {}).map(([k, v]) => (
                      <tr key={k} className="border-b last:border-0">
                        <td className="font-mono align-top py-1 pr-2 text-muted-foreground">{k}</td>
                        <td className="py-1 break-all">
                          {v == null ? <span className="text-muted-foreground italic">null</span>
                            : typeof v === 'object' ? <pre className="whitespace-pre-wrap font-mono text-[11px]">{JSON.stringify(v, null, 2)}</pre>
                            : String(v)}
                        </td>
                      </tr>
                    ))}
                    {Object.keys(row.normalized_fields ?? {}).length === 0 && (
                      <tr><td className="text-muted-foreground italic py-2">No fields extracted yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  CRM Apply Suggestions
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={generatePlan}>
                    {busy === 'plan' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
                    Generate Apply Plan
                  </Button>
                  <Button size="sm" disabled={!!busy || !events.length} onClick={() => applySelected(false)}>
                    {busy === 'apply' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                    Apply Selected Safe Fields
                  </Button>
                  <Button size="sm" variant="outline" disabled={!!busy || !events.length} onClick={() => applySelected(true)}>
                    Mark Conflict Resolved
                  </Button>
                  <Button size="sm" variant="outline" disabled={!!busy || !events.length} onClick={rejectSelected}>
                    Reject Selected
                  </Button>
                </div>
              </div>
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                AI-extracted values can be wrong. Review financial/legal fields before applying.
              </div>
              <div className="rounded border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="p-2 w-8"></th>
                      <th className="p-2">Target</th>
                      <th className="p-2">Field</th>
                      <th className="p-2">Current</th>
                      <th className="p-2">Suggested</th>
                      <th className="p-2">Confidence</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => {
                      const sensitive = SENSITIVE_FIELDS.has(e.field_name);
                      const done = ['applied','rejected','skipped','failed'].includes(e.apply_status);
                      return (
                        <tr key={e.id} className="border-t align-top">
                          <td className="p-2">
                            <Checkbox
                              checked={!!selected[e.id]}
                              disabled={done}
                              onCheckedChange={(v) => setSelected((s) => ({ ...s, [e.id]: !!v }))}
                            />
                          </td>
                          <td className="p-2 font-mono">{e.target_table}</td>
                          <td className="p-2 font-mono flex items-center gap-1">
                            {sensitive && <Lock className="w-3 h-3 text-amber-600" />}
                            {e.field_name}
                          </td>
                          <td className="p-2 break-all max-w-[160px]">{e.old_value == null ? <span className="text-muted-foreground italic">empty</span> : String(e.old_value)}</td>
                          <td className="p-2 break-all max-w-[200px]">{e.new_value == null ? '' : typeof e.new_value === 'object' ? JSON.stringify(e.new_value) : String(e.new_value)}</td>
                          <td className="p-2">{e.confidence != null ? `${Math.round(Number(e.confidence) * 100)}%` : '—'}</td>
                          <td className="p-2">
                            <Badge variant={
                              e.apply_status === 'applied' ? 'default' :
                              e.apply_status === 'conflict' ? 'destructive' :
                              e.apply_status === 'failed' || e.apply_status === 'rejected' ? 'destructive' :
                              'outline'
                            }>{e.apply_status}</Badge>
                          </td>
                          <td className="p-2 text-muted-foreground">{e.apply_reason}</td>
                        </tr>
                      );
                    })}
                    {events.length === 0 && (
                      <tr><td colSpan={8} className="p-3 text-muted-foreground italic text-center">No apply plan yet. Click “Generate Apply Plan”.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {['signed_contract', 'roofing_contract'].includes(row.document_class) && (
              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-sm font-medium">Signed Contract Workflow</div>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={planContractWorkflow}>
                      {busy === 'plan-workflow' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
                      Generate Contract Workflow
                    </Button>
                    <Button size="sm" disabled={!!busy || !workflow} onClick={executeContractWorkflow}>
                      {busy === 'exec-workflow' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                      Execute Selected Actions
                    </Button>
                  </div>
                </div>
                {workflow && (
                  <>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant={workflow.readiness === 'ready' ? 'default' : workflow.readiness === 'blocked' ? 'destructive' : 'outline'}>
                        readiness: {workflow.readiness}
                      </Badge>
                      {Object.entries(workflow.checklist ?? {}).map(([k, v]) => (
                        <Badge key={k} variant={v ? 'default' : 'outline'} className="text-[10px]">
                          {v ? '✓' : '○'} {k.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                    {workflow.blocking_reasons?.length > 0 && (
                      <div className="text-xs text-destructive">Blocking: {workflow.blocking_reasons.join(', ')}</div>
                    )}
                    {workflow.duplicate_job_block && (
                      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                        Duplicate job detected — {workflow.duplicate_job_reason}
                      </div>
                    )}
                    <div className="rounded border overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40">
                          <tr className="text-left">
                            <th className="p-2 w-8"></th>
                            <th className="p-2">Action</th>
                            <th className="p-2">Target</th>
                            <th className="p-2">Suggested</th>
                            <th className="p-2">Risk</th>
                            <th className="p-2">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {workflow.suggested_actions.map((a) => (
                            <tr key={a.key} className="border-t align-top">
                              <td className="p-2">
                                <Checkbox
                                  checked={!!actionSel[a.key]}
                                  onCheckedChange={(v) => setActionSel((s) => ({ ...s, [a.key]: !!v }))}
                                />
                              </td>
                              <td className="p-2">{a.title}</td>
                              <td className="p-2 font-mono text-[10px]">{a.target_table ?? '—'}</td>
                              <td className="p-2 break-all max-w-[200px]">{typeof a.suggested_value === 'object' ? JSON.stringify(a.suggested_value) : String(a.suggested_value)}</td>
                              <td className="p-2">
                                <Badge variant={a.risk === 'high' ? 'destructive' : a.risk === 'medium' ? 'outline' : 'secondary'}>
                                  {a.risk}
                                </Badge>
                              </td>
                              <td className="p-2 text-muted-foreground">{a.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" disabled={!!busy || !!row.approved_at} onClick={approve}>
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {row.approved_at ? 'Approved' : 'Approve extraction'}
              </Button>
            </div>

          </>
        )}
      </CardContent>
    </Card>
  );
};

export default DocumentExtractionPanel;
