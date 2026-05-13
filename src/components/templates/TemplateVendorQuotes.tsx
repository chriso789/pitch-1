import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

const PARSE_SUPPLIER_QUOTE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-supplier-quote`;

interface QuoteAttachment {
  document_id: string;
  filename: string;
  file_path: string;
  vendor_name: string | null;
  line_item_count: number;
  created_at: string;
}

interface Props {
  templateId: string;
}

export const TemplateVendorQuotes: React.FC<Props> = ({ templateId }) => {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'parsing' | 'saving'>('idle');
  const [attachments, setAttachments] = useState<QuoteAttachment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('estimate_template_attachments')
        .select(`
          document_id,
          documents!inner (id, filename, file_path, vendor_name, document_type, created_at)
        `)
        .eq('template_id', templateId);
      if (error) throw error;
      const quotes = (data || [])
        .filter((row: any) => row.documents?.document_type === 'vendor_quote')
        .map((row: any) => ({
          document_id: row.document_id,
          filename: row.documents.filename,
          file_path: row.documents.file_path,
          vendor_name: row.documents.vendor_name,
          created_at: row.documents.created_at,
          line_item_count: 0,
        }));

      if (quotes.length) {
        const { data: counts } = await supabase
          .from('vendor_quote_line_items')
          .select('document_id')
          .in('document_id', quotes.map((q) => q.document_id));
        const countMap = new Map<string, number>();
        (counts || []).forEach((row: any) => {
          countMap.set(row.document_id, (countMap.get(row.document_id) || 0) + 1);
        });
        quotes.forEach((q) => {
          q.line_item_count = countMap.get(q.document_id) || 0;
        });
      }
      setAttachments(quotes);
    } catch (e) {
      console.error('[TemplateVendorQuotes] load failed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (templateId) load();
  }, [templateId]);

  const handleFile = async (file: File) => {
    setBusy(true);
    setStage('uploading');
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) throw new Error('You must be signed in.');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', userId)
        .maybeSingle();
      const tenantId = profile?.tenant_id;
      if (!tenantId) throw new Error('Could not resolve your tenant.');

      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
      const filePath = `${tenantId}/templates/${templateId}/quote-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('vendor-quotes')
        .upload(filePath, file, { upsert: false, contentType: file.type || 'application/pdf' });
      if (upErr) throw upErr;

      const { data: signed, error: signErr } = await supabase.storage
        .from('vendor-quotes')
        .createSignedUrl(filePath, 60 * 10);
      if (signErr || !signed?.signedUrl) throw new Error('Could not sign URL for parsing.');

      // Create document row (template-scoped: no project_id)
      const { data: docRow, error: docErr } = await supabase
        .from('documents')
        .insert({
          tenant_id: tenantId,
          uploaded_by: userId,
          filename: file.name,
          file_path: filePath,
          file_size: file.size,
          mime_type: file.type || 'application/pdf',
          document_type: 'vendor_quote',
          description: 'Vendor material quote attached to estimate template',
        })
        .select()
        .single();
      if (docErr) throw docErr;

      // Link to template
      const { error: linkErr } = await supabase
        .from('estimate_template_attachments')
        .insert({
          tenant_id: tenantId,
          template_id: templateId,
          document_id: docRow.id,
          attachment_order: attachments.length,
        });
      if (linkErr) throw linkErr;

      // Parse with AI
      setStage('parsing');
      toast({ title: 'Quote uploaded', description: 'Parsing materials with AI…' });

      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      const resp = await fetch(PARSE_SUPPLIER_QUOTE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ document_url: signed.signedUrl }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(payload?.error || `Parser failed (${resp.status})`);

      const parsed = payload?.parsed;
      const items = parsed?.line_items || [];

      setStage('saving');

      // Persist vendor name on the document
      if (parsed?.vendor_name || parsed?.quote_number) {
        await supabase
          .from('documents')
          .update({
            vendor_name: parsed?.vendor_name || null,
            invoice_number: parsed?.quote_number || null,
          })
          .eq('id', docRow.id);
      }

      // Persist parsed lines
      if (items.length) {
        const rows = items.map((it: any, idx: number) => ({
          tenant_id: tenantId,
          document_id: docRow.id,
          template_id: templateId,
          line_number: idx + 1,
          description: it.description || '(unnamed)',
          sku: it.sku || null,
          qty: it.quantity ?? null,
          unit: it.unit || null,
          unit_cost: it.unit_price ?? null,
          line_total: it.line_total ?? null,
          raw_payload: it,
        }));
        const { error: insErr } = await supabase
          .from('vendor_quote_line_items')
          .insert(rows);
        if (insErr) console.error('[TemplateVendorQuotes] line insert error', insErr);
      }

      toast({
        title: 'Quote attached',
        description: `${items.length} line items parsed${parsed?.vendor_name ? ` from ${parsed.vendor_name}` : ''}. They will auto-apply when this template is used on an estimate.`,
      });
      await load();
    } catch (e: any) {
      console.error('[TemplateVendorQuotes] error', e);
      toast({
        title: 'Upload failed',
        description: e?.message || 'Could not attach vendor quote.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
      setStage('idle');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDelete = async (att: QuoteAttachment) => {
    if (!confirm(`Remove "${att.filename}" from this template?`)) return;
    try {
      // Remove storage object
      await supabase.storage.from('vendor-quotes').remove([att.file_path]);
      // Cascades: line items via FK on delete cascade; link via FK to document
      await supabase.from('estimate_template_attachments')
        .delete()
        .eq('template_id', templateId)
        .eq('document_id', att.document_id);
      await supabase.from('documents').delete().eq('id', att.document_id);
      toast({ title: 'Quote removed' });
      await load();
    } catch (e: any) {
      toast({ title: 'Remove failed', description: e?.message, variant: 'destructive' });
    }
  };

  const label =
    stage === 'uploading' ? 'Uploading…' :
    stage === 'parsing' ? 'Parsing…' :
    stage === 'saving' ? 'Saving…' :
    'Attach Vendor Quote';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">Vendor Quotes</h4>
          <p className="text-xs text-muted-foreground">
            Upload a supplier PDF (any vendor). Costs auto-apply to estimates created from this template.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="gap-2"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {label}
        </Button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : attachments.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">No vendor quotes attached.</div>
      ) : (
        <ul className="space-y-2">
          {attachments.map((a) => (
            <li
              key={a.document_id}
              className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{a.filename}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {a.vendor_name ? `${a.vendor_name} · ` : ''}
                    {a.line_item_count} parsed item{a.line_item_count === 1 ? '' : 's'}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(a)}
                aria-label="Remove quote"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default TemplateVendorQuotes;
