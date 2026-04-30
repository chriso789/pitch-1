import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { LineItem } from '@/hooks/useEstimatePricing';

interface SupplierQuoteUploaderProps {
  tradeSectionId: string;
  tradeType: string;
  tradeLabel: string;
  currentItems: LineItem[];
  onItemsUpdated: (items: LineItem[], summary: {
    matched: number;
    appended: number;
    vendorName?: string | null;
  }) => void;
  projectId?: string | null;
  pipelineEntryId?: string | null;
  disabled?: boolean;
}

interface ParsedQuoteItem {
  description: string;
  sku?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  line_total?: number;
}

// Normalize a string for comparison: lowercase, strip non-alphanum, collapse spaces
function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tokenize and score similarity 0..1 using token overlap (Jaccard) with a length tiebreaker
function similarity(a: string, b: string): number {
  const ta = new Set(normalize(a).split(' ').filter(Boolean));
  const tb = new Set(normalize(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter += 1;
  });
  const union = ta.size + tb.size - inter;
  return inter / union;
}

function findBestMatch(
  parsed: ParsedQuoteItem,
  candidates: LineItem[],
): { item: LineItem; score: number } | null {
  // Only match against material rows
  const materials = candidates.filter((c) => c.item_type === 'material');
  if (materials.length === 0) return null;

  let best: { item: LineItem; score: number } | null = null;
  for (const c of materials) {
    const nameScore = similarity(parsed.description, c.item_name || '');
    const descScore = c.description
      ? similarity(parsed.description, c.description)
      : 0;
    const score = Math.max(nameScore, descScore);
    if (!best || score > best.score) best = { item: c, score };
  }
  return best;
}

export const SupplierQuoteUploader: React.FC<SupplierQuoteUploaderProps> = ({
  tradeSectionId,
  tradeType,
  tradeLabel,
  currentItems,
  onItemsUpdated,
  projectId,
  pipelineEntryId,
  disabled,
}) => {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'parsing' | 'merging'>('idle');

  const handleClick = () => {
    if (disabled || busy) return;
    inputRef.current?.click();
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setStage('uploading');
    try {
      // Resolve tenant for storage path
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) throw new Error('You must be signed in.');

      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', userId)
        .maybeSingle();

      if (profileErr || !profile?.tenant_id) {
        throw new Error('Could not resolve your tenant — please re-login.');
      }

      const folderId = projectId || pipelineEntryId || 'estimates';
      const ext = file.name.split('.').pop() || 'pdf';
      const fileName = `${profile.tenant_id}/${folderId}/supplier-quote-${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('project-invoices')
        .upload(fileName, file, { upsert: false });
      if (uploadErr) throw uploadErr;

      const { data: signed, error: signErr } = await supabase.storage
        .from('project-invoices')
        .createSignedUrl(fileName, 60 * 10);
      if (signErr || !signed?.signedUrl) throw new Error('Could not create signed URL for parsing.');

      setStage('parsing');
      toast({ title: 'Quote uploaded', description: 'Parsing materials with AI…' });

      const { data, error } = await supabase.functions.invoke('parse-supplier-quote', {
        body: { document_url: signed.signedUrl },
      });
      if (error) throw error;
      const parsed = data?.parsed;
      const items: ParsedQuoteItem[] = parsed?.line_items || [];
      if (!items.length) {
        toast({
          title: 'No materials found',
          description: 'AI could not extract any line items from this quote.',
          variant: 'destructive',
        });
        return;
      }

      setStage('merging');

      // Match each parsed item against current materials. Threshold: 0.4 token overlap.
      const updatedById = new Map<string, LineItem>();
      const appended: LineItem[] = [];
      let matched = 0;

      for (const p of items) {
        const qty = Number(p.quantity ?? 0) || 0;
        const unitCost = Number(p.unit_price ?? 0) || 0;
        const lineTotal =
          Number(p.line_total ?? 0) || +(qty * unitCost).toFixed(2);

        const best = findBestMatch(p, currentItems);
        if (best && best.score >= 0.4) {
          const existing = updatedById.get(best.item.id) || best.item;
          updatedById.set(existing.id, {
            ...existing,
            qty: qty || existing.qty,
            unit_cost: unitCost || existing.unit_cost,
            line_total:
              qty && unitCost
                ? +(qty * unitCost).toFixed(2)
                : lineTotal || existing.line_total,
            is_override: true,
          });
          matched += 1;
        } else {
          // Append as new material row
          const newId =
            (globalThis.crypto && 'randomUUID' in globalThis.crypto)
              ? (globalThis.crypto as any).randomUUID()
              : `sq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          appended.push({
            id: newId,
            item_name: p.description,
            description: p.sku ? `SKU: ${p.sku}` : undefined,
            item_type: 'material',
            qty,
            unit: p.unit || 'ea',
            unit_cost: unitCost,
            line_total: lineTotal,
            is_override: true,
            trade_type: tradeType,
            trade_label: tradeLabel,
            sort_order:
              (currentItems.reduce((m, x) => Math.max(m, x.sort_order || 0), 0) || 0) +
              appended.length +
              1,
          });
        }
      }

      // Build merged list preserving order, applying updates, then appended at end
      const merged: LineItem[] = currentItems.map((it) =>
        updatedById.has(it.id) ? updatedById.get(it.id)! : it,
      );
      merged.push(...appended);

      onItemsUpdated(merged, {
        matched,
        appended: appended.length,
        vendorName: parsed?.vendor_name,
      });

      toast({
        title: 'Supplier quote applied',
        description: `${matched} matched · ${appended.length} added${
          parsed?.vendor_name ? ` · ${parsed.vendor_name}` : ''
        }`,
      });
    } catch (e: any) {
      console.error('[SupplierQuoteUploader] error', e);
      toast({
        title: 'Upload failed',
        description: e?.message || 'Could not process supplier quote.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
      setStage('idle');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const label =
    stage === 'uploading'
      ? 'Uploading…'
      : stage === 'parsing'
        ? 'Parsing quote…'
        : stage === 'merging'
          ? 'Applying…'
          : 'Upload Supplier Quote';

  return (
    <>
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
        onClick={handleClick}
        disabled={disabled || busy}
        className="gap-2"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        <FileText className="h-4 w-4 -ml-1 opacity-70" />
        {label}
      </Button>
    </>
  );
};

export default SupplierQuoteUploader;
