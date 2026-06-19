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

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('ai_document_extractions')
      .select('*')
      .eq('document_id', documentId)
      .maybeSingle();
    setRow((data as any) ?? null);
    if (data?.id) await loadEvents(data.id);
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
