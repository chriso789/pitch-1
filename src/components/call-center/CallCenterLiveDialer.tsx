import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
  Phone, SkipForward, Square, User, Mail,
  Loader2, ListChecks, PlayCircle, PhoneCall,
  MicOff, Mic, PhoneOff, Voicemail, Timer
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { toast } from '@/hooks/use-toast';
import { ContactDetailPanel } from './ContactDetailPanel';

type DialerPhase = 'idle' | 'calling' | 'active' | 'disposition' | 'detail';

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
  const [phase, setPhase] = useState<DialerPhase>('idle');
  const [disposition, setDisposition] = useState('');
  const [notes, setNotes] = useState('');
  const [savingDisposition, setSavingDisposition] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callStartTime, setCallStartTime] = useState<Date | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [amdResult, setAmdResult] = useState<string | null>(null);
  const [selectedVoicemailId, setSelectedVoicemailId] = useState<string | null>(null);
  const [droppingVoicemail, setDroppingVoicemail] = useState(false);

  // Duration timer
  useEffect(() => {
    if (phase !== 'active' || !callStartTime) return;
    const interval = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - callStartTime.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, callStartTime]);

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

  // Fetch voicemail templates
  const { data: voicemailTemplates } = useQuery({
    queryKey: ['voicemail-templates', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('voicemail_templates')
        .select('id, name, audio_url')
        .eq('tenant_id', tenantId)
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
  const meta = currentItem?.metadata as any;
  const contactId = meta?.contact_id;

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Initiate call via Telnyx
  const handleCall = useCallback(async () => {
    if (!currentItem || !tenantId || !contactId) return;

    setPhase('calling');
    setAmdResult(null);
    setCallDuration(0);

    try {
      const { data, error } = await supabase.functions.invoke('telnyx-dial', {
        body: {
          tenant_id: tenantId,
          contact_id: contactId,
          record: true,
          answering_machine_detection: 'premium',
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Failed to initiate call');

      setActiveCallId(data.call.id);
      setPhase('active');
      setCallStartTime(new Date());

      toast({ title: 'Call connected', description: `Calling ${currentItem.first_name} ${currentItem.last_name}` });

      // Listen for AMD results via realtime
      const channel = supabase.channel(`amd-${data.call.id}`);
      channel.on('broadcast', { event: 'amd_result' }, (msg) => {
        setAmdResult(msg.payload?.result || null);
        if (msg.payload?.result === 'machine') {
          toast({ title: 'Voicemail detected', description: 'You can drop a voicemail now.' });
        }
      }).subscribe();

    } catch (err: any) {
      console.error('Call failed:', err);
      toast({ title: 'Call failed', description: err.message, variant: 'destructive' });
      setPhase('idle');
    }
  }, [currentItem, tenantId, contactId]);

  // End call
  const handleHangup = useCallback(async () => {
    if (activeCallId) {
      // Update call record to completed
      await supabase.from('calls').update({
        status: 'completed',
        ended_at: new Date().toISOString(),
        duration_seconds: callDuration,
      }).eq('id', activeCallId);
    }

    setPhase('disposition');
    setCallStartTime(null);
  }, [activeCallId, callDuration]);

  // Drop voicemail
  const handleDropVoicemail = async () => {
    if (!selectedVoicemailId || !activeCallId) {
      toast({ title: 'Select a voicemail template', variant: 'destructive' });
      return;
    }

    setDroppingVoicemail(true);
    try {
      // Get call_control_id from our call record
      const { data: callRow } = await supabase
        .from('calls')
        .select('telnyx_call_control_id')
        .eq('id', activeCallId)
        .single();

      if (!callRow?.telnyx_call_control_id) {
        throw new Error('No call control ID found');
      }

      const { data, error } = await supabase.functions.invoke('telnyx-voicemail-drop', {
        body: {
          call_control_id: callRow.telnyx_call_control_id,
          voicemail_template_id: selectedVoicemailId,
          call_id: activeCallId,
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Voicemail drop failed');

      toast({ title: 'Voicemail dropped', description: 'Moving to next contact...' });

      // Auto-advance: save disposition as voicemail and move on
      await supabase.from('dialer_list_items').update({
        status: 'completed',
        metadata: {
          ...meta,
          disposition: 'voicemail_drop',
          voicemail_template_id: selectedVoicemailId,
          called_at: new Date().toISOString(),
        },
      }).eq('id', currentItem!.id);

      setPhase('idle');
      setActiveCallId(null);
      setAmdResult(null);
      setSelectedVoicemailId(null);
      queryClient.invalidateQueries({ queryKey: ['dialer-list-items', selectedListId] });
      setCurrentIndex(0);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDroppingVoicemail(false);
    }
  };

  // Save disposition
  const handleSaveDisposition = async () => {
    if (!disposition) {
      toast({ title: 'Select a disposition', variant: 'destructive' });
      return;
    }
    setSavingDisposition(true);
    try {
      await supabase.from('dialer_list_items').update({
        status: 'completed',
        metadata: {
          ...meta,
          disposition,
          disposition_notes: notes,
          called_at: new Date().toISOString(),
          call_id: activeCallId,
        },
      }).eq('id', currentItem!.id);

      // Log to communication_history
      if (tenantId && contactId) {
        const user = (await supabase.auth.getUser()).data.user;
        await supabase.from('communication_history').insert({
          tenant_id: tenantId,
          contact_id: contactId,
          communication_type: 'call',
          direction: 'outbound',
          content: `Dialer call — ${disposition}${notes ? ': ' + notes : ''}`,
          rep_id: user?.id,
          metadata: {
            phone: currentItem!.phone,
            method: 'telnyx_webrtc',
            dialer_list_id: selectedListId,
            call_id: activeCallId,
            duration_seconds: callDuration,
          },
        });
      }

      setDisposition('');
      setNotes('');
      setActiveCallId(null);

      // Show contact detail panel
      setPhase('detail');

      queryClient.invalidateQueries({ queryKey: ['dialer-list-items', selectedListId] });
      setCurrentIndex(0);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSavingDisposition(false);
    }
  };

  // Skip contact
  const handleSkip = async () => {
    if (!currentItem) return;
    await supabase.from('dialer_list_items').update({
      status: 'skipped',
      metadata: { ...meta, skipped_at: new Date().toISOString() },
    }).eq('id', currentItem.id);
    queryClient.invalidateQueries({ queryKey: ['dialer-list-items', selectedListId] });
    setCurrentIndex(0);
  };

  // Advance from detail panel
  const handleNextFromDetail = () => {
    setPhase('idle');
    setCurrentIndex(0);
  };

  // --- Render States ---

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

  // Show contact detail panel between calls
  if (phase === 'detail' && contactId) {
    return (
      <ContactDetailPanel
        contactId={contactId}
        contactName={`${currentItem?.first_name || ''} ${currentItem?.last_name || ''}`.trim()}
        contactPhone={currentItem?.phone || ''}
        contactEmail={currentItem?.email}
        onNext={handleNextFromDetail}
      />
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
              {phase === 'active' && (
                <Badge variant="default" className="ml-auto gap-1.5 animate-pulse">
                  <Timer className="h-3 w-3" />
                  {formatDuration(callDuration)}
                </Badge>
              )}
              {phase === 'calling' && (
                <Badge variant="secondary" className="ml-auto animate-pulse">
                  Connecting...
                </Badge>
              )}
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

            {/* Call controls */}
            <div className="flex items-center gap-2 pt-2">
              {phase === 'idle' && (
                <>
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
                </>
              )}

              {phase === 'calling' && (
                <Button size="lg" variant="destructive" className="flex-1" disabled>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </Button>
              )}

              {phase === 'active' && (
                <>
                  <Button
                    variant={isMuted ? 'destructive' : 'outline'}
                    onClick={() => setIsMuted(!isMuted)}
                  >
                    {isMuted ? <MicOff className="h-4 w-4 mr-2" /> : <Mic className="h-4 w-4 mr-2" />}
                    {isMuted ? 'Unmute' : 'Mute'}
                  </Button>
                  <Button size="lg" variant="destructive" onClick={handleHangup} className="flex-1">
                    <PhoneOff className="h-4 w-4 mr-2" />
                    Hang Up
                  </Button>
                </>
              )}
            </div>

            {/* AMD + Voicemail Drop */}
            {phase === 'active' && amdResult === 'machine' && voicemailTemplates && voicemailTemplates.length > 0 && (
              <Card className="border-destructive/30 bg-destructive/5">
                <CardContent className="pt-4 pb-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <Voicemail className="h-4 w-4" />
                    Voicemail Detected
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={selectedVoicemailId || ''} onValueChange={setSelectedVoicemailId}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select voicemail to drop..." />
                      </SelectTrigger>
                      <SelectContent>
                        {voicemailTemplates.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleDropVoicemail}
                      disabled={droppingVoicemail || !selectedVoicemailId}
                      className="shrink-0"
                    >
                      {droppingVoicemail ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <Voicemail className="h-4 w-4 mr-1.5" />
                      )}
                      Drop VM
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Disposition Dialog */}
      <Dialog open={phase === 'disposition'} onOpenChange={(open) => { if (!open) setPhase('detail'); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Call Disposition</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Call duration: {formatDuration(callDuration)}
            </div>
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
            <Button variant="outline" onClick={() => { setPhase('detail'); setDisposition(''); setNotes(''); }}>
              Skip Disposition
            </Button>
            <Button onClick={handleSaveDisposition} disabled={savingDisposition}>
              {savingDisposition && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save & Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
