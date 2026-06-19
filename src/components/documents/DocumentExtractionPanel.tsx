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
