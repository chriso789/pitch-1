import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, Loader2, RotateCw, ScanText } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { OcrStatusBadge, type OcrStatus } from './OcrStatusBadge';

interface OcrDetailsPanelProps {
  documentId: string;
  status: OcrStatus;
  text?: string | null;
  error?: string | null;
  completedAt?: string | null;
  metadata?: Record<string, any> | null;
  workerConfigured?: boolean;
  onChanged?: () => void;
}

export const OcrDetailsPanel: React.FC<OcrDetailsPanelProps> = ({
  documentId,
  status,
  text,
  error,
  completedAt,
  metadata,
  workerConfigured,
  onChanged,
}) => {
  const [busy, setBusy] = useState(false);
  const ocrMeta = (metadata?.ocr ?? {}) as Record<string, any>;
  const pagesAttempted = Number(ocrMeta.pages_attempted ?? ocrMeta.page_count_attempted ?? 0);
  const pagesCompleted = Number(ocrMeta.pages_completed ?? 0);
  const partial = !!ocrMeta.partial || status === 'partial';
  const pageErrors: Array<{ page: number; message: string }> = Array.isArray(ocrMeta.page_errors)
    ? ocrMeta.page_errors
    : [];

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied', description: 'Extracted text copied to clipboard.' });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };

  const handleRetry = async (useWorker = false) => {
    setBusy(true);
    try {
      const fn = useWorker ? 'ocr-scanned-document-worker' : 'ocr-scanned-document';
      const { error: err } = await supabase.functions.invoke(fn, {
        body: { document_id: documentId },
      });
      if (err) throw err;
      toast({ title: 'OCR restarted' });
      onChanged?.();
    } catch (e: any) {
      toast({
        title: 'Retry failed',
        description: e?.message ?? 'Could not restart OCR.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ScanText className="h-4 w-4" /> OCR
        </CardTitle>
        <OcrStatusBadge
          documentId={documentId}
          status={status}
          error={error}
          partial={partial}
          workerConfigured={workerConfigured}
          onRetried={onChanged}
        />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">Completed</div>
            <div>{completedAt ? format(new Date(completedAt), 'PP p') : '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Pages</div>
            <div>
              {pagesCompleted}/{pagesAttempted || '—'}
              {partial && <span className="ml-1 text-amber-600">(partial)</span>}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Mode</div>
            <div className="capitalize">{String(ocrMeta.mode ?? '—').replace(/_/g, ' ')}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Retries</div>
            <div>{Number(ocrMeta.retry_count ?? 0)}</div>
          </div>
        </div>

        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {pageErrors.length > 0 && (
          <details className="rounded border bg-muted/30 p-2 text-xs">
            <summary className="cursor-pointer font-medium">
              {pageErrors.length} page error{pageErrors.length === 1 ? '' : 's'}
            </summary>
            <ul className="mt-2 space-y-1">
              {pageErrors.map((pe, i) => (
                <li key={i}>
                  <span className="font-mono">p.{pe.page}</span>: {pe.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        {text && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Extracted text ({text.length.toLocaleString()} chars)
              </div>
              <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={handleCopy}>
                <Copy className="h-3 w-3" /> Copy
              </Button>
            </div>
            <pre className="max-h-64 overflow-auto rounded border bg-muted/30 p-2 text-xs whitespace-pre-wrap">
              {text.slice(0, 5000)}
              {text.length > 5000 && '\n…'}
            </pre>
          </div>
        )}

        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => handleRetry(false)} disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
            <span className="ml-1">Retry OCR</span>
          </Button>
          {workerConfigured && (
            <Button size="sm" variant="outline" onClick={() => handleRetry(true)} disabled={busy}>
              Send to worker
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
