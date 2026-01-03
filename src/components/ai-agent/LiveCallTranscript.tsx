import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { 
  Phone, 
  PhoneOff, 
  User, 
  Bot, 
  Clock,
  MessageSquare,
  Smile,
  Meh,
  Frown,
  Loader2,
  Send
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface TranscriptEntry {
  id: string;
  speaker: 'ai' | 'caller';
  text: string;
  timestamp: Date;
  confidence?: number;
  sentiment?: 'positive' | 'neutral' | 'negative';
}

interface ActiveCall {
  callControlId: string;
  callerNumber: string;
  startedAt: Date;
  status: 'ringing' | 'answered' | 'ended';
}

interface LiveCallTranscriptProps {
  callControlId?: string;
  compact?: boolean;
}

export function LiveCallTranscript({ 
  callControlId,
  compact = false 
}: LiveCallTranscriptProps) {
  const { profile } = useUserProfile();
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [manualNotes, setManualNotes] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new transcript entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript]);

  // Subscribe to real-time transcript updates
  useEffect(() => {
    if (!profile?.tenant_id) return;

    const channel = supabase.channel(`call-transcript-${callControlId || 'all'}`)
      .on('broadcast', { event: 'transcript_chunk' }, (payload) => {
        const { text, speaker, confidence, call_control_id } = payload.payload;
        
        // Only process if this is for our call (or we're watching all)
        if (callControlId && call_control_id !== callControlId) return;
        
        setTranscript(prev => [...prev, {
          id: Date.now().toString(),
          speaker: speaker as 'ai' | 'caller',
          text,
          timestamp: new Date(),
          confidence,
        }]);
      })
      .on('broadcast', { event: 'call_started' }, (payload) => {
        const { call_control_id, caller_number } = payload.payload;
        if (callControlId && call_control_id !== callControlId) return;
        
        setActiveCall({
          callControlId: call_control_id,
          callerNumber: caller_number,
          startedAt: new Date(),
          status: 'answered',
        });
        setTranscript([]);
      })
      .on('broadcast', { event: 'call_ended' }, (payload) => {
        const { call_control_id } = payload.payload;
        if (callControlId && call_control_id !== callControlId) return;
        
        setActiveCall(prev => prev ? { ...prev, status: 'ended' } : null);
      })
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.tenant_id, callControlId]);

  // Fetch existing call transcripts
  useEffect(() => {
    if (!profile?.tenant_id || !callControlId) return;

    const fetchTranscripts = async () => {
      const { data } = await supabase
        .from('call_transcripts')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('call_id', callControlId)
        .order('timestamp_ms', { ascending: true });

      if (data) {
        setTranscript(data.map(t => ({
          id: t.id,
          speaker: (t.speaker as 'ai' | 'caller') || 'caller',
          text: t.transcript_text,
          timestamp: new Date(t.created_at),
          confidence: t.confidence || undefined,
        })));
      }
    };

    fetchTranscripts();
  }, [profile?.tenant_id, callControlId]);

  const getSentimentIcon = (sentiment?: string) => {
    switch (sentiment) {
      case 'positive': return <Smile className="h-4 w-4 text-green-500" />;
      case 'negative': return <Frown className="h-4 w-4 text-red-500" />;
      default: return <Meh className="h-4 w-4 text-yellow-500" />;
    }
  };

  const formatDuration = (start: Date) => {
    const seconds = Math.floor((new Date().getTime() - start.getTime()) / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Update duration every second
  const [duration, setDuration] = useState('0:00');
  useEffect(() => {
    if (!activeCall || activeCall.status === 'ended') return;
    
    const interval = setInterval(() => {
      setDuration(formatDuration(activeCall.startedAt));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [activeCall]);

  if (compact) {
    return (
      <div className="space-y-2">
        {activeCall ? (
          <div className="flex items-center gap-2 text-sm">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>Active call: {activeCall.callerNumber}</span>
            <span className="text-muted-foreground">{duration}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <PhoneOff className="h-4 w-4" />
            <span>No active call</span>
          </div>
        )}
        
        {transcript.length > 0 && (
          <div className="text-sm text-muted-foreground italic truncate">
            Latest: "{transcript[transcript.length - 1]?.text}"
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Live Transcript
          </CardTitle>
          <div className="flex items-center gap-2">
            {isConnected ? (
              <Badge variant="outline" className="text-green-600">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse mr-2" />
                Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="text-orange-600">
                <Loader2 className="h-3 w-3 animate-spin mr-2" />
                Connecting...
              </Badge>
            )}
          </div>
        </div>
        
        {activeCall && (
          <div className="flex items-center justify-between mt-2 p-2 rounded-lg bg-muted">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-green-500" />
              <span className="font-medium">{activeCall.callerNumber}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono">{duration}</span>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="flex-1 flex flex-col overflow-hidden">
        {/* Transcript Area */}
        <ScrollArea className="flex-1 pr-4" ref={scrollRef}>
          <div className="space-y-3">
            {transcript.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "flex gap-3",
                  entry.speaker === 'ai' ? "justify-start" : "justify-end"
                )}
              >
                {entry.speaker === 'ai' && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                
                <div className={cn(
                  "max-w-[80%] rounded-lg p-3",
                  entry.speaker === 'ai' 
                    ? "bg-muted" 
                    : "bg-primary text-primary-foreground"
                )}>
                  <p className="text-sm">{entry.text}</p>
                  <div className={cn(
                    "flex items-center gap-2 mt-1 text-xs",
                    entry.speaker === 'ai' 
                      ? "text-muted-foreground" 
                      : "text-primary-foreground/70"
                  )}>
                    <span>{format(entry.timestamp, 'h:mm:ss a')}</span>
                    {entry.confidence && (
                      <span>({Math.round(entry.confidence * 100)}%)</span>
                    )}
                    {entry.sentiment && getSentimentIcon(entry.sentiment)}
                  </div>
                </div>
                
                {entry.speaker === 'caller' && (
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))}
            
            {transcript.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>Transcript will appear here when a call is active</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Manual Notes */}
        <div className="mt-4 pt-4 border-t">
          <div className="flex gap-2">
            <Textarea
              placeholder="Add manual notes..."
              value={manualNotes}
              onChange={(e) => setManualNotes(e.target.value)}
              className="min-h-[60px] resize-none"
            />
            <Button 
              size="sm" 
              className="shrink-0"
              disabled={!manualNotes.trim()}
              onClick={() => {
                // Add manual note to transcript
                setTranscript(prev => [...prev, {
                  id: Date.now().toString(),
                  speaker: 'ai',
                  text: `[Note] ${manualNotes}`,
                  timestamp: new Date(),
                }]);
                setManualNotes('');
              }}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
