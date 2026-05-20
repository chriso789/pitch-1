/**
 * Call Detail Panel
 * Shows full details for a call selected from the unified inbox.
 * Reads from `calls` table via metadata.calls_table_id on the inbox item.
 */
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Phone, PhoneIncoming, PhoneOutgoing, Clock, User, FileText, Mic, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import type { UnifiedInboxItem } from '@/hooks/useCommunications';

interface CallDetailPanelProps {
  item: UnifiedInboxItem;
  onCall?: (phone: string) => void;
}

interface CallRow {
  id: string;
  direction: string | null;
  status: string | null;
  from_number: string | null;
  to_number: string | null;
  duration: number | null;
  duration_seconds: number | null;
  recording_url: string | null;
  transcript: string | null;
  ai_summary: string | null;
  notes: string | null;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
}

const formatDuration = (seconds: number | null) => {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
};

export const CallDetailPanel = ({ item, onCall }: CallDetailPanelProps) => {
  const [loading, setLoading] = useState(true);
  const [call, setCall] = useState<CallRow | null>(null);

  const callsTableId = (item.metadata as any)?.calls_table_id as string | undefined;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setCall(null);
      if (!callsTableId) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('calls')
        .select('id, direction, status, from_number, to_number, duration, duration_seconds, recording_url, transcript, ai_summary, notes, created_at, answered_at, ended_at')
        .eq('id', callsTableId)
        .maybeSingle();
      if (!cancelled) {
        setCall(data as CallRow | null);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [callsTableId]);

  const isInbound = item.direction === 'inbound';
  const Icon = isInbound ? PhoneIncoming : PhoneOutgoing;
  const otherParty = item.phone_number || '';
  const contactName = item.contact
    ? `${item.contact.first_name} ${item.contact.last_name}`.trim()
    : otherParty || 'Unknown';

  const duration = call?.duration_seconds ?? call?.duration ?? null;

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base truncate">{contactName}</CardTitle>
                  <p className="text-xs text-muted-foreground truncate">
                    {isInbound ? 'Inbound' : 'Outbound'} · {otherParty || '—'}
                  </p>
                </div>
              </div>
              {otherParty && (
                <Button size="sm" variant="outline" onClick={() => onCall?.(otherParty)}>
                  <Phone className="h-4 w-4 mr-1" /> Call back
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>{format(new Date(item.created_at), 'PPpp')}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Status</div>
                    <Badge variant="secondary" className="mt-1 capitalize">
                      {call?.status || 'unknown'}
                    </Badge>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Duration</div>
                    <div className="mt-1 font-medium">{formatDuration(duration)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">From</div>
                    <div className="mt-1 font-mono text-xs">{call?.from_number || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">To</div>
                    <div className="mt-1 font-mono text-xs">{call?.to_number || '—'}</div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {call?.recording_url && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Mic className="h-4 w-4" /> Recording
              </CardTitle>
            </CardHeader>
            <CardContent>
              <audio controls src={call.recording_url} className="w-full" />
            </CardContent>
          </Card>
        )}

        {call?.ai_summary && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> AI Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{call.ai_summary}</p>
            </CardContent>
          </Card>
        )}

        {call?.transcript && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4" /> Transcript
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{call.transcript}</p>
            </CardContent>
          </Card>
        )}

        {!loading && !call?.recording_url && !call?.transcript && !call?.ai_summary && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <User className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  No recording or transcript was captured for this call. Enable call recording and
                  AI transcription on your Telnyx connection to see full details here.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
};
