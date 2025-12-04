import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import {
  Phone,
  Mail,
  MessageSquare,
  FileText,
  Calendar,
  Clock,
  User,
  ArrowRight,
  PhoneIncoming,
  PhoneOutgoing,
  MessageCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimelineEvent {
  id: string;
  type: 'call' | 'email' | 'sms' | 'note' | 'status_change' | 'message' | 'document' | 'appointment';
  title: string;
  description?: string;
  timestamp: string;
  user_name?: string;
  metadata?: any;
  direction?: 'inbound' | 'outbound';
  status?: string;
}

interface UnifiedCommunicationsTimelineProps {
  pipelineEntryId?: string;
  projectId?: string;
  contactId?: string;
  maxItems?: number;
  showFilters?: boolean;
}

const getEventIcon = (type: string, direction?: string) => {
  switch (type) {
    case 'call':
      return direction === 'inbound' ? PhoneIncoming : PhoneOutgoing;
    case 'email':
      return Mail;
    case 'sms':
      return MessageSquare;
    case 'message':
      return MessageCircle;
    case 'note':
      return FileText;
    case 'status_change':
      return ArrowRight;
    case 'document':
      return FileText;
    case 'appointment':
      return Calendar;
    default:
      return Clock;
  }
};

const getEventColor = (type: string) => {
  switch (type) {
    case 'call':
      return 'bg-green-500/10 text-green-600 border-green-500/20';
    case 'email':
      return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    case 'sms':
      return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
    case 'message':
      return 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20';
    case 'note':
      return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'status_change':
      return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
    case 'document':
      return 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20';
    case 'appointment':
      return 'bg-pink-500/10 text-pink-600 border-pink-500/20';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

export const UnifiedCommunicationsTimeline: React.FC<UnifiedCommunicationsTimelineProps> = ({
  pipelineEntryId,
  projectId,
  contactId,
  maxItems = 50,
  showFilters = true,
}) => {
  const [typeFilter, setTypeFilter] = React.useState<string | null>(null);

  const { data: events, isLoading } = useQuery({
    queryKey: ['communications-timeline', pipelineEntryId, projectId, contactId],
    queryFn: async () => {
      const timeline: TimelineEvent[] = [];

      // Fetch call logs
      if (pipelineEntryId || contactId) {
        const { data: calls } = await (supabase
          .from('call_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(maxItems) as any);

        calls?.forEach((call: any) => {
          timeline.push({
            id: `call-${call.id}`,
            type: 'call',
            title: `${call.direction === 'inbound' ? 'Incoming' : 'Outgoing'} Call`,
            description: call.disposition || `${call.duration_seconds || 0}s duration`,
            timestamp: call.created_at,
            direction: call.direction as 'inbound' | 'outbound',
            status: call.status,
            metadata: { duration: call.duration_seconds, recording: call.recording_url },
          });
        });
      }

      // Fetch customer messages (from portal)
      if (projectId) {
        const { data: customerMessages } = await (supabase
          .from('customer_messages')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(maxItems) as any);

        customerMessages?.forEach((msg: any) => {
          timeline.push({
            id: `msg-${msg.id}`,
            type: 'message',
            title: msg.sender_type === 'customer' ? 'Customer Message' : 'Staff Reply',
            description: msg.message?.substring(0, 100) + (msg.message?.length > 100 ? '...' : ''),
            timestamp: msg.created_at,
            direction: msg.sender_type === 'customer' ? 'inbound' : 'outbound',
            metadata: { is_read: msg.is_read },
          });
        });
      }

      // Fetch communication history
      if (pipelineEntryId || contactId) {
        const { data: communications } = await (supabase
          .from('communication_history')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(maxItems) as any);

        communications?.forEach((comm: any) => {
          timeline.push({
            id: `comm-${comm.id}`,
            type: comm.communication_type?.includes('email') ? 'email' : 'note',
            title: comm.subject || comm.communication_type || 'Communication',
            description: comm.content?.substring(0, 100) + (comm.content?.length > 100 ? '...' : ''),
            timestamp: comm.created_at,
            direction: comm.direction as 'inbound' | 'outbound',
          });
        });
      }

      // Sort by timestamp descending
      timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return timeline.slice(0, maxItems);
    },
    enabled: !!(pipelineEntryId || projectId || contactId),
  });

  const filteredEvents = typeFilter ? events?.filter(e => e.type === typeFilter) : events;
  const eventTypes = ['call', 'email', 'message', 'note'];

  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Communications Timeline
        </h3>
        {events && <Badge variant="outline">{events.length} events</Badge>}
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-2 mb-4">
          <Button variant={typeFilter === null ? 'default' : 'outline'} size="sm" onClick={() => setTypeFilter(null)}>
            All
          </Button>
          {eventTypes.map((type) => {
            const Icon = getEventIcon(type);
            const count = events?.filter(e => e.type === type).length || 0;
            if (count === 0) return null;
            return (
              <Button key={type} variant={typeFilter === type ? 'default' : 'outline'} size="sm" onClick={() => setTypeFilter(type)} className="gap-1">
                <Icon className="h-3 w-3" />
                {type.charAt(0).toUpperCase() + type.slice(1)}
                <Badge variant="secondary" className="ml-1 h-5 px-1">{count}</Badge>
              </Button>
            );
          })}
        </div>
      )}

      <ScrollArea className="h-[400px] pr-4">
        {!filteredEvents || filteredEvents.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No communications recorded yet</p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
            <div className="space-y-4">
              {filteredEvents.map((event) => {
                const Icon = getEventIcon(event.type, event.direction);
                const colorClass = getEventColor(event.type);
                return (
                  <div key={event.id} className="relative flex gap-4 pl-2">
                    <div className={cn('relative z-10 flex items-center justify-center h-10 w-10 rounded-full border-2 bg-background', colorClass)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{event.title}</p>
                          {event.description && <p className="text-sm text-muted-foreground mt-0.5">{event.description}</p>}
                        </div>
                        <p className="text-xs text-muted-foreground shrink-0">
                          {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                        </p>
                      </div>
                      <div className="flex gap-2 mt-2">
                        {event.direction && <Badge variant="outline" className="text-xs">{event.direction}</Badge>}
                        {event.status && <Badge variant="outline" className="text-xs">{event.status}</Badge>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </ScrollArea>
    </Card>
  );
};