import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const BUCKET = 'project-invoices';

function extractInvoicePath(value: string): string | null {
  if (!value) return null;
  const pub = value.match(/\/storage\/v1\/object\/public\/project-invoices\/(.+?)(?:\?|$)/);
  if (pub) return decodeURIComponent(pub[1]);
  const sig = value.match(/\/storage\/v1\/object\/sign\/project-invoices\/(.+?)\?/);
  if (sig) return decodeURIComponent(sig[1]);
  if (!/^https?:\/\//i.test(value) && !value.startsWith('/')) return value;
  return null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  urlOrPath: string | null | undefined;
  title?: string;
}

export function InvoicePreviewDialog({ open, onOpenChange, urlOrPath, title }: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !urlOrPath) {
      setSignedUrl(null);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const path = extractInvoicePath(urlOrPath);

      if (!path) {
        if (!cancelled) {
          setSignedUrl(urlOrPath);
          setLoading(false);
        }
        return;
      }

      const { data, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 60 * 10);

      if (cancelled) return;
      if (signErr || !data?.signedUrl) {
        setError(signErr?.message || 'Could not load preview');
      } else {
        setSignedUrl(data.signedUrl);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, urlOrPath]);

  const isPdf = signedUrl?.toLowerCase().includes('.pdf');
  const isImage = signedUrl && /\.(png|jpe?g|gif|webp|heic)/i.test(signedUrl);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b flex-row items-center justify-between space-y-0">
          <DialogTitle className="truncate pr-4">{title || 'Invoice Preview'}</DialogTitle>
          <div className="flex items-center gap-2">
            {signedUrl && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(signedUrl, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  Open
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={signedUrl} download>
                    <Download className="h-3.5 w-3.5 mr-1" />
                    Download
                  </a>
                </Button>
              </>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 bg-muted/30">
          {loading && (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading preview…
            </div>
          )}
          {!loading && error && (
            <div className="h-full flex items-center justify-center text-sm text-destructive p-4">
              {error}
            </div>
          )}
          {!loading && !error && signedUrl && (
            isImage ? (
              <div className="h-full w-full overflow-auto flex items-center justify-center p-4">
                <img src={signedUrl} alt={title || 'Invoice'} className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <iframe
                src={signedUrl}
                title={title || 'Invoice'}
                className="w-full h-full border-0"
              />
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
