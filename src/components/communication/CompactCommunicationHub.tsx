import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Phone, 
  MessageSquare, 
  Mail, 
  ChevronDown,
  ChevronUp,
  Clock,
  ArrowUpRight,
  ArrowDownLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface CompactCommunicationHubProps {
  contactId?: string;
  contactPhone?: string;
  contactEmail?: string;
  onCallClick?: () => void;
  onEmailClick?: () => void;
  onSMSClick?: () => void;
  className?: string;
}

interface ActivityItem {
  id: string;
  type: 'call' | 'sms' | 'email';
  direction: 'inbound' | 'outbound';
  content: string;
  created_at: string;
  delivery_status?: string | null;
}

export const CompactCommunicationHub: React.FC<CompactCommunicationHubProps> = ({
  contactId,
  contactPhone,
  contactEmail,
  onCallClick,
  onEmailClick,
  onSMSClick,
  className
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch combined communication history
  const fetchActivities = async () => {
    if (!contactId) return;
    
    setLoading(true);
    try {
      // Fetch communication history (SMS + Email)
      const { data: commHistory } = await supabase
        .from('communication_history')
        .select('id, communication_type, direction, content, subject, created_at, delivery_status')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(10);

      // Fetch call logs
      const { data: callLogs } = await supabase
        .from('call_logs')
        .select('id, direction, status, duration_seconds, created_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(10);

      // Combine and sort
      const combined: ActivityItem[] = [
        ...(commHistory || []).map(item => ({
          id: item.id,
          type: item.communication_type as 'sms' | 'email',
          direction: item.direction as 'inbound' | 'outbound',
          content: item.communication_type === 'email' 
            ? item.subject || 'No subject' 
            : item.content?.substring(0, 50) + (item.content?.length > 50 ? '...' : ''),
          created_at: item.created_at,
          delivery_status: item.delivery_status
        })),
        ...(callLogs || []).map(item => ({
          id: item.id,
          type: 'call' as const,
          direction: item.direction as 'inbound' | 'outbound',
          content: `${item.status} - ${Math.floor((item.duration_seconds || 0) / 60)}:${String((item.duration_seconds || 0) % 60).padStart(2, '0')}`,
          created_at: item.created_at
        }))
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
       .slice(0, 10);

      setActivities(combined);
    } catch (error) {
      console.error('Error fetching activities:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (contactId) {
      fetchActivities();
    }
  }, [contactId]);

  // Real-time updates
  useEffect(() => {
    if (!contactId) return;

    const channel = supabase
      .channel('compact-comm-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'communication_history',
          filter: `contact_id=eq.${contactId}`
        },
        () => fetchActivities()
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_logs',
          filter: `contact_id=eq.${contactId}`
        },
        () => fetchActivities()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [contactId]);

  const getActivityIcon = (type: string, direction: string) => {
    const DirectionIcon = direction === 'outbound' ? ArrowUpRight : ArrowDownLeft;
    
    switch (type) {
      case 'call':
        return <Phone className="h-3 w-3" />;
      case 'sms':
        return <MessageSquare className="h-3 w-3" />;
      case 'email':
        return <Mail className="h-3 w-3" />;
      default:
        return <MessageSquare className="h-3 w-3" />;
    }
  };

  const getDeliveryStatusBadge = (status: string | null | undefined) => {
    if (!status) return null;
    
    switch (status.toLowerCase()) {
      case 'delivered':
        return <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-green-500/10 text-green-600 border-green-500/20">Delivered</Badge>;
      case 'sent':
        return <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-blue-500/10 text-blue-600 border-blue-500/20">Sent</Badge>;
      case 'queued':
        return <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-yellow-500/10 text-yellow-600 border-yellow-500/20">Queued</Badge>;
      case 'failed':
      case 'undelivered':
        return <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-red-500/10 text-red-600 border-red-500/20">Failed</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{status}</Badge>;
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {/* Quick Actions - Always Visible */}
      <div className="flex gap-2">
        <Button 
          size="sm" 
          variant="outline" 
          className="flex-1 h-8 text-xs"
          onClick={onCallClick}
          disabled={!contactPhone}
        >
          <Phone className="h-3 w-3 mr-1" />
          Call
        </Button>
        <Button 
          size="sm" 
          variant="outline" 
          className="flex-1 h-8 text-xs"
          onClick={onSMSClick}
          disabled={!contactPhone}
        >
          <MessageSquare className="h-3 w-3 mr-1" />
          SMS
        </Button>
        <Button 
          size="sm" 
          variant="outline" 
          className="flex-1 h-8 text-xs"
          onClick={onEmailClick}
          disabled={!contactEmail}
        >
          <Mail className="h-3 w-3 mr-1" />
          Email
        </Button>
      </div>

      {/* Collapsible Activity Feed */}
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full justify-between h-8 text-xs text-muted-foreground hover:text-foreground"
          >
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Recent Activity ({activities.length})
            </span>
            {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ScrollArea className="h-[200px] mt-2">
            {loading ? (
              <div className="text-xs text-muted-foreground text-center py-4">
                Loading...
              </div>
            ) : activities.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-4">
                No communication history
              </div>
            ) : (
              <div className="space-y-1">
                {activities.map((activity) => (
                  <div 
                    key={activity.id}
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 text-xs"
                  >
                    <div className={cn(
                      "flex items-center justify-center w-6 h-6 rounded-full",
                      activity.direction === 'outbound' ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}>
                      {getActivityIcon(activity.type, activity.direction)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                          {activity.type}
                        </Badge>
                        {activity.direction === 'outbound' ? (
                          <ArrowUpRight className="h-2.5 w-2.5 text-muted-foreground" />
                        ) : (
                          <ArrowDownLeft className="h-2.5 w-2.5 text-muted-foreground" />
                        )}
                        {activity.type === 'sms' && activity.direction === 'outbound' && getDeliveryStatusBadge(activity.delivery_status)}
                      </div>
                      <p className="truncate text-muted-foreground mt-0.5">
                        {activity.content}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {format(new Date(activity.created_at), 'MMM d')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
