import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { useLocation } from '@/contexts/LocationContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Plus, Megaphone, Send, CheckCircle, Ban, Trash2, Loader2,
  Phone, MessageSquare, ChevronDown, ArrowLeft,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { TextBlastCreator } from '@/components/communications/TextBlastCreator';
import { TextBlastDetail } from '@/components/communications/TextBlastDetail';
import { OutboundCampaignBuilder } from '@/components/ai-agent/OutboundCampaignBuilder';

type View =
  | { kind: 'list' }
  | { kind: 'create-blast' }
  | { kind: 'create-voice' }
  | { kind: 'blast-detail'; id: string };

type CampaignType = 'all' | 'voice' | 'blast';

const blastStatus: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: any }> = {
  draft: { label: 'Draft', variant: 'secondary', icon: Megaphone },
  sending: { label: 'Sending...', variant: 'default', icon: Send },
  completed: { label: 'Completed', variant: 'outline', icon: CheckCircle },
  cancelled: { label: 'Cancelled', variant: 'destructive', icon: Ban },
};

export function CampaignsHub() {
  const { activeTenantId } = useActiveTenantId();
  const { currentLocationId, currentLocation } = useLocation();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [filter, setFilter] = useState<CampaignType>('all');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; type: 'blast' | 'voice' } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: blasts, isLoading: blastsLoading, refetch: refetchBlasts } = useQuery({
    queryKey: ['sms-blasts', activeTenantId, currentLocationId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      let q = supabase
        .from('sms_blasts')
        .select('*')
        .eq('tenant_id', activeTenantId)
        .order('created_at', { ascending: false });
      if (currentLocationId) q = q.eq('from_location_id', currentLocationId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  const { data: voice, isLoading: voiceLoading, refetch: refetchVoice } = useQuery({
    queryKey: ['dialer-campaigns', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      const { data, error } = await (supabase.from('dialer_campaigns') as any)
        .select('*')
        .eq('tenant_id', activeTenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  const refetchAll = () => { refetchBlasts(); refetchVoice(); };

  const handleDelete = async () => {
    if (!deleteTarget || !activeTenantId) return;
    setDeleting(true);
    try {
      if (deleteTarget.type === 'blast') {
        await supabase.from('sms_blast_items').delete().eq('blast_id', deleteTarget.id);
        const { error } = await supabase
          .from('sms_blasts').delete()
          .eq('id', deleteTarget.id).eq('tenant_id', activeTenantId);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from('dialer_campaigns') as any)
          .delete().eq('id', deleteTarget.id).eq('tenant_id', activeTenantId);
        if (error) throw error;
      }
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
      refetchAll();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  if (view.kind === 'create-blast') {
    return (
      <TextBlastCreator
        onBack={() => { setView({ kind: 'list' }); refetchBlasts(); }}
        onCreated={(id) => { setView({ kind: 'blast-detail', id }); refetchBlasts(); }}
      />
    );
  }

  if (view.kind === 'create-voice') {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => { setView({ kind: 'list' }); refetchVoice(); }}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to campaigns
        </Button>
        <OutboundCampaignBuilder onCampaignCreated={() => { setView({ kind: 'list' }); refetchVoice(); }} />
      </div>
    );
  }

  if (view.kind === 'blast-detail') {
    return (
      <TextBlastDetail
        blastId={view.id}
        onBack={() => { setView({ kind: 'list' }); refetchBlasts(); }}
      />
    );
  }

  const isLoading = blastsLoading || voiceLoading;
  const blastItems = (blasts || []).map((b: any) => ({ ...b, _type: 'blast' as const }));
  const voiceItems = (voice || []).map((c: any) => ({ ...c, _type: 'voice' as const }));
  const combined =
    filter === 'blast' ? blastItems :
    filter === 'voice' ? voiceItems :
    [...blastItems, ...voiceItems].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-semibold">Campaigns</h2>
          <p className="text-sm text-muted-foreground">
            Manage AI voice campaigns and text blasts in one place
            {currentLocation ? ` — ${currentLocation.name}` : ' — All locations'}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" /> New Campaign
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => setView({ kind: 'create-blast' })}>
              <MessageSquare className="h-4 w-4 mr-2" />
              <div>
                <p className="font-medium">Text Blast</p>
                <p className="text-xs text-muted-foreground">Bulk SMS to contacts</p>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setView({ kind: 'create-voice' })}>
              <Phone className="h-4 w-4 mr-2" />
              <div>
                <p className="font-medium">AI Voice Campaign</p>
                <p className="text-xs text-muted-foreground">Automated outbound calls</p>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as CampaignType)}>
        <TabsList>
          <TabsTrigger value="all">All ({blastItems.length + voiceItems.length})</TabsTrigger>
          <TabsTrigger value="blast">Text Blasts ({blastItems.length})</TabsTrigger>
          <TabsTrigger value="voice">AI Voice ({voiceItems.length})</TabsTrigger>
        </TabsList>
        <TabsContent value={filter} className="pt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>
          ) : !combined.length ? (
            <Card>
              <CardContent className="text-center py-12">
                <Megaphone className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="text-lg font-medium mb-1">No campaigns yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Create a text blast or an AI voice campaign to get started
                </p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" onClick={() => setView({ kind: 'create-blast' })}>
                    <MessageSquare className="h-4 w-4 mr-2" /> Text Blast
                  </Button>
                  <Button onClick={() => setView({ kind: 'create-voice' })}>
                    <Phone className="h-4 w-4 mr-2" /> AI Voice
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {combined.map((item: any) => {
                if (item._type === 'blast') {
                  const cfg = blastStatus[item.status] || blastStatus.draft;
                  const Icon = cfg.icon;
                  return (
                    <Card
                      key={`blast-${item.id}`}
                      className="cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => setView({ kind: 'blast-detail', id: item.id })}
                    >
                      <CardContent className="flex items-center justify-between py-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                            <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium truncate">{item.name}</p>
                              <Badge variant="outline" className="text-xs">Text Blast</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {item.script?.substring(0, 80)}...
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right text-sm">
                            <p className="font-medium">{item.sent_count}/{item.total_recipients}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(item.created_at), 'MMM d, yyyy')}
                            </p>
                          </div>
                          <Badge variant={cfg.variant}><Icon className="h-3 w-3 mr-1" />{cfg.label}</Badge>
                          <Button
                            variant="ghost" size="icon"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget({ id: item.id, name: item.name, type: 'blast' });
                            }}
                            aria-label={`Delete ${item.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                }
                // voice campaign
                return (
                  <Card key={`voice-${item.id}`} className="hover:border-primary/50 transition-colors">
                    <CardContent className="flex items-center justify-between py-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{item.name}</p>
                            <Badge variant="outline" className="text-xs">AI Voice</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {item.description || 'AI-powered outbound campaign'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right text-sm">
                          <p className="font-medium">
                            {item.total_bridged ?? 0}/{item.total_attempts ?? 0}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(item.created_at), 'MMM d, yyyy')}
                          </p>
                        </div>
                        <Badge variant={item.is_active ? 'default' : 'secondary'}>
                          {item.is_active ? 'Active' : 'Paused'}
                        </Badge>
                        <Button
                          variant="ghost" size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({ id: item.id, name: item.name, type: 'voice' });
                          }}
                          aria-label={`Delete ${item.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove "{deleteTarget?.name}"
              {deleteTarget?.type === 'blast' ? ' and all its recipient records' : ' and its dialer queue'}.
              Messages or calls already delivered cannot be recalled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deleting...</>) : (<><Trash2 className="h-4 w-4 mr-2" /> Delete</>)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
