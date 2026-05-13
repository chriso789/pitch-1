import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Upload,
  FileText,
  X,
  Loader2,
  CheckCircle,
  Package,
  ScanLine,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  MapPin,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface LineItem {
  description: string;
  quantity?: number;
  unit_price?: number;
  line_total?: number;
  unit_of_measure?: string;
  sku?: string;
  brand?: string;
  color?: string;
  style?: string;
  material_category?: string;
}

type RowStatus =
  | 'uploading'
  | 'scanning'
  | 'parsed'
  | 'duplicate'
  | 'submitting'
  | 'saved'
  | 'error';

interface InvoiceRow {
  id: string;
  fileName: string;
  status: RowStatus;
  errorMessage?: string;
  documentUrl?: string;
  signedUrl?: string;
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  invoice_amount: string;
  subtotal: string;
  tax_amount: string;
  notes: string;
  line_items: LineItem[];
  expanded: boolean;
  duplicateInfo?: {
    reason: string;
    existing: any;
  };
}

interface Props {
  projectId?: string;
  pipelineEntryId?: string;
  changeOrderId?: string;
  onSuccess?: (invoice: any) => void;
}

const newRow = (file: File): InvoiceRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  fileName: file.name,
  status: 'uploading',
  vendor_name: '',
  invoice_number: '',
  invoice_date: '',
  invoice_amount: '',
  subtotal: '',
  tax_amount: '',
  notes: '',
  line_items: [],
  expanded: false,
});

