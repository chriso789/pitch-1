import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Megaphone, Send, CheckCircle, XCircle, Ban } from 'lucide-react';
import { format } from 'date-fns';
import { TextBlastCreator } from './TextBlastCreator';
import { TextBlastDetail } from './TextBlastDetail';

export const TextBlastManager = () => {
  const { activeTenantId } = useActiveTenantId();
  const [view, setView] = useState<'list' | 'create' | 'detail'>('list');
  const [selectedBlastId, setSelectedBlastId] = useState<string | null>(null);

  const { data: blasts, isLoading, refetch } = useQuery({
    queryKey: ['sms-blasts', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      const { data, error } = await supabase
        .from('sms_blasts')
        .select('*')
        .eq('tenant_id', activeTenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: any }> = {
    draft: { label: 'Draft', variant: 'secondary', icon: Megaphone },
    sending: { label: 'Sending...', variant: 'default', icon: Send },
    completed: { label: 'Completed', variant: 'outline', icon: CheckCircle },
    cancelled: { label: 'Cancelled', variant: 'destructive', icon: Ban },
  };

  if (view === 'create') {
    return (
      <TextBlastCreator
        onBack={() => { setView('list'); refetch(); }}
        onCreated={(id) => { setSelectedBlastId(id); setView('detail'); refetch(); }}
      />
    );
  }

  if (view === 'detail' && selectedBlastId) {
    return (
      <TextBlastDetail
        blastId={selectedBlastId}
        onBack={() => { setView('list'); refetch(); }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-semibold">Text Blasts</h2>
          <p className="text-sm text-muted-foreground">Send bulk SMS campaigns to your contact lists</p>
        </div>
        <Button onClick={() => setView('create')}>
          <Plus className="h-4 w-4 mr-2" />
          New Text Blast
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>
      ) : !blasts?.length ? (
        <Card className="flex-1 flex items-center justify-center">
          <CardContent className="text-center py-12">
            <Megaphone className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-medium mb-1">No text blasts yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Create your first bulk SMS campaign</p>
            <Button onClick={() => setView('create')}>
              <Plus className="h-4 w-4 mr-2" />
              Create Text Blast
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {blasts.map((blast: any) => {
            const cfg = statusConfig[blast.status] || statusConfig.draft;
            const StatusIcon = cfg.icon;
            return (
              <Card
                key={blast.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => { setSelectedBlastId(blast.id); setView('detail'); }}
              >
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <StatusIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{blast.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{blast.script.substring(0, 80)}...</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right text-sm">
                      <p className="font-medium">{blast.sent_count}/{blast.total_recipients}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(blast.created_at), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <Badge variant={cfg.variant}>{cfg.label}</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
