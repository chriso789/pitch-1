import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Eye, Loader2, Mail, MessageSquare, Share2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  invoiceId: string;
  tenantId: string;
  pipelineEntryId: string;
  invoiceNumber: string;
  defaultEmail?: string | null;
  defaultPhone?: string | null;
  isVoid?: boolean;
}

type Channel = 'email' | 'sms';

export function InvoiceShareActions({
  invoiceId,
  tenantId,
  pipelineEntryId,
  invoiceNumber,
  defaultEmail,
  defaultPhone,
  isVoid,
}: Props) {
  const [viewing, setViewing] = useState(false);
  const [openChannel, setOpenChannel] = useState<Channel | null>(null);
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [includeQbo, setIncludeQbo] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const safeNumber = invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '_');
  const pdfPath = `${tenantId}/${pipelineEntryId}/invoices/${safeNumber}.pdf`;

  const openView = async () => {
    setViewing(true);
    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .createSignedUrl(pdfPath, 60 * 60);
      if (error || !data?.signedUrl) throw error ?? new Error('no_url');
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error('Invoice PDF not available yet. Save the invoice first.');
    } finally {
      setViewing(false);
    }
  };

  const openShare = (channel: Channel) => {
    setOpenChannel(channel);
    setRecipient(channel === 'email' ? (defaultEmail ?? '') : (defaultPhone ?? ''));
    setNote('');
  };

  const submitShare = async () => {
    if (!openChannel) return;
    const target = recipient.trim();
    if (!target) {
      toast.error(openChannel === 'email' ? 'Enter an email' : 'Enter a phone number');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('invoice-share', {
        body: {
          invoice_id: invoiceId,
          channel: openChannel,
          recipient: target,
          message: note || undefined,
          include_qbo_link: includeQbo,
        },
      });
      if (error || !(data as any)?.ok) {
        const reason = (data as any)?.reason || (data as any)?.error || error?.message || 'Send failed';
        throw new Error(reason);
      }
      toast.success(openChannel === 'email' ? 'Invoice emailed' : 'Invoice texted');
      setOpenChannel(null);
    } catch (e: any) {
      toast.error(e?.message ?? 'Send failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={openView}
        disabled={viewing}
        title="View invoice PDF"
      >
        {viewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isVoid}
            title="Share invoice"
          >
            <Share2 className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openShare('email')}>
            <Mail className="h-4 w-4 mr-2" /> Send via Email
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openShare('sms')}>
            <MessageSquare className="h-4 w-4 mr-2" /> Send via Text
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!openChannel} onOpenChange={(v) => !v && setOpenChannel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {openChannel === 'email' ? 'Email invoice' : 'Text invoice'} {invoiceNumber}
            </DialogTitle>
            <DialogDescription>
              Sends a secure link to the invoice PDF{includeQbo ? ' plus the QuickBooks payment link when available' : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{openChannel === 'email' ? 'Recipient email' : 'Recipient phone'}</Label>
              <Input
                type={openChannel === 'email' ? 'email' : 'tel'}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder={openChannel === 'email' ? 'name@example.com' : '+15551234567'}
              />
            </div>
            <div>
              <Label>Short note (optional)</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={openChannel === 'sms' ? 2 : 4}
                maxLength={500}
                placeholder={openChannel === 'sms' ? 'Kept short for text.' : 'Add a personal note.'}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={includeQbo} onCheckedChange={(v) => setIncludeQbo(!!v)} />
              Include QuickBooks payment link if available
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenChannel(null)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submitShare} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