export const BatchMaterialInvoiceCard: React.FC<Props> = ({
  projectId,
  pipelineEntryId,
  changeOrderId,
  onSuccess,
}) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [submittingAll, setSubmittingAll] = useState(false);
  const [serviceAddress, setServiceAddress] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let address: string | null = null;
        let peId = pipelineEntryId;
        if (!peId && projectId) {
          const { data: p } = await supabase
            .from('projects')
            .select('pipeline_entry_id')
            .eq('id', projectId)
            .maybeSingle();
          peId = p?.pipeline_entry_id || undefined;
        }
        if (peId) {
          const { data: pe } = await supabase
            .from('pipeline_entries')
            .select('contact_id')
            .eq('id', peId)
            .maybeSingle();
          if (pe?.contact_id) {
            const { data: c } = await supabase
              .from('contacts')
              .select('address_street, address_city, address_state, address_zip')
              .eq('id', pe.contact_id)
              .maybeSingle();
            if (c) {
              address = [c.address_street, c.address_city, c.address_state, c.address_zip]
                .filter(Boolean).join(', ') || null;
            }
          }
        }
        if (!cancelled && address) setServiceAddress(address);
      } catch (e) {
        console.error('[BatchMaterialInvoiceCard] address lookup failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, pipelineEntryId]);

  const patchRow = (id: string, patch: Partial<InvoiceRow>) =>
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const removeRow = (id: string) =>
    setRows(prev => prev.filter(r => r.id !== id));

  const isLocalDuplicate = (row: InvoiceRow, others: InvoiceRow[]) => {
    if (!row.vendor_name) return false;
    return others.some(
      o =>
        o.id !== row.id &&
        o.status !== 'error' &&
        o.vendor_name.trim().toLowerCase() === row.vendor_name.trim().toLowerCase() &&
        ((row.invoice_number &&
          o.invoice_number.trim().toLowerCase() ===
            row.invoice_number.trim().toLowerCase()) ||
          (row.invoice_date &&
            o.invoice_date === row.invoice_date &&
            Number(o.invoice_amount) === Number(row.invoice_amount))),
    );
  };

  const uploadAndScan = async (file: File, row: InvoiceRow) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user?.id ?? '')
        .maybeSingle();
      if (!profile?.tenant_id) throw new Error('Tenant not found');

      const folderId = projectId || pipelineEntryId || 'unknown';
      const ext = file.name.split('.').pop();
      const path = `${profile.tenant_id}/${folderId}/material-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('project-invoices')
        .upload(path, file);
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage
        .from('project-invoices')
        .getPublicUrl(path);
      const { data: signed } = await supabase.storage
        .from('project-invoices')
        .createSignedUrl(path, 60 * 10);

      patchRow(row.id, {
        documentUrl: pub.publicUrl,
        signedUrl: signed?.signedUrl,
        status: 'scanning',
      });

      const { data, error } = await supabase.functions.invoke('parse-invoice-document', {
        body: {
          document_url: signed?.signedUrl,
          auto_persist: false,
          pipeline_entry_id: pipelineEntryId,
          project_id: projectId,
        },
      });
      if (error) throw error;
      const parsed = data?.parsed || {};
      const items: LineItem[] = parsed.line_items || [];
      const amount = parsed.total_amount || parsed.invoice_amount;

      patchRow(row.id, {
        status: 'parsed',
        vendor_name: parsed.vendor_name || '',
        invoice_number: parsed.invoice_number || '',
        invoice_date: parsed.invoice_date || '',
        invoice_amount: amount ? String(amount) : '',
        subtotal: parsed.subtotal ? String(parsed.subtotal) : '',
        tax_amount: parsed.tax_amount ? String(parsed.tax_amount) : '',
        notes: '',
        line_items: items,
      });
    } catch (e: any) {
      console.error('[BatchMaterialInvoiceCard] parse error', e);
      patchRow(row.id, { status: 'error', errorMessage: e.message || 'Parse failed' });
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || !files.length) return;
    const fileArr = Array.from(files);
    const created = fileArr.map(newRow);
    setRows(prev => [...prev, ...created]);
    fileArr.forEach((f, idx) => uploadAndScan(f, created[idx]));
  };

  const submitRow = async (row: InvoiceRow, allowDuplicate = false) => {
    if (!row.invoice_amount) {
      patchRow(row.id, { status: 'error', errorMessage: 'Total amount missing' });
      return;
    }
    patchRow(row.id, { status: 'submitting', errorMessage: undefined });
    const { data, error } = await supabase.functions.invoke('submit-project-invoice', {
      body: {
        project_id: projectId || null,
        pipeline_entry_id: pipelineEntryId || null,
        change_order_id: changeOrderId || null,
        invoice_type: 'material',
        vendor_name: row.vendor_name || null,
        invoice_number: row.invoice_number || null,
        invoice_date: row.invoice_date || null,
        invoice_amount: parseFloat(row.invoice_amount),
        subtotal: row.subtotal ? parseFloat(row.subtotal) : null,
        tax_amount: row.tax_amount ? parseFloat(row.tax_amount) : null,
        document_url: row.documentUrl || null,
        document_name: row.fileName,
        notes: row.notes || null,
        line_items: row.line_items,
        service_address: serviceAddress || null,
        allow_duplicate: allowDuplicate,
      },
    });
    if (error) {
      patchRow(row.id, { status: 'error', errorMessage: error.message });
      return;
    }
    if (data?.duplicate) {
      patchRow(row.id, {
        status: 'duplicate',
        duplicateInfo: { reason: data.duplicate_reason, existing: data.duplicate_invoice },
      });
      return;
    }
    patchRow(row.id, { status: 'saved' });
    onSuccess?.(data?.invoice);
  };

  const submitAll = async () => {
    setSubmittingAll(true);
    try {
      for (const r of rows) {
        if (r.status !== 'parsed') continue;
        if (isLocalDuplicate(r, rows)) {
          patchRow(r.id, {
            status: 'duplicate',
            duplicateInfo: {
              reason: 'duplicate of another invoice in this batch',
              existing: null,
            },
          });
          continue;
        }
        await submitRow(r, false);
      }
      toast({
        title: 'Batch processed',
        description: 'Review any duplicates flagged below.',
      });
    } finally {
      setSubmittingAll(false);
    }
  };

  const parsedCount = rows.filter(r => r.status === 'parsed').length;
  const savedCount = rows.filter(r => r.status === 'saved').length;
  const duplicateCount = rows.filter(r => r.status === 'duplicate').length;
  const errorCount = rows.filter(r => r.status === 'error').length;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-4 w-4 text-blue-500" />
          Material Invoices
          <Badge variant="secondary" className="ml-2 text-xs">Batch</Badge>
          {rows.length > 0 && (
            <Badge variant="outline" className="ml-auto text-xs">
              {savedCount} saved · {parsedCount} ready · {duplicateCount} dup · {errorCount} err
            </Badge>
          )}
        </CardTitle>
        {serviceAddress && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
            <MapPin className="h-3.5 w-3.5" />
            <span>Filing under: {serviceAddress}</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-border rounded-md cursor-pointer hover:border-primary/50 transition-colors">
          <Upload className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Upload one or many invoices (PDF/Image) — fields auto-fill
          </span>
          <input
            type="file"
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg"
            multiple
            onChange={e => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>

        {rows.length > 0 && (
          <div className="space-y-2">
            {rows.map(row => (
              <RowCard
                key={row.id}
                row={row}
                onPatch={patch => patchRow(row.id, patch)}
                onRemove={() => removeRow(row.id)}
                onSubmit={() => submitRow(row, false)}
                onSubmitAnyway={() => submitRow(row, true)}
              />
            ))}
          </div>
        )}

        {rows.length > 0 && (
          <Button
            onClick={submitAll}
            disabled={submittingAll || parsedCount === 0}
            className="w-full"
          >
            {submittingAll ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Submit All ({parsedCount})
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

const STATUS_BADGE: Record<RowStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  uploading: { label: 'Uploading', cls: 'bg-muted text-muted-foreground', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  scanning:  { label: 'Scanning',  cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300', icon: <ScanLine className="h-3 w-3 animate-pulse" /> },
  parsed:    { label: 'Ready',     cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', icon: <CheckCircle className="h-3 w-3" /> },
  duplicate: { label: 'Duplicate', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300', icon: <AlertTriangle className="h-3 w-3" /> },
  submitting:{ label: 'Saving',    cls: 'bg-muted text-muted-foreground', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  saved:     { label: 'Saved',     cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', icon: <CheckCircle className="h-3 w-3" /> },
  error:     { label: 'Error',     cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', icon: <AlertTriangle className="h-3 w-3" /> },
};

const RowCard: React.FC<{
  row: InvoiceRow;
  onPatch: (p: Partial<InvoiceRow>) => void;
  onRemove: () => void;
  onSubmit: () => void;
  onSubmitAnyway: () => void;
}> = ({ row, onPatch, onRemove, onSubmit, onSubmitAnyway }) => {
  const badge = STATUS_BADGE[row.status];
  const editable = row.status === 'parsed' || row.status === 'duplicate' || row.status === 'error';

  return (
    <div className="border border-border rounded-md">
      <div className="flex items-center gap-2 p-2 bg-muted/30">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm flex-1 truncate" title={row.fileName}>{row.fileName}</span>
        <Badge className={`flex items-center gap-1 text-xs ${badge.cls}`}>
          {badge.icon}
          {badge.label}
        </Badge>
        {editable && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onPatch({ expanded: !row.expanded })}
            title={row.expanded ? 'Collapse' : 'Expand'}
          >
            {row.expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        )}
        {row.status !== 'submitting' && row.status !== 'saved' && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {row.status === 'duplicate' && (
        <div className="px-3 py-2 text-xs bg-amber-50/60 dark:bg-amber-900/10 border-t border-border">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              Detected as duplicate{row.duplicateInfo?.reason ? `: ${row.duplicateInfo.reason}` : ''}.
              {row.duplicateInfo?.existing && (
                <span className="ml-1 text-muted-foreground">
                  Existing: ${row.duplicateInfo.existing.invoice_amount} on{' '}
                  {row.duplicateInfo.existing.invoice_date || 'unknown date'}.
                </span>
              )}
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onSubmitAnyway}>
              Save anyway
            </Button>
          </div>
        </div>
      )}

      {row.status === 'error' && row.errorMessage && (
        <div className="px-3 py-2 text-xs text-red-700 dark:text-red-300 bg-red-50/60 dark:bg-red-900/10 border-t border-border">
          {row.errorMessage}
        </div>
      )}

      {editable && row.expanded && (
        <div className="p-3 space-y-2 border-t border-border">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Vendor" value={row.vendor_name} onChange={v => onPatch({ vendor_name: v })} />
            <Field label="Invoice #" value={row.invoice_number} onChange={v => onPatch({ invoice_number: v })} />
            <Field label="Invoice Date" type="date" value={row.invoice_date} onChange={v => onPatch({ invoice_date: v })} />
            <Field label="Total Amount *" type="number" value={row.invoice_amount} onChange={v => onPatch({ invoice_amount: v })} />
            <Field label="Subtotal" type="number" value={row.subtotal} onChange={v => onPatch({ subtotal: v })} />
            <Field label="Tax" type="number" value={row.tax_amount} onChange={v => onPatch({ tax_amount: v })} />
          </div>

          {row.line_items.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="w-full text-xs">
                  {row.line_items.length} extracted line item{row.line_items.length !== 1 ? 's' : ''}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1">
                <div className="rounded border border-border overflow-hidden text-xs">
                  <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_5rem_5rem] gap-1 bg-muted/40 px-2 py-1 font-medium text-muted-foreground">
                    <span>Description</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Unit $</span>
                    <span className="text-right">Total</span>
                  </div>
                  <div className="divide-y divide-border max-h-48 overflow-auto">
                    {row.line_items.map((li, idx) => (
                      <div key={idx} className="grid grid-cols-[minmax(0,1fr)_3.5rem_5rem_5rem] gap-1 px-2 py-1">
                        <span className="truncate" title={li.description}>{li.description}</span>
                        <span className="text-right">{li.quantity ?? '—'}</span>
                        <span className="text-right">{li.unit_price != null ? `$${Number(li.unit_price).toFixed(2)}` : '—'}</span>
                        <span className="text-right font-mono">{li.line_total != null ? `$${Number(li.line_total).toFixed(2)}` : '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {row.status === 'parsed' && (
            <Button size="sm" className="w-full" onClick={onSubmit}>
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
              Submit this invoice
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

const Field: React.FC<{
  label: string;
  value: string;
  type?: string;
  onChange: (v: string) => void;
}> = ({ label, value, type = 'text', onChange }) => (
  <div>
    <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
    <Input
      type={type}
      step={type === 'number' ? '0.01' : undefined}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-8 text-xs"
    />
  </div>
);
