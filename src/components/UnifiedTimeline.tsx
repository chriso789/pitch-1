import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { 
  Phone, 
  Mail, 
  MessageSquare, 
  FileText, 
  Calendar,
  Clock,
  User,
  CheckCircle,
  AlertCircle,
  ArrowUpRight,
  ArrowDownLeft,
  Filter
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ChannelType = "all" | "call" | "email" | "sms" | "note" | "event";

interface TimelineEvent {
  id: string;
  type: string;
  channel: string;
  direction?: string;
  subject?: string;
  content?: string;
  created_at: string;
  created_by_name?: string;
  metadata?: Record<string, unknown>;
}

interface UnifiedTimelineProps {
  contactId?: string;
  pipelineEntryId?: string;
  projectId?: string;
  maxHeight?: string;
  className?: string;
}

const channelIcons: Record<string, typeof Phone> = {
  call: Phone,
  email: Mail,
  sms: MessageSquare,
  note: FileText,
  event: Calendar,
};

const channelColors: Record<string, string> = {
  call: "text-blue-500 bg-blue-500/10",
  email: "text-purple-500 bg-purple-500/10",
  sms: "text-green-500 bg-green-500/10",
  note: "text-amber-500 bg-amber-500/10",
  event: "text-pink-500 bg-pink-500/10",
};

export function UnifiedTimeline({
  contactId,
  pipelineEntryId,
  projectId,
  maxHeight = "400px",
  className,
}: UnifiedTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ChannelType>("all");

  useEffect(() => {
    fetchTimelineEvents();
  }, [contactId, pipelineEntryId, projectId, filter]);

  async function fetchTimelineEvents() {
    if (!contactId && !pipelineEntryId && !projectId) {
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      let query = supabase
        .from("communication_history")
        .select(`
          id,
          communication_type,
          direction,
          subject,
          content,
          created_at,
          metadata,
          profiles:created_by (
            full_name
          )
        `)
        .order("created_at", { ascending: false })
        .limit(50);

      if (contactId) {
        query = query.eq("contact_id", contactId);
      }
      if (pipelineEntryId) {
        query = query.eq("pipeline_entry_id", pipelineEntryId);
      }
      if (projectId) {
        query = query.eq("project_id", projectId);
      }
      if (filter !== "all") {
        query = query.eq("communication_type", filter);
      }

      const { data, error } = await query;

      if (error) throw error;

      const formattedEvents: TimelineEvent[] = (data || []).map((item) => ({
        id: item.id,
        type: item.communication_type || "note",
        channel: item.communication_type || "note",
        direction: item.direction,
        subject: item.subject,
        content: item.content,
        created_at: item.created_at,
        created_by_name: (item.profiles as { full_name?: string } | null)?.full_name,
        metadata: item.metadata as Record<string, unknown> | undefined,
      }));

      setEvents(formattedEvents);
    } catch (error) {
      console.error("Error fetching timeline:", error);
    } finally {
      setLoading(false);
    }
  }

  function getEventIcon(event: TimelineEvent) {
    const Icon = channelIcons[event.channel] || FileText;
    return Icon;
  }

  function getEventTitle(event: TimelineEvent) {
    const directionIcon = event.direction === "inbound" 
      ? <ArrowDownLeft className="h-3 w-3" /> 
      : event.direction === "outbound" 
        ? <ArrowUpRight className="h-3 w-3" />
        : null;

    const channelLabel = event.channel.charAt(0).toUpperCase() + event.channel.slice(1);

    return (
      <div className="flex items-center gap-1.5">
        {directionIcon}
        <span>{event.subject || `${channelLabel} ${event.direction || ""}`}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cn("space-y-3", className)}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Filter */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={filter} onValueChange={(v) => setFilter(v as ChannelType)}>
          <SelectTrigger className="w-32 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="call">Calls</SelectItem>
            <SelectItem value="email">Emails</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
            <SelectItem value="note">Notes</SelectItem>
            <SelectItem value="event">Events</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Timeline */}
      <ScrollArea style={{ maxHeight }} className="pr-4">
        {events.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No activity yet</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
            
            <div className="space-y-4">
              {events.map((event, index) => {
                const Icon = getEventIcon(event);
                const colorClass = channelColors[event.channel] || "text-muted-foreground bg-muted";

                return (
                  <div key={event.id} className="relative flex gap-3 pl-2">
                    {/* Icon */}
                    <div className={cn(
                      "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      colorClass
                    )}>
                      <Icon className="h-4 w-4" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pb-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm truncate">
                          {getEventTitle(event)}
                        </div>
                        <time className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(event.created_at), "MMM d, h:mm a")}
                        </time>
                      </div>
                      
                      {event.content && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {event.content}
                        </p>
                      )}
                      
                      {event.created_by_name && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3" />
                          {event.created_by_name}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
