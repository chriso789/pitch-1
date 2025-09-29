import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Clock, 
  User, 
  ArrowRight, 
  CheckCircle, 
  AlertCircle,
  FileText,
  Calendar
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from 'date-fns';

interface JobActivityTimelineProps {
  jobId: string;
}

interface ActivityEvent {
  id: string;
  created_at: string;
  event_type: string;
  description: string;
  user_name: string;
  metadata: any;
}

export const JobActivityTimeline = ({ jobId }: JobActivityTimelineProps) => {
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchActivities();
    
    // Subscribe to real-time updates
    const channel = supabase
      .channel('job-activities')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'communication_history',
          filter: `metadata->>job_id=eq.${jobId}`
        },
        () => fetchActivities()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  const fetchActivities = async () => {
    try {
      // Fetch from communication_history table
      const { data, error } = await supabase
        .from('communication_history')
        .select(`
          id,
          created_at,
          communication_type,
          content,
          direction,
          metadata,
          rep_id
        `)
        .or(`metadata->>job_id.eq.${jobId},metadata->>related_job_id.eq.${jobId}`)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Transform data into activity events
      const events: ActivityEvent[] = await Promise.all(
        (data || []).map(async (item) => {
          let userName = 'System';
          if (item.rep_id) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('first_name, last_name')
              .eq('id', item.rep_id)
              .single();
            
            if (profile) {
              userName = `${profile.first_name} ${profile.last_name}`;
            }
          }

          return {
            id: item.id,
            created_at: item.created_at,
            event_type: item.communication_type,
            description: item.content || getActivityDescription(item),
            user_name: userName,
            metadata: item.metadata
          };
        })
      );

      setActivities(events);
    } catch (error) {
      console.error('Error fetching activities:', error);
    } finally {
      setLoading(false);
    }
  };

  const getActivityDescription = (item: any) => {
    const metadata = item.metadata || {};
    
    switch (item.communication_type) {
      case 'status_change':
        return `Job status changed from ${metadata.from_status || 'unknown'} to ${metadata.to_status || 'unknown'}`;
      case 'assignment':
        return `Job assigned to ${metadata.assigned_to_name || 'team member'}`;
      case 'note':
        return item.content || 'Note added';
      case 'call':
        return `${item.direction === 'outbound' ? 'Called' : 'Received call from'} customer`;
      case 'email':
        return `${item.direction === 'outbound' ? 'Sent email to' : 'Received email from'} customer`;
      default:
        return `Activity: ${item.communication_type}`;
    }
  };

  const getActivityIcon = (eventType: string) => {
    switch (eventType) {
      case 'status_change':
        return <ArrowRight className="h-4 w-4" />;
      case 'assignment':
        return <User className="h-4 w-4" />;
      case 'note':
        return <FileText className="h-4 w-4" />;
      case 'call':
      case 'email':
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getActivityColor = (eventType: string) => {
    switch (eventType) {
      case 'status_change':
        return 'text-blue-600 bg-blue-50';
      case 'assignment':
        return 'text-purple-600 bg-purple-50';
      case 'note':
        return 'text-gray-600 bg-gray-50';
      case 'call':
      case 'email':
        return 'text-green-600 bg-green-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Activity Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            Loading activity...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Activity Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          {activities.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No activity recorded yet
            </div>
          ) : (
            <div className="space-y-4">
              {activities.map((activity, index) => (
                <div key={activity.id} className="relative pl-8 pb-4 last:pb-0">
                  {/* Timeline line */}
                  {index !== activities.length - 1 && (
                    <div className="absolute left-[15px] top-8 bottom-0 w-0.5 bg-border" />
                  )}
                  
                  {/* Activity icon */}
                  <div className={`absolute left-0 top-1 rounded-full p-2 ${getActivityColor(activity.event_type)}`}>
                    {getActivityIcon(activity.event_type)}
                  </div>
                  
                  {/* Activity content */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {activity.description}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <User className="h-3 w-3" />
                      <span>{activity.user_name}</span>
                      <span>•</span>
                      <Calendar className="h-3 w-3" />
                      <span>{formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}</span>
                    </div>
                    
                    {activity.metadata?.notes && (
                      <p className="text-sm text-muted-foreground mt-2">
                        {activity.metadata.notes}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
