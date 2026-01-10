/**
 * Call Center Page
 * Displays calls with recordings, transcripts, and AI insights
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Phone, Mic, Bot, Clock, PhoneCall, PhoneOff, 
  Play, Pause, Download, RefreshCw, Filter,
  ChevronDown, ChevronRight, FileText
} from 'lucide-react';
import { format, formatDuration, intervalToDuration } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface CallRecord {
  id: string;
  from_number: string | null;
  to_number: string | null;
  direction: string | null;
  status: string | null;
  created_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  transcript: string | null;
  ai_enabled: boolean | null;
  ai_summary: any;
  ai_outcome: string | null;
  ai_insights: any;
  contact?: {
    first_name: string | null;
    last_name: string | null;
  } | null;
}

const CallCenterPage = () => {
  const tenantId = useEffectiveTenantId();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);

  // Fetch calls
  const { data: calls, isLoading, refetch } = useQuery({
    queryKey: ['call-center-calls', tenantId, statusFilter],
    queryFn: async () => {
      if (!tenantId) return [];
      
      let query = supabase
        .from('calls')
        .select(`
          *,
          contact:contacts(first_name, last_name)
        `)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      
      const { data, error } = await query.limit(50);
      if (error) throw error;
      return data as CallRecord[];
    },
    enabled: !!tenantId,
  });

  // Note: call_recordings and call_transcripts queries removed until tables are typed
  const callRecordings: any[] = [];
  const callTranscripts: any[] = [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-300">Completed</Badge>;
      case 'in-progress':
      case 'ringing':
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-300">Active</Badge>;
      case 'missed':
      case 'no-answer':
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-300">Missed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getDirectionIcon = (direction: string, status: string) => {
    if (status === 'in-progress' || status === 'ringing') {
      return <PhoneCall className="h-4 w-4 text-green-500 animate-pulse" />;
    }
    return direction === 'inbound' 
      ? <Phone className="h-4 w-4 text-blue-500" />
      : <PhoneOff className="h-4 w-4 text-muted-foreground" />;
  };

  const formatCallDuration = (seconds: number | null) => {
    if (!seconds) return '--:--';
    const duration = intervalToDuration({ start: 0, end: seconds * 1000 });
    return formatDuration(duration, { format: ['minutes', 'seconds'] });
  };

  const toggleExpand = (callId: string) => {
    setExpandedCallId(expandedCallId === callId ? null : callId);
  };

  return (
    <GlobalLayout>
      <div className="container mx-auto py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Phone className="h-6 w-6 text-primary" />
              Call Center
            </h1>
            <p className="text-muted-foreground mt-1">
              View call recordings, transcripts, and AI insights
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Calls</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="in-progress">Active</SelectItem>
                <SelectItem value="missed">Missed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{calls?.length || 0}</div>
              <p className="text-muted-foreground text-sm">Total Calls</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">
                {calls?.filter(c => c.recording_url).length || 0}
              </div>
              <p className="text-muted-foreground text-sm">With Recordings</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">
                {calls?.filter(c => c.transcript).length || 0}
              </div>
              <p className="text-muted-foreground text-sm">With Transcripts</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">
                {calls?.filter(c => c.ai_enabled).length || 0}
              </div>
              <p className="text-muted-foreground text-sm">AI Enabled</p>
            </CardContent>
          </Card>
        </div>

        {/* Calls List */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Calls</CardTitle>
            <CardDescription>
              Click on a call to view recordings, transcripts, and AI analysis
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : calls?.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Phone className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No calls found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {calls?.map((call) => (
                  <Collapsible
                    key={call.id}
                    open={expandedCallId === call.id}
                    onOpenChange={() => toggleExpand(call.id)}
                  >
                    <CollapsibleTrigger asChild>
                      <div className={cn(
                        "p-4 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors",
                        expandedCallId === call.id && "bg-accent/50 border-primary"
                      )}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            {getDirectionIcon(call.direction, call.status)}
                            <div>
                              <div className="font-medium flex items-center gap-2">
                              {call.contact 
                                  ? `${call.contact.first_name || ''} ${call.contact.last_name || ''}`.trim() || 'Unknown'
                                  : call.direction === 'inbound' ? call.from_number : call.to_number
                                }
                                {call.ai_enabled && (
                                  <Bot className="h-4 w-4 text-primary" />
                                )}
                                {call.recording_url && (
                                  <Mic className="h-4 w-4 text-green-500" />
                                )}
                              </div>
                              <div className="text-sm text-muted-foreground flex items-center gap-2">
                                <Clock className="h-3 w-3" />
                                {format(new Date(call.created_at), 'MMM d, h:mm a')}
                                <span>•</span>
                                {formatCallDuration(call.duration_seconds)}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {getStatusBadge(call.status)}
                            {expandedCallId === call.id 
                              ? <ChevronDown className="h-4 w-4" />
                              : <ChevronRight className="h-4 w-4" />
                            }
                          </div>
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    
                    <CollapsibleContent>
                      <div className="mt-2 p-4 bg-muted/30 rounded-lg space-y-4">
                        {/* Recording Section */}
                        <div>
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <Mic className="h-4 w-4" />
                            Recording
                          </h4>
                          {call.recording_url ? (
                            <div className="flex items-center gap-2">
                              <audio
                                controls
                                src={call.recording_url}
                                className="flex-1 h-10"
                              />
                              <Button variant="outline" size="sm" asChild>
                                <a href={call.recording_url} download>
                                  <Download className="h-4 w-4" />
                                </a>
                              </Button>
                            </div>
                          ) : callRecordings && callRecordings.length > 0 ? (
                            <div className="space-y-2">
                              {callRecordings.map((rec: any) => (
                                <div key={rec.id} className="flex items-center gap-2">
                                  <audio
                                    controls
                                    src={rec.recording_url}
                                    className="flex-1 h-10"
                                  />
                                  <Badge variant="outline">{rec.channel}</Badge>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">No recording available</p>
                          )}
                        </div>

                        {/* Transcript Section */}
                        <div>
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <FileText className="h-4 w-4" />
                            Transcript
                          </h4>
                          {call.transcript ? (
                            <ScrollArea className="h-32 rounded border p-3 bg-background">
                              <p className="text-sm whitespace-pre-wrap">{call.transcript}</p>
                            </ScrollArea>
                          ) : callTranscripts && callTranscripts.length > 0 ? (
                            <ScrollArea className="h-32 rounded border p-3 bg-background">
                              {callTranscripts.map((t: any) => (
                                <div key={t.id} className="mb-2">
                                  <p className="text-sm whitespace-pre-wrap">{t.transcript_text}</p>
                                </div>
                              ))}
                            </ScrollArea>
                          ) : (
                            <p className="text-sm text-muted-foreground">No transcript available</p>
                          )}
                        </div>

                        {/* AI Section */}
                        {call.ai_enabled && (
                          <div>
                            <h4 className="font-medium flex items-center gap-2 mb-2">
                              <Bot className="h-4 w-4" />
                              AI Analysis
                            </h4>
                            <div className="space-y-2">
                              {call.ai_outcome && (
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">Outcome:</span>
                                  <Badge>{call.ai_outcome}</Badge>
                                </div>
                              )}
                              {call.ai_summary && (
                                <div className="p-3 bg-background rounded border">
                                  <p className="text-sm">{JSON.stringify(call.ai_summary, null, 2)}</p>
                                </div>
                              )}
                              {call.ai_insights && (
                                <div className="p-3 bg-background rounded border">
                                  <p className="text-sm font-medium mb-1">Insights:</p>
                                  <pre className="text-xs overflow-auto">
                                    {JSON.stringify(call.ai_insights, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {!call.ai_outcome && !call.ai_summary && !call.ai_insights && (
                                <p className="text-sm text-muted-foreground">AI analysis pending</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
};

export default CallCenterPage;
