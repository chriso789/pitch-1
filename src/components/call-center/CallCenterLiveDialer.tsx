import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Phone, SkipForward, Square, User, Mail, MapPin,
  Loader2, ListChecks, PlayCircle, PhoneCall
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { toast } from '@/hooks/use-toast';

interface CallCenterLiveDialerProps {
  selectedListId: string | null;
  onEndSession: () => void;
}

export const CallCenterLiveDialer: React.FC<CallCenterLiveDialerProps> = ({
  selectedListId,
  onEndSession,
}) => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDisposition, setShowDisposition] = useState(false);
  const [disposition, setDisposition] = useState('');
  const [notes, setNotes] = useState('');
  const [savingDisposition, setSavingDisposition] = useState(false);

  // Fetch list items
  const { data: items, isLoading } = useQuery({
    queryKey: ['dialer-list-items', selectedListId],
    queryFn: async () => {
      if (!selectedListId) return [];
      const { data, error } = await supabase
        .from('dialer_list_items')
        .select('*')
        .eq('list_id', selectedListId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedListId,
  });

  // Fetch dispositions
  const { data: dispositions } = useQuery({
    queryKey: ['dialer-dispositions', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('dialer_dispositions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });

  const pendingItems = useMemo(() => items?.filter(i => i.status === 'pending') || [], [items]);
  const completedCount = useMemo(() => items?.filter(i => i.status !== 'pending').length || 0, [items]);
  const totalCount = items?.length || 0;
  const currentItem = pendingItems[currentIndex] || null;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const handleCall = () => {
    if (!currentItem) return;
    const cleanNumber = currentItem.phone.replace(/\D/g, '');
    window.location.href = `tel:${cleanNumber}`;

    // Log to communication_history
    (async () => {
      try {
        const user = (await supabase.auth.getUser()).data.user;
        const contactId = (currentItem.metadata as any)?.contact_id;
        if (tenantId && contactId) {
          await supabase.from('communication_history').insert({
            tenant_id: tenantId,
            contact_id: contactId,
            communication_type: 'call',
            direction: 'outbound',
            content: `Dialer call to ${currentItem.phone}`,
            rep_id: user?.id,
            metadata: { phone: currentItem.phone, method: 'tel_link', dialer_list_id: selectedListId },
          });
        }
      } catch (e) { console.error('Failed to log call:', e); }
    })();

    // Show disposition after calling
    setTimeout(() => setShowDisposition(true), 500);
  };

  const handleSaveDisposition = async () => {
    if (!disposition) {
      toast({ title: 'Select a disposition', variant: 'destructive' });
      return;
    }
    setSavingDisposition(true);
    try {
      // Update item status
      await supabase
        .from('dialer_list_items')
        .update({
          status: 'completed',
          metadata: {
            ...(currentItem?.metadata as any),
            disposition,
            disposition_notes: notes,
            called_at: new Date().toISOString(),
          },
        })
        .eq('id', currentItem!.id);

      setShowDisposition(false);
      setDisposition('');
      setNotes('');
      // Refresh items
      queryClient.invalidateQueries({ queryKey: ['dialer-list-items', selectedListId] });
      setCurrentIndex(0); // will re-index from pending
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSavingDisposition(false);
    }
  };

  const handleSkip = async () => {
    if (!currentItem) return;
    await supabase
      .from('dialer_list_items')
      .update({
        status: 'skipped',
        metadata: { ...(currentItem.metadata as any), skipped_at: new Date().toISOString() },
      })
      .eq('id', currentItem.id);
    queryClient.invalidateQueries({ queryKey: ['dialer-list-items', selectedListId] });
    setCurrentIndex(0);
  };

  if (!selectedListId) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <ListChecks className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-lg font-medium">No List Selected</p>
          <p className="text-sm text-muted-foreground mt-1">
            Select a list from the Lists tab or build a new one to start dialing.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-16 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!currentItem) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <PlayCircle className="h-12 w-12 mx-auto mb-4 text-primary opacity-70" />
          <p className="text-lg font-medium">List Complete!</p>
          <p className="text-sm text-muted-foreground mt-1">
            All {totalCount} contacts have been called or skipped.
          </p>
          <Button variant="outline" className="mt-4" onClick={onEndSession}>Back to Lists</Button>
        </CardContent>
      </Card>
    );
  }

  const meta = currentItem.metadata as any;

  return (
    <>
      <div className="space-y-4">
        {/* Progress */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{completedCount} of {totalCount} completed</span>
              <span className="text-sm text-muted-foreground">{pendingItems.length} remaining</span>
            </div>
            <Progress value={progressPct} className="h-2" />
          </CardContent>
        </Card>

        {/* Current contact */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <PhoneCall className="h-5 w-5 text-primary" />
              Current Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="text-xl font-semibold">
                  {currentItem.first_name} {currentItem.last_name}
                </h3>
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />
                    {currentItem.phone}
                  </span>
                  {currentItem.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="h-3.5 w-3.5" />
                      {currentItem.email}
                    </span>
                  )}
                </div>
                {meta?.qualification_status && (
                  <Badge variant="outline" className="mt-1">{meta.qualification_status}</Badge>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-2">
              <Button size="lg" onClick={handleCall} className="flex-1">
                <Phone className="h-4 w-4 mr-2" />
                Call
              </Button>
              <Button variant="outline" onClick={handleSkip}>
                <SkipForward className="h-4 w-4 mr-2" />
                Skip
              </Button>
              <Button variant="destructive" onClick={onEndSession}>
                <Square className="h-4 w-4 mr-2" />
                End
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Disposition Dialog */}
      <Dialog open={showDisposition} onOpenChange={setShowDisposition}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Call Disposition</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Outcome</Label>
              <Select value={disposition} onValueChange={setDisposition}>
                <SelectTrigger>
                  <SelectValue placeholder="Select outcome" />
                </SelectTrigger>
                <SelectContent>
                  {dispositions && dispositions.length > 0 ? (
                    dispositions.map(d => (
                      <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="connected">Connected</SelectItem>
                      <SelectItem value="voicemail">Voicemail</SelectItem>
                      <SelectItem value="no_answer">No Answer</SelectItem>
                      <SelectItem value="busy">Busy</SelectItem>
                      <SelectItem value="wrong_number">Wrong Number</SelectItem>
                      <SelectItem value="interested">Interested</SelectItem>
                      <SelectItem value="not_interested">Not Interested</SelectItem>
                      <SelectItem value="callback">Callback Requested</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea placeholder="Add notes..." value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDisposition(false); setDisposition(''); setNotes(''); }}>
              Skip Disposition
            </Button>
            <Button onClick={handleSaveDisposition} disabled={savingDisposition}>
              {savingDisposition && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save & Next
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
