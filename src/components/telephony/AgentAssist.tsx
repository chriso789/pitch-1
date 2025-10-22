import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { MessageSquare } from 'lucide-react';

interface Transcript {
  id: string;
  transcript_text: string;
  speaker: string;
  timestamp_ms: number;
  created_at: string;
  is_partial: boolean;
}

interface AgentAssistProps {
  callId: string | null;
}

export const AgentAssist = ({ callId }: AgentAssistProps) => {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);

  useEffect(() => {
    if (!callId) {
      setTranscripts([]);
      return;
    }

    // Fetch existing transcripts
    const fetchTranscripts = async () => {
      const { data } = await supabase
        .from('call_transcripts')
        .select('*')
        .eq('call_id', callId)
        .eq('is_partial', false)
        .order('created_at', { ascending: true });

      if (data) {
        setTranscripts(data);
      }
    };

    fetchTranscripts();

    // Subscribe to new transcripts via Realtime
    const channel = supabase
      .channel(`transcripts:${callId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_transcripts',
          filter: `call_id=eq.${callId}`,
        },
        (payload) => {
          const newTranscript = payload.new as Transcript;
          if (!newTranscript.is_partial) {
            setTranscripts((prev) => [...prev, newTranscript]);
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [callId]);

  if (!callId) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Agent Assist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No active call</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Live Transcript
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-3">
            {transcripts.map((t) => (
              <div key={t.id} className="flex gap-2">
                <Badge variant={t.speaker === 'agent' ? 'default' : 'secondary'} className="h-6">
                  {t.speaker}
                </Badge>
                <p className="text-sm flex-1">{t.transcript_text}</p>
              </div>
            ))}
            {transcripts.length === 0 && (
              <p className="text-sm text-muted-foreground">Waiting for audio...</p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
