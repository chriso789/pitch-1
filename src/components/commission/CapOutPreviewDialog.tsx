import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Printer } from 'lucide-react';
import {
  buildCapOutDataForJob,
  buildCapOutDataFromCommission,
  buildCapOutHtml,
  generateCapOutPdf,
  type CapOutPdfData,
  type CapOutFinancials,
} from './CapOutPdfExport';

interface CapOutPreviewDialogProps {
  pipelineEntryId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  financials?: CapOutFinancials | null;
}

export function CapOutPreviewDialog({ pipelineEntryId, open, onOpenChange }: CapOutPreviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState<string>('');
  const [data, setData] = useState<CapOutPdfData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !pipelineEntryId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    buildCapOutDataForJob(pipelineEntryId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setHtml(buildCapOutHtml(d));
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load cap out sheet');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, pipelineEntryId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle>Cap Out Sheet Preview</DialogTitle>
          <Button
            size="sm"
            onClick={() => data && generateCapOutPdf(data)}
            disabled={!data}
            className="mr-6"
          >
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </DialogHeader>
        <div className="flex-1 bg-muted/30 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full text-sm text-destructive p-6 text-center">
              {error}
            </div>
          )}
          {!loading && !error && html && (
            <iframe
              title="Cap Out Sheet Preview"
              srcDoc={html}
              className="w-full h-full border-0 bg-white"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
