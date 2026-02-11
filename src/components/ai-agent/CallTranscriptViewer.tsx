import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Phone, Clock, Calendar, User, ChevronRight, FileText } from 'lucide-react';
import { format } from 'date-fns';

interface AiCallTranscript {
  id: string;
  caller_number: string | null;
  created_at: string | null;
  call_duration_seconds: number | null;
  sentiment: string | null;
  gathered_data: Record<string, unknown> | null;
  telnyx_call_control_id: string | null;
  escalated_to_human: boolean | null;
  escalation_reason: string | null;
}

interface TranscriptLine {
  id: string;
  call_id: string;
  speaker: string;
  transcript_text: string;
  timestamp_ms: number;
  created_at: string;
}

const sentimentColor = (s: string | null) => {
  if (!s) return 'secondary';
  switch (s.toLowerCase()) {
    case 'positive': return 'default';
    case 'negative': return 'destructive';
    default: return 'secondary';
  }
};

const formatDuration = (seconds: number | null) => {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export function CallTranscriptViewer() {
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<AiCallTranscript | null>(null);

  const { data: calls = [], isLoading: loadingCalls } = useQuery({
    queryKey: ['ai-call-transcripts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_call_transcripts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as AiCallTranscript[];
    },
  });

  const { data: lines = [], isLoading: loadingLines } = useQuery({
    queryKey: ['call-transcript-lines', selectedCall?.telnyx_call_control_id],
    enabled: !!selectedCall?.telnyx_call_control_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('call_transcripts')
        .select('*')
        .eq('call_id', selectedCall!.telnyx_call_control_id!)
        .eq('is_partial', false)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TranscriptLine[];
    },
  });

  const handleSelectCall = (call: AiCallTranscript) => {
    setSelectedCallId(call.id);
    setSelectedCall(call);
  };

  const gatheredData = selectedCall?.gathered_data as Record<string, unknown> | null;

  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-6 h-[calc(100vh-280px)] min-h-[500px]">
      {/* Left panel — call list */}
      <Card className="flex flex-col overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Recent Calls
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-hidden">
          <ScrollArea className="h-full">
            {loadingCalls ? (
              <p className="text-sm text-muted-foreground p-4">Loading…</p>
            ) : calls.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">No AI call transcripts yet.</p>
            ) : (
              <div className="divide-y">
                {calls.map((call) => (
                  <button
                    key={call.id}
                    onClick={() => handleSelectCall(call)}
                    className={cn(
                      'w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center gap-3',
                      selectedCallId === call.id && 'bg-muted'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {call.caller_number ?? 'Unknown'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {call.created_at ? format(new Date(call.created_at), 'MMM d, h:mm a') : '—'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(call.call_duration_seconds)}
                        </span>
                      </div>
                    </div>
                    <Badge variant={sentimentColor(call.sentiment)} className="shrink-0 text-[10px]">
                      {call.sentiment ?? 'n/a'}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Right panel — transcript detail */}
      <Card className="flex flex-col overflow-hidden">
        {!selectedCall ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a call to view the transcript
          </div>
        ) : (
          <>
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">{selectedCall.caller_number ?? 'Unknown Caller'}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedCall.created_at ? format(new Date(selectedCall.created_at), 'MMMM d, yyyy · h:mm a') : ''}
                    {' · '}
                    {formatDuration(selectedCall.call_duration_seconds)}
                    {selectedCall.escalated_to_human && (
                      <Badge variant="destructive" className="ml-2 text-[10px]">Escalated</Badge>
                    )}
                  </p>
                </div>
                <Badge variant={sentimentColor(selectedCall.sentiment)}>
                  {selectedCall.sentiment ?? 'n/a'}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="flex-1 overflow-hidden p-0">
              <div className="grid md:grid-cols-[1fr_280px] h-full divide-x">
                {/* Conversation */}
                <ScrollArea className="h-full p-4">
                  {loadingLines ? (
                    <p className="text-sm text-muted-foreground">Loading transcript…</p>
                  ) : lines.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No line-by-line transcript available for this call.</p>
                  ) : (
                    <div className="space-y-3">
                      {lines.map((line) => {
                        const isAgent = line.speaker === 'agent' || line.speaker === 'ai';
                        return (
                          <div key={line.id} className={cn('flex', isAgent ? 'justify-start' : 'justify-end')}>
                            <div
                              className={cn(
                                'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                                isAgent
                                  ? 'bg-muted text-foreground'
                                  : 'bg-primary text-primary-foreground'
                              )}
                            >
                              <p className="text-[10px] font-medium mb-0.5 opacity-70">
                                {isAgent ? 'AI Agent' : 'Caller'}
                              </p>
                              <p className="break-words">{line.transcript_text}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>

                {/* Gathered data sidebar */}
                <ScrollArea className="h-full p-4 bg-muted/30">
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Gathered Data
                  </h4>
                  {gatheredData && Object.keys(gatheredData).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(gatheredData).map(([key, value]) => (
                        <div key={key} className="text-sm">
                          <span className="text-muted-foreground capitalize">
                            {key.replace(/_/g, ' ')}:
                          </span>{' '}
                          <span className="font-medium">{String(value ?? '—')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No qualification data gathered.</p>
                  )}

                  {selectedCall.escalation_reason && (
                    <div className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                      <p className="text-xs font-semibold text-destructive mb-1">Escalation Reason</p>
                      <p className="text-sm">{selectedCall.escalation_reason}</p>
                    </div>
                  )}
                </ScrollArea>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
