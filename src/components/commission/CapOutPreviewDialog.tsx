import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Printer, Share2, Mail, Copy, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  buildCapOutDataForJob,
  buildCapOutDataFromCommission,
  buildCapOutHtml,
  generateCapOutPdf,
  generateCapOutPdfBlob,
  type CapOutPdfData,
  type CapOutFinancials,
} from './CapOutPdfExport';

interface CapOutPreviewDialogProps {
  pipelineEntryId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  financials?: CapOutFinancials | null;
}

export function CapOutPreviewDialog({ pipelineEntryId, open, onOpenChange, financials }: CapOutPreviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState<string>('');
  const [data, setData] = useState<CapOutPdfData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTo, setShareTo] = useState('');
  const [shareSubject, setShareSubject] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !pipelineEntryId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setShareOpen(false);
    const loader = financials
      ? buildCapOutDataFromCommission(pipelineEntryId, financials)
      : buildCapOutDataForJob(pipelineEntryId);
    loader
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setHtml(buildCapOutHtml(d));
        setShareTo(d.repEmail || '');
        setShareSubject(`Cap Out Sheet - ${d.projectName || d.customerName || 'Job'}`);
        setShareMessage(
          `Hi${d.repName && d.repName !== 'N/A' ? ` ${d.repName.split(' ')[0]}` : ''},\n\nPlease find the Cap Out Sheet for ${d.projectName || d.customerName || 'this job'} below.\n\nThank you.`
        );
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
  }, [open, pipelineEntryId, financials]);

  const handleSendEmail = async () => {
    if (!shareTo.trim()) {
      toast.error('Please enter a recipient email');
      return;
    }
    if (!data) return;
    setSending(true);
    try {
      // Generate the PDF attachment
      const pdfBlob = await generateCapOutPdfBlob(data);
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
      }
      const base64Pdf = btoa(binary);

      const safeName = (data.projectName || data.customerName || 'cap-out-sheet')
        .replace(/[^a-z0-9-_ ]/gi, '')
        .trim()
        .replace(/\s+/g, '-');
      const filename = `Cap-Out-${safeName || 'Sheet'}.pdf`;

      const bodyText = `${shareMessage}\n\nThe Cap Out Sheet is attached as a PDF.`;

      const { error: fnError } = await supabase.functions.invoke('email-api', {
        body: {
          __route: '/send',
          to: [shareTo],
          cc: ['support@pitch-crm.ai'],
          subject: shareSubject,
          body: bodyText,
          attachments: [{ filename, content: base64Pdf }],
        },
      });
      if (fnError) throw fnError;
      toast.success(`Cap Out Sheet sent to ${shareTo} (copied to support)`);
      setShareOpen(false);
    } catch (err: any) {
      console.error('Cap out share failed:', err);
      toast.error(err?.message || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  const handleCopyHtml = async () => {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      toast.success('Cap out sheet HTML copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle>Cap Out Sheet Preview</DialogTitle>
          <div className="flex items-center gap-2 mr-6">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShareOpen((v) => !v)}
              disabled={!data}
            >
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </Button>
            <Button
              size="sm"
              onClick={() => data && generateCapOutPdf(data)}
              disabled={!data}
            >
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </div>
        </DialogHeader>

        {shareOpen && (
          <div className="border-b bg-muted/40 px-6 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Mail className="h-4 w-4" />
                Share Cap Out Sheet
              </div>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShareOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="share-to" className="text-xs">Recipient Email</Label>
                <Input
                  id="share-to"
                  type="email"
                  placeholder="name@example.com"
                  value={shareTo}
                  onChange={(e) => setShareTo(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="share-subject" className="text-xs">Subject</Label>
                <Input
                  id="share-subject"
                  value={shareSubject}
                  onChange={(e) => setShareSubject(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="share-message" className="text-xs">Message</Label>
              <Textarea
                id="share-message"
                rows={3}
                value={shareMessage}
                onChange={(e) => setShareMessage(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" onClick={handleCopyHtml} disabled={!html}>
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                Copy HTML
              </Button>
              <Button size="sm" onClick={handleSendEmail} disabled={sending || !shareTo}>
                {sending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4 mr-2" />
                )}
                Send Email
              </Button>
            </div>
          </div>
        )}

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
