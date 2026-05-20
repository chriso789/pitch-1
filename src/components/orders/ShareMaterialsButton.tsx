import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Share2, Loader2, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ShareMaterialItem {
  item_name: string;
  qty?: number;
  quantity?: number;
  unit?: string;
  unit_cost?: number;
  srs_item_code?: string | null;
  notes?: string | null;
}

interface Props {
  items: ShareMaterialItem[];
  totalAmount: number;
  customerName?: string;
  projectAddress?: string;
  jobNumber?: string;
  companyName?: string;
}

function fmt(n: number) {
  return `$${(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function buildHtml(opts: {
  items: ShareMaterialItem[];
  includePricing: boolean;
  note: string;
  total: number;
  customerName?: string;
  projectAddress?: string;
  jobNumber?: string;
  companyName?: string;
}) {
  const { items, includePricing, note, total, customerName, projectAddress, jobNumber, companyName } = opts;

  const rows = items
    .map((it) => {
      const qty = Number(it.qty ?? it.quantity ?? 0);
      const unitCost = Number(it.unit_cost || 0);
      const line = qty * unitCost;
      return `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${it.item_name || ''}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;">${it.srs_item_code || '—'}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${qty}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${it.unit || 'EA'}</td>
          ${includePricing ? `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${fmt(unitCost)}</td>` : ''}
          ${includePricing ? `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${fmt(line)}</td>` : ''}
        </tr>`;
    })
    .join('');

  return `
  <div style="font-family:Inter,Arial,sans-serif;color:#111;max-width:720px;">
    <h2 style="margin:0 0 4px 0;">Material List</h2>
    <p style="margin:0 0 16px 0;color:#555;font-size:13px;">
      ${customerName ? `<strong>${customerName}</strong><br/>` : ''}
      ${projectAddress ? `${projectAddress}<br/>` : ''}
      ${jobNumber ? `Job #: ${jobNumber}<br/>` : ''}
    </p>
    ${note ? `<p style="white-space:pre-wrap;background:#f7f7f7;border-left:3px solid #2563eb;padding:10px 12px;margin:0 0 16px 0;">${note.replace(/</g, '&lt;')}</p>` : ''}
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead>
        <tr style="background:#f3f4f6;text-align:left;">
          <th style="padding:8px;">Item</th>
          <th style="padding:8px;">SKU</th>
          <th style="padding:8px;text-align:right;">Qty</th>
          <th style="padding:8px;">UoM</th>
          ${includePricing ? `<th style="padding:8px;text-align:right;">Unit $</th>` : ''}
          ${includePricing ? `<th style="padding:8px;text-align:right;">Line $</th>` : ''}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      ${includePricing ? `
      <tfoot>
        <tr>
          <td colspan="5" style="padding:10px 8px;text-align:right;font-weight:600;">Total</td>
          <td style="padding:10px 8px;text-align:right;font-weight:700;">${fmt(total)}</td>
        </tr>
      </tfoot>` : ''}
    </table>
    <p style="margin-top:24px;color:#666;font-size:12px;">
      Sent${companyName ? ` from ${companyName}` : ''} via Pitch CRM.
    </p>
  </div>`;
}

export function ShareMaterialsButton(props: Props) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(
    `Material list${props.jobNumber ? ` — Job #${props.jobNumber}` : props.customerName ? ` — ${props.customerName}` : ''}`,
  );
  const [note, setNote] = useState('');
  const [includePricing, setIncludePricing] = useState(false);
  const [sending, setSending] = useState(false);

  const html = useMemo(
    () =>
      buildHtml({
        items: props.items,
        includePricing,
        note,
        total: props.totalAmount,
        customerName: props.customerName,
        projectAddress: props.projectAddress,
        jobNumber: props.jobNumber,
        companyName: props.companyName,
      }),
    [props.items, props.totalAmount, props.customerName, props.projectAddress, props.jobNumber, props.companyName, includePricing, note],
  );

  const send = async () => {
    const recipients = to
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => /\S+@\S+\.\S+/.test(s));
    if (recipients.length === 0) {
      toast.error('Enter at least one valid email address');
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('email-send', {
        body: {
          to: recipients,
          subject,
          html,
          from_name: props.companyName || 'Pitch CRM',
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Material list sent to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`);
      setOpen(false);
      setTo('');
      setNote('');
    } catch (e: any) {
      console.error('share materials error', e);
      toast.error(e?.message || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={props.items.length === 0}>
          <Share2 className="h-4 w-4 mr-2" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share Material List</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Compose */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="share-to">To (supplier or crew emails)</Label>
              <Input
                id="share-to"
                placeholder="supplier@example.com, foreman@crew.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Separate multiple emails with commas.</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="share-subject">Subject</Label>
              <Input id="share-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="share-note">Message (optional)</Label>
              <Textarea
                id="share-note"
                rows={4}
                placeholder="Hey — please prep this material for pickup Friday. Thanks!"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Include unit pricing</p>
                <p className="text-xs text-muted-foreground">
                  Turn off to hide unit cost, line totals, and grand total.
                </p>
              </div>
              <Switch checked={includePricing} onCheckedChange={setIncludePricing} />
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <Label>Email Preview</Label>
            <div
              className="rounded-md border bg-white p-4 max-h-[480px] overflow-auto"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={sending || props.items.length === 0}>
            {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Send Email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
