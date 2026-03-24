import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, Ban, CheckCircle, XCircle, ShieldOff, Send, Clock } from 'lucide-react';

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
    refetchInterval: (query) => {
      return blast?.status === 'sending' ? 3000 : false;
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
      phone_number: phone,
      tenant_id: blast.tenant_id,
      reason: 'manual_blast_opt_out',
    });
    await supabase
      .from('sms_blast_items')
      .update({ status: 'opted_out' })
      .eq('id', itemId);
    toast({ title: 'Opted Out', description: `${phone} added to opt-out list.` });
    refetchItems();
  };

  if (!blast) return null;

  const progress = blast.total_recipients > 0
    ? Math.round(((blast.sent_count + blast.failed_count + blast.opted_out_count) / blast.total_recipients) * 100)
    : 0;

  const statusIcons: Record<string, any> = {
    pending: Clock,
    sent: CheckCircle,
    failed: XCircle,
    opted_out: ShieldOff,
    cancelled: Ban,
  };

  const statusColors: Record<string, string> = {
    pending: 'text-muted-foreground',
    sent: 'text-green-600',
    failed: 'text-destructive',
    opted_out: 'text-amber-500',
    cancelled: 'text-muted-foreground',
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
            {blast.status}
          </Badge>
        </div>
        {blast.status === 'sending' && (
          <Button variant="destructive" size="sm" onClick={handleCancel}>
            <Ban className="h-4 w-4 mr-2" />
            Cancel Blast
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-green-600">{blast.sent_count}</p>
            <p className="text-xs text-muted-foreground">Sent</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-destructive">{blast.failed_count}</p>
            <p className="text-xs text-muted-foreground">Failed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-amber-500">{blast.opted_out_count}</p>
            <p className="text-xs text-muted-foreground">Opted Out</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">{blast.total_recipients}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
      </div>

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
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-xs">{item.status}</Badge>
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
