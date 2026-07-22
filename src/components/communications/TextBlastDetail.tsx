import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, Ban, CheckCircle, XCircle, ShieldOff, Send, Clock, Sparkles } from 'lucide-react';
import { useState } from 'react';

interface TextBlastDetailProps {
  blastId: string;
  onBack: () => void;
}

export const TextBlastDetail = ({ blastId, onBack }: TextBlastDetailProps) => {
  const { toast } = useToast();

  const { data: blast, refetch } = useQuery({
    queryKey: ['sms-blast-detail', blastId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sms_blasts')
        .select('*')
        .eq('id', blastId)
        .single();
      if (error) throw error;
      return data;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'sending' ? 3000 : false;
    },
  });

  const { data: items, refetch: refetchItems } = useQuery({
    queryKey: ['sms-blast-items', blastId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sms_blast_items')
        .select('*')
        .eq('blast_id', blastId)
        .order('status');
      if (error) throw error;
      return data || [];
    },
    refetchInterval: () => {
      // Poll items so replies / STOPs landing via the inbound webhook show up live.
      return blast?.status === 'sending' ? 3000 : 8000;
    },
  });

  const handleCancel = async () => {
    const { error } = await supabase
      .from('sms_blasts')
      .update({ status: 'cancelled' })
      .eq('id', blastId);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Blast Cancelled', description: 'Remaining messages will not be sent.' });
      refetch();
      refetchItems();
    }
  };

  const handleAddOptOut = async (phone: string, itemId: string) => {
    if (!blast?.tenant_id) return;
    await supabase.from('opt_outs').insert({
      phone: phone,
      tenant_id: blast.tenant_id,
      channel: 'sms',
      reason: 'manual_blast_opt_out',
      source: 'text_blast',
    });
    await supabase
      .from('sms_blast_items')
      .update({ status: 'opted_out' })
      .eq('id', itemId);
    toast({ title: 'Opted Out', description: `${phone} added to opt-out list.` });
    refetchItems();
  };

  const [generating, setGenerating] = useState(false);
  const handleGeneratePersonalized = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-campaign-messages', {
        body: { blast_id: blastId },
      });
      if (error) throw error;
      toast({
        title: 'Personalized messages generated',
        description: `${data?.updated || 0} of ${data?.total || 0} items personalized with smart tags.`,
      });
      refetchItems();
    } catch (e: any) {
      toast({ title: 'Generation failed', description: e.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const [launching, setLaunching] = useState(false);
  const handleSendNow = async () => {
    setLaunching(true);
    try {
      const { error } = await supabase
        .from('sms_blasts')
        .update({
          status: 'sending',
          send_window_start: '00:00:00',
          send_window_end: '23:59:00',
          started_at: new Date().toISOString(),
        })
        .eq('id', blastId);
      if (error) throw error;
      toast({ title: 'Blast launched', description: 'Sending now — the processor will pick it up within ~60s.' });
      // Kick the processor immediately so we don't wait for cron
      supabase.functions.invoke('messaging-api', { body: { __route: '/sms/blast/start' }, headers: { 'x-route': '/sms/blast/start' } }).catch(() => {});
      refetch();
      refetchItems();
    } catch (e: any) {
      toast({ title: 'Launch failed', description: e.message, variant: 'destructive' });
    } finally {
      setLaunching(false);
    }
  };

  if (!blast) return null;

  // Derive live counts from items so the dashboard reflects replies/opt-outs
  // the instant the inbound webhook updates them — independent of how often
  // the processor reconciles the parent blast row.
  const allItems = items || [];
  const counts = {
    total: blast.total_recipients || allItems.length,
    sent: allItems.filter((i: any) => ['sent', 'delivered', 'replied'].includes(i.status)).length,
    delivered: allItems.filter((i: any) => ['delivered', 'replied'].includes(i.status)).length,
    replied: allItems.filter((i: any) => i.status === 'replied').length,
    // Failed excludes quarantined so unsupported-destination rows never
    // masquerade as delivery failures.
    failed: allItems.filter((i: any) => ['failed', 'cancelled', 'skipped_cooldown', 'skipped_duplicate', 'skipped_missing_address', 'skipped_opt_out'].includes(i.status)).length,
    opted: allItems.filter((i: any) => i.status === 'opted_out').length,
    quarantined: allItems.filter((i: any) => i.status === 'quarantined').length,
  };
  const nonResponders = allItems.filter((i: any) =>
    ['sent', 'delivered', 'failed'].includes(i.status)
  );
  const progress = counts.total > 0
    ? Math.round(((counts.sent + counts.failed + counts.opted) / counts.total) * 100)
    : 0;
  const skippedCount = allItems.filter((item: any) => ['skipped_cooldown', 'skipped_duplicate'].includes(item.status)).length;
  const noTextsSent = blast.status === 'completed' && counts.sent === 0 && skippedCount > 0;

  const handleResendToNonResponders = async () => {
    if (!nonResponders.length) {
      toast({ title: 'Nothing to resend', description: 'Every recipient in this blast already replied or opted out.' });
      return;
    }
    try {
      const { data: child, error: blastErr } = await supabase
        .from('sms_blasts')
        .insert({
          tenant_id: blast.tenant_id,
          from_location_id: (blast as any).from_location_id,
          name: `${blast.name} — Round ${((blast as any).parent_blast_id ? '' : '2')}`.trim(),
          script: blast.script,
          total_recipients: nonResponders.length,
          max_attempts_per_contact: (blast as any).max_attempts_per_contact ?? 1,
          status: 'draft',
          is_test_mode: blast.is_test_mode,
          template_pool_ids: (blast as any).template_pool_ids ?? null,
          ai_followup_enabled: (blast as any).ai_followup_enabled ?? false,
          goal: (blast as any).goal ?? null,
          parent_blast_id: (blast as any).parent_blast_id || blast.id,
        })
        .select()
        .single();
      if (blastErr) throw blastErr;
      const childItems = nonResponders.map((i: any) => ({
        blast_id: child.id,
        tenant_id: blast.tenant_id,
        contact_id: i.contact_id,
        phone: i.phone,
        contact_name: i.contact_name,
        status: 'pending',
      }));
      const { error: itemsErr } = await supabase.from('sms_blast_items').insert(childItems);
      if (itemsErr) throw itemsErr;
      toast({
        title: 'Resend draft created',
        description: `${nonResponders.length} non-responders queued in a new round under this blast.`,
      });
    } catch (e: any) {
      toast({ title: 'Resend failed', description: e.message, variant: 'destructive' });
    }
  };

  const statusIcons: Record<string, any> = {
    pending: Clock,
    sent: CheckCircle,
    failed: XCircle,
    opted_out: ShieldOff,
    cancelled: Ban,
    skipped_cooldown: Clock,
    skipped_duplicate: Ban,
  };

  const statusColors: Record<string, string> = {
    pending: 'text-muted-foreground',
    sent: 'text-green-600',
    failed: 'text-destructive',
    opted_out: 'text-amber-500',
    cancelled: 'text-muted-foreground',
    skipped_cooldown: 'text-amber-500',
    skipped_duplicate: 'text-muted-foreground',
  };

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <h2 className="text-lg font-semibold">{blast.name}</h2>
          <Badge variant={blast.status === 'sending' ? 'default' : 'secondary'}>
            {noTextsSent ? 'no texts sent' : blast.status}
          </Badge>
          {blast.is_test_mode && <Badge variant="outline">test mode</Badge>}
          {(blast as any).parent_blast_id && <Badge variant="outline">resend round</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {(blast.status === 'draft' || blast.status === 'paused') && (
            <>
              <Button variant="outline" size="sm" onClick={handleGeneratePersonalized} disabled={generating}>
                <Sparkles className="h-4 w-4 mr-2" />
                {generating ? 'Generating…' : 'Generate Personalized Messages'}
              </Button>
              <Button size="sm" onClick={handleSendNow} disabled={launching || !blast.total_recipients}>
                <Send className="h-4 w-4 mr-2" />
                {launching ? 'Launching…' : 'Send Now'}
              </Button>
            </>
          )}
          {blast.status === 'sending' && (
            <Button variant="destructive" size="sm" onClick={handleCancel}>
              <Ban className="h-4 w-4 mr-2" />
              Cancel Blast
            </Button>
          )}
          {['completed', 'cancelled', 'failed'].includes(blast.status) && nonResponders.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleResendToNonResponders}>
              <Send className="h-4 w-4 mr-2" />
              Resend to {nonResponders.length} Non-Responders
            </Button>
          )}
        </div>
      </div>

      {noTextsSent && (
        <Card className="border-amber-500/40 bg-amber-500/10 shrink-0">
          <CardContent className="py-3 text-sm text-amber-700">
            No message was sent for this blast. The recipient was blocked by a safety guard, such as the 24-hour cooldown.
          </CardContent>
        </Card>
      )}



      {/* Stats — live-derived from items so replies/STOPs landing via the
          inbound webhook show up immediately, not only after the next
          processor run. */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 shrink-0">
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">{counts.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-green-600">{counts.sent}</p>
            <p className="text-xs text-muted-foreground">Sent</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-blue-600">{counts.delivered}</p>
            <p className="text-xs text-muted-foreground">Delivered</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-violet-600">{counts.replied}</p>
            <p className="text-xs text-muted-foreground">Replied</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-destructive">{counts.failed}</p>
            <p className="text-xs text-muted-foreground">Failed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-amber-500">{counts.opted}</p>
            <p className="text-xs text-muted-foreground">Opted Out</p>
          </CardContent>
        </Card>
      </div>

      {/* Verification Agents */}
      <Card className="shrink-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            Verification Agents
          </CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-md border border-border bg-muted/30">
            <p className="font-medium mb-1">Delivery Verifier</p>
            <p className="text-muted-foreground">
              {counts.sent} sent · {counts.delivered} confirmed delivered · {counts.replied} replied · {counts.opted} opted out (STOP).
              {(blast as any).max_attempts_per_contact && (
                <> Capped at {(blast as any).max_attempts_per_contact} attempt{(blast as any).max_attempts_per_contact !== 1 ? 's' : ''} per contact (24h apart, stops on reply / NO / STOP).</>
              )}
            </p>
          </div>
          <div className="p-3 rounded-md border border-border bg-muted/30">
            <p className="font-medium mb-1">Routing Verifier</p>
            <p className="text-muted-foreground">
              {(items || []).filter((i: any) => i.routing_verified).length} of {items?.length || 0} numbers verified to correct contact.
              Inbound replies are auto-attached to each contact's timeline.
            </p>
          </div>
        </CardContent>
      </Card>


      {blast.status === 'sending' && (
        <div className="shrink-0">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground mt-1">{progress}% complete</p>
        </div>
      )}

      {/* Script preview */}
      <Card className="shrink-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Script</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{blast.script}</p>
        </CardContent>
      </Card>

      {/* Recipient list */}
      <Card className="flex-1 min-h-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recipients ({items?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto max-h-[400px]">
          <div className="space-y-1">
            {items?.map((item: any) => {
              const Icon = statusIcons[item.status] || Clock;
              const color = statusColors[item.status] || '';
              return (
                <div key={item.id} className="flex items-center justify-between py-2 px-2 rounded hover:bg-muted/50 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                    <span className="truncate">{item.contact_name || item.phone}</span>
                    <span className="text-muted-foreground text-xs">{item.phone}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-xs">{item.status}</Badge>
                    {item.delivered_at && <Badge variant="outline" className="text-xs border-blue-500/40 text-blue-600">delivered</Badge>}
                    {item.replied_at && <Badge variant="outline" className="text-xs border-violet-500/40 text-violet-600">replied</Badge>}
                    {item.routing_verified && <Badge variant="outline" className="text-xs border-green-500/40 text-green-600">routed</Badge>}
                    {item.status === 'sent' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={(e) => { e.stopPropagation(); handleAddOptOut(item.phone, item.id); }}
                      >
                        Opt Out
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
