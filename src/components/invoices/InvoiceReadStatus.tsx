import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCheck, Check, MailX } from 'lucide-react';

interface Props {
  invoiceId: string;
  tenantId: string;
  refreshKey?: number;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Read receipt for emailed invoices: Sent → Delivered → Opened. */
export function InvoiceReadStatus({ invoiceId, tenantId, refreshKey = 0 }: Props) {
  const { data } = useQuery({
    queryKey: ['invoice-read-status', invoiceId, refreshKey],
    queryFn: async () => {
      const [{ data: deliveries }, { data: events }] = await Promise.all([
        supabase
          .from('invoice_email_deliveries')
          .select('id, recipient_email, status, accepted_at, delivered_at, bounced_at, failed_at, created_at')
          .eq('tenant_id', tenantId)
          .eq('pitch_invoice_id', invoiceId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('customer_invoice_events')
          .select('event_type, event_timestamp, metadata')
          .eq('tenant_id', tenantId)
          .eq('pitch_invoice_id', invoiceId)
          .in('event_type', ['invoice_viewed', 'payment_link_clicked'])
          .order('event_timestamp', { ascending: false })
          .limit(50),
      ]);
      return { deliveries: deliveries ?? [], events: events ?? [] };
    },
    enabled: !!invoiceId && !!tenantId,
    refetchInterval: 60_000,
  });

  if (!data || data.deliveries.length === 0) return null;
  const latest = data.deliveries[0] as any;
  const lastOpen = data.events[0] as any;
  const failed = ['bounced', 'failed', 'complained'].includes(latest.status);

  let label = 'Sent';
  let Icon = Check;
  let variant: 'secondary' | 'default' | 'destructive' = 'secondary';
  if (lastOpen) { label = 'Opened'; Icon = CheckCheck; variant = 'default'; }
  else if (failed) { label = latest.status === 'bounced' ? 'Bounced' : 'Failed'; Icon = MailX; variant = 'destructive'; }
  else if (latest.delivered_at) { label = 'Delivered'; Icon = CheckCheck; }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={variant} className="h-5 gap-1 px-1.5 text-[10px] font-medium cursor-default">
            <Icon className="h-3 w-3" /> {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs space-y-1">
          {data.deliveries.slice(0, 5).map((d: any) => (
            <div key={d.id}>Emailed to {d.recipient_email} · {fmt(d.created_at)}{d.delivered_at ? ' · delivered' : ''}</div>
          ))}
          {lastOpen ? (
            <div className="font-medium">
              Last opened {fmt(lastOpen.event_timestamp)}
              {lastOpen.metadata?.recipient ? ` by ${lastOpen.metadata.recipient}` : ''} · {data.events.length} view(s)
            </div>
          ) : (
            <div>Not opened yet</div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
